#include <algorithm>
#include <boost/math/constants/constants.hpp>
#include <boost/math/special_functions/spherical_harmonic.hpp>
#include <boost/multi_array.hpp>
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

/*
// Angular radiance distribution.
class AngularRadiance {
public:
	Radiance get(Direction dir) const;
};

// Angular radiance distribution approximated by spherica harmonics.
class SHAngularRadiance : public AngularRadiance {
	SHAngularRadiance(Radiance v00) : v00(v00) {
	}

	SHAngularRadiance(Radiance v00, Radiance v1m1, Radiance v10, Radiance v1p1) :
		v00(v00), v1m1(v1m1), v10(v10), v1p1(v1p1) {
	}

	Radiance get(Direction dir) const {
		double rxy = sqrt(dir[0] * dir[0] + dir[1] * dir[1]);
		
		double theta = 0.5 * boost::math::constants::pi<double>() - atan2(dir[2], rxy);
		double phi = atan2(dir[1], dir[0]);

		return
			boost::math::detail::spherical_harmonic_r(0, 0, theta, phi, default_policy()) * v00 +
			boost::math::detail::spherical_harmonic_r(1, -1, theta, phi, default_policy()) * v1m1 +
			boost::math::detail::spherical_harmonic_r(1, 0, theta, phi, default_policy()) * v10 +
			boost::math::detail::spherical_harmonic_r(1, 1, theta, phi, default_policy()) * v1p1;
	}
private:
	Radiance v00, v1m1, v10, v1p1;
};
*/

// Class to store radiance distribution on sphere.
// Sampling density can be assumed to constant.
class RadianceSphere {
public:
	RadianceSphere() {
		image = cv::Mat(480, 960, CV_8UC3);
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
	LightGrid() {
		size = 0.01;

		std::mt19937 gen;
		std::uniform_int_distribution<> dist(-20, 20);

		
		for(int i=0; i<100; i++) {
			auto loc = std::make_tuple(dist(gen), dist(gen), dist(gen));
			cells[loc] = std::unique_ptr<LGVoxel>(new LGVoxel());
		}
	}

	RadianceSphere trace(Position pos) {
		const int px_base = 500;
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


int main(int argc, char** argv) {
	auto lg = LightGrid();
	lg.trace(Position(0, 0, 0)).dump("hoge.png");

	return 0;
}
