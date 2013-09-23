#include <algorithm>
#include <boost/math/constants/constants.hpp>
#include <eigen3/Eigen/Dense>
#include <iostream>
#include <memory>
#include <opencv2/opencv.hpp>
#include <random>
#include <string>
#include <tuple>

using default_policy = 
    boost::math::policies::policy<
        boost::math::policies::rounding_error<boost::math::policies::ignore_error>
    >;

using Eigen::MatrixXd;
using Radiance = Eigen::Vector3d;  // multiples of W/sr/m
using Position = Eigen::Vector3d;  // in meter
using Direction = Eigen::Vector3d;  // no unit, norm must be 1.

const double pi =  boost::math::constants::pi<double>();

// Class to store radiance distribution on sphere.
// Sampling density can be assumed to constant.
// Radiance distribution on sphere is enough to derive any kind of perspective or
// panoramic images.
class RadianceSphere {
public:
	RadianceSphere() {
		image = cv::Mat(480, 960, CV_64FC3);
	}

	RadianceSphere(cv::Mat image_source) {
		assert(image_source.cols == 2 * image_source.rows);
		image = image_source;
	}

	void dump(std::string path) const {
		cv::imwrite(path, image);
	}
private:
	cv::Mat image;  // y:theta [0,pi] x:phi [0,2pi]
};


class LGVoxel {
public:
	LGVoxel() {
		r = Eigen::Vector3d(100, 200, 100);
	}

	Radiance getRadiance() {
		return r;
	}
private:
	Radiance r;
};


class LightGrid {
public:
	LightGrid(bool gen_random=true) {
		size = 0.001;

		if(gen_random) {
			std::mt19937 gen;
			std::uniform_int_distribution<> dist(-50, 50);
			
			for(int i=0; i<100; i++) {
				auto loc = std::make_tuple(dist(gen), dist(gen), dist(gen));
				cells[loc] = std::unique_ptr<LGVoxel>(new LGVoxel());
			}
		}
	}

	void add(std::tuple<int, int, int> pos, std::unique_ptr<LGVoxel> vx) {
		cells[pos] = std::move(vx);
	}

	RadianceSphere trace(Position pos) {
		const int px_base = 250;
		cv::Mat image(px_base, px_base * 2, CV_64FC3);

		for(int it=0; it<px_base; it++) {
			for(int ip=0; ip<px_base * 2; ip++) {
				const double theta = pi * it / px_base;
				const double phi = pi * ip / px_base;

				auto dir = Direction(sin(theta) * cos(phi), sin(theta) * sin(phi), cos(theta));

				auto radiance = sample(pos, dir);
				image.at<cv::Vec3d>(it, ip) = cv::Vec3d(radiance[0], radiance[1], radiance[2]);
			}
		}

		return RadianceSphere(image);
	}

	Radiance sample(Position org, Direction dir) {
		double t_total = 1e6;
		Radiance d(100, 50, 50);  // escaped

		for(auto& voxel : cells) {
			if(!voxel.second) {
				continue;
			}

			Position p0 = Eigen::Vector3d(std::get<0>(voxel.first), std::get<1>(voxel.first), std::get<2>(voxel.first)) * size;
			Position p1 = p0 + Position(1, 1, 1) * size;

			double t_current;
			if(intersectCube(p0, p1, org, dir, t_current)) {
				if(t_current < t_total) {

					t_total = t_current;
					d = voxel.second->getRadiance();
				}
			}
		}

		return d;
	}
private:
	bool intersectCube(Position p0, Position p1, Position org, Position dir, double& t_intersect) {
		// Project 3 slabs to ray and take intersection.
		Eigen::Vector3d pre_t0 = (p0 - org).cwiseQuotient(dir);
		Eigen::Vector3d pre_t1 = (p1 - org).cwiseQuotient(dir);

		Eigen::Vector3d t0 = pre_t0.cwiseMin(pre_t1);
		Eigen::Vector3d t1 = pre_t0.cwiseMax(pre_t1);

		const double t_begin = std::max({t0[0], t0[1], t0[2], 0.0});  // 0 is for ray beginning
		const double t_end = std::min({t1[0], t1[1], t1[2]});

		// No intersection when intersected range is empty.
		if(t_begin > t_end) {
			return false;
		}

		t_intersect = t_begin;
		return true;
	}
protected:
	// Cell i occupies [i*size, (i+1)*size).
	double size;
	std::map<std::tuple<int,int,int>, std::unique_ptr<LGVoxel>> cells;  // nullptr cell acts as an empty cell
};


template <typename VoxelType>
using SparseVoxel = std::map<std::tuple<int, int, int>, VoxelType>;

// A node of dynamic L system.
// TODO: constructors are becoming messy. Refactor it after all modification operations
// are implemented.
class PlantNode {
public:
	// Create shoot system root along with root system pointer set, assuming up is Z+.
	PlantNode(Position pos) :
		pos(pos),
		shoot(false),
		parent(new PlantNode(pos - Position(0, 0, 0.0001), this, false)),
		radius(0.0001),
		can_replicate(false)  {
		// Attach shoot apical meristem.
		children.push_back(std::unique_ptr<PlantNode>(new PlantNode(this)));
	}

	// Attach new child 0.1mm away from parent.
	PlantNode(PlantNode* parent) :
		pos(parent->pos + parent->normal() * 0.0001),
		shoot(parent->shoot),
		parent(parent),
		radius(0.0001),
		can_replicate(true) {
	}

private:
	// Unsafe constructor that can specify shoot/root flag. Should only needed
	// for creating first pair of nodes of a plant.
	PlantNode(Position pos, PlantNode* parent, bool shoot) :
		pos(pos), parent(parent), shoot(shoot), radius(0.0001),
		can_replicate(true)  {
	}

public:
	Position getPos() const {
		return pos;
	}

	Direction normal() const {
		return (parent->pos - pos).normalized();
	}

	void move(Position displacement) {
		pos += displacement;
		for(auto& child : children) {
			child->move(displacement);
		}
	}

	void step(double dt) {
		// all edges grows at constant speed until they become 10mm.
		grow(dt);
		trigger_replicate();
	}

	void grow(double dt) {
		const double length_saturated= 0.01;
		const double speed = 0.1e-3 / 60;  // 1 mm / min

		for(auto& child : children) {
			Position delta = child->pos - pos;
			const double length_current = delta.norm();


			if(length_current < length_saturated) {
				const double length_new = length_current + speed * dt;
				std::cout << length_current << "->" << length_new << std::endl;

				auto displacement = delta * (length_new / length_current - 1);
				child->move(displacement);
			}
		}
	}

	// Execute replication depending on condition.
	// This function is idempotent (i.e. more than one call results in same state to calling just once).
	void trigger_replicate() {
		const double length_min_split = 3e-3; // edge longer than 3mm splits immediately.

		for(auto it = children.begin(); it != children.end(); it++) {
			auto& child = *it;

			if((child->pos - pos).norm() > length_min_split &&
				child->can_replicate) {
				split_half(it);
			}
		}

	}

	// TODO: make this protected by creating accessor method. (what about ext. modify?)
	std::vector<std::unique_ptr<PlantNode>> children;
private:
	// Insert new node between this and specified child.
	void split_half(std::vector<std::unique_ptr<PlantNode>>::iterator it_child) {
		std::cout << "SPLITTED" << std::endl;

		std::unique_ptr<PlantNode> grandchild = std::move(*it_child);

		std::unique_ptr<PlantNode> mid_node(new PlantNode(this));
		mid_node->pos = (pos + grandchild->pos) / 2;
		mid_node->radius = (radius + grandchild->radius) / 2;

		// Fix backward link.
		grandchild->parent = mid_node.get();

		// Fix forward links.
		mid_node->children.push_back(std::move(grandchild));
		*it_child = std::move(mid_node);
	}
protected:
	// physical structure
	Position pos;
	double radius;

	// topology and biological network
	PlantNode* parent;  // always exists. This is not a reference because split operation needs to change it.
	
	bool can_replicate;  // roughly corresponds to apical meristems in real plants.
	bool shoot;  // shoot system (above ground) or root system (below ground).
};

// Whole world containing a plant and fixed environment.
class Bonsai {
public:
	Bonsai() {
		plant.reset(new PlantNode(Position(0,0,0)));
		plant->children.push_back(std::unique_ptr<PlantNode>(new PlantNode(plant.get())));
		timestamp = 0;
	}

	// Increase time by less than 1min.
	// Steps larger than that are not allowed.
	void step(double dt = 60) {
		plant->step(dt);

		auto vx_occ = rasterizePlant();
		auto vx_lg = convertVoxels(vx_occ);

		std::cout << "plant # of voxels:" << vx_occ.size() << std::endl;
		vx_lg.trace(Position(0.03, 0.03, 0.03)).dump("photo.png");

		timestamp += dt;
	}

	SparseVoxel<bool> rasterizePlant() {
		SparseVoxel<bool> retv;
		rasterizePlantStem(*plant, retv);
		return retv;
	}

	LightGrid convertVoxels(SparseVoxel<bool> vx) {
		LightGrid lg(false);

		for(const auto kv : vx) {
			lg.add(kv.first, std::unique_ptr<LGVoxel>(new LGVoxel()));
		}

		return lg;
	}

	// DFS
	void rasterizePlantStem(const PlantNode& node, SparseVoxel<bool>& result) {
		std::cout << "Rasterizing plant stem" << std::endl;

		const double vx_size = 0.001;

		for(const auto& child : node.children) {
			// Write edge.
			Position edge_vect = child->getPos() - node.getPos();
			for(int i=0; i<1+edge_vect.norm()/vx_size; i++) {
				Position pos_on_edge = node.getPos() + edge_vect.normalized() * (i * vx_size);
				Eigen::Vector3d pos_i = pos_on_edge / vx_size;

				auto p = std::make_tuple(
					static_cast<int>(pos_i[0]),
					static_cast<int>(pos_i[1]),
					static_cast<int>(pos_i[2]));

				result[p] = true;
			}

			// Trace further.
			rasterizePlantStem(*child, result);
		}
	}
private:
	double timestamp = 0;  // second
	SparseVoxel<bool> env;  // true means occupied by block.
	std::unique_ptr<PlantNode> plant;  // should be root of shoot system or nullptr.
};


int main(int argc, char** argv) {
	Bonsai bonsai;
	for(int i=0; i<100; i++) {
		bonsai.step();
	}

	return 0;
}
