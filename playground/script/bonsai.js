define(['jquery', 'three'],
function($, THREE) {

var CellType = {
	LEAF: 1,
	SHOOT: 2,
	FLOWER: 3  // self-pollinating, seed-dispersing
};


// Collections of cells that forms a "single" plant.
// This is not biologically accurate depiction of plants,
// (e.g. vegetative growth, physics)
// Most plants seems to have some kind of information sharing system within them
// via transportation of regulation growth factors.
// position :: THREE.Vector3<World>
var Plant = function(position, unsafe_chunk) {
	this.unsafe_chunk = unsafe_chunk;

	this.age = 0;
	this.position = position;
	this.seed = new Cell(this, CellType.SHOOT);
};

Plant.prototype.step = function() {
	this.age += 1;
	// TODO: this seems super wrong!!!
	// cell should be updated independently, and it's part of world physics,
	// not bio-physics!
	this.seed.step();

	console.assert(this.seed.age === this.age);
};

// Approximates lifetime of the plant.
// Max growth=1, zero growth=0.
// return :: [0,1]
Plant.prototype.growth_factor = function() {
	return Math.exp(-this.age / 30);
};

// return :: THREE.Object3D<world>
Plant.prototype.materialize = function() {
	var three_plant = this.seed.materialize();
	three_plant.position = this.position;
	return three_plant;
};

Plant.prototype.count_type = function() {
	return this.seed.count_type({});
};

// Chunk Cell. This class uses THREE.Vector3 or Quaternion, but doesn't depend on
// scene, mesh, geometry etc. Instead, Cell is capable of generating Object3D instance
// given scene.
// Single Cell instance corresponds roughly to Object3D.
//
// Cell grows Z+ direction when rotation is identity.
// When the Cell is a leaf,  photosynthetic plane is Y+.
// parent :: Chunk
//
// Cell energy model:
//  Currently, each Cell is represented by tree of cells.
//  A Cell have state shared among all cells in it.
//  One of them is energy.
//  Energy In:
//    sum of photosynthesis by LEAF cells
//  Energy Out:
//    sum of metabolic by all cells (volume * k + some_constant for cell core function)
//
//  When Energy <= 0, Cell dies immediately. (vanishes without trace)
//   -> this is very unnatural, fix it later.
//
// Each cell in Cell grows (or divides) independently.
var Cell = function(plant, cell_type) {
	this.plant = plant;

	this.core = this;
	this.children = [];

	// tracer
	this.age = 0;

	// in-sim (phys + bio)
	this.loc_to_parent = new THREE.Quaternion();
	this.sx = 1e-3;
	this.sy = 1e-3;
	this.sz = 1e-3;

	// in-sim (bio)
	this.cell_type = cell_type;

	if(cell_type === CellType.SEED) {
		this.add_shoot_cont(false);
	} else {
		this.stem_length = 30e-3;
	}
};

// return :: bool
Cell.prototype.is_shoot_end = function() {
	return this.children.length == 0 && this.cell_type === CellType.SHOOT;
}

// sub_cell :: Cell
// return :: ()
Cell.prototype.add = function(sub_cell) {
	this.children.push(sub_cell);
};

// return :: ()
Cell.prototype.step = function() {
	this.age += 1;

	_.each(this.children, function(sub_cell) {
		sub_cell.step();
	}, this);

	// These should differ depending on CellType
	this.sx = Math.min(5e-3, this.sx + 0.1e-3 * this.plant.growth_factor());
	this.sy = Math.min(5e-3, this.sy + 0.1e-3 * this.plant.growth_factor());
	this.sz += 3e-3 * this.plant.growth_factor();

	var z_x = Math.random();
	if(z_x < this.plant.growth_factor()) {
		if(this.is_shoot_end()) {
			var z = Math.random();
			if(z < 0.1) {
				this.add_shoot_cont(false);
				this.add_leaf_cont();
			} else if(z < 0.2) {
				this.add_shoot_cont(false);
				this.add_shoot_cont(true);
			}
		}
	}

	if(this.plant.growth_factor() < 0.1 && this.is_shoot_end()) {
		this.cell_type = CellType.FLOWER;
		this.sx = 10e-3;
		this.sy = 10e-3;
		this.sz = 5e-3;
	}

	if(this.cell_type === CellType.FLOWER) {
		// Disperse seed once in a while.
		if(Math.random() < 0.01) {
			this.plant.unsafe_chunk.add_plant(new THREE.Vector3(
				this.plant.position.x + Math.random() * 1 - 0.5,
				this.plant.position.y + Math.random() * 1 - 0.5,
				0
				));
		}
	}
};

// return :: THREE.Object3D
Cell.prototype.materialize = function() {
	// Create cell object [-sx/2,sx/2] * [-sy/2,sy/2] * [0, sz]
	var color_diffuse;
	if(this.cell_type === CellType.LEAF) {
		color_diffuse = 'green';
	} else if(this.cell_type === CellType.SEED) {
		color_diffuse = 'blue';
	} else if(this.cell_type === CellType.FLOWER) {
		color_diffuse = 'red';
	} else {
		color_diffuse = 'brown';
	}
	var color_ambient = color_diffuse; // .offsetHSL(0, 0, -0.3);

	var object_cell = new THREE.Mesh(
		new THREE.CubeGeometry(this.sx, this.sy, this.sz),
		new THREE.MeshLambertMaterial({
			color: color_diffuse,
			ambient: color_ambient}));
	object_cell.position.z = this.sz / 2;

	// Create children coordinates frame.
	var object_frame_children = new THREE.Object3D();
	object_frame_children.position.z += this.sz;

	// Create cell coordinates frame.
	var object_frame = new THREE.Object3D();
	object_frame.quaternion = this.loc_to_parent;  // TODO: is this ok?
	object_frame.add(object_cell);
	object_frame.add(object_frame_children);

	// Add children.
	_.each(this.children, function(child) {
		object_frame_children.add(child.materialize());
	}, this);

	return object_frame;
};

// Get Cell age in seconds.
// return :: float (sec)
Cell.prototype.get_age = function() {
	return this.age;
};

// Return received sunlight. This will not be completely accurate,
// but robust to strange geometry.
// return :: float [0,+inf) (W)
Cell.prototype.get_flux = function() {
	// TODO: DO NOT call light_volume... here. It should be stored in Cell instances
	// in step phase.
	// TODO: this is wrong when non-Cell occluders or multiple Cells exist.
	// TODO: what about normals?
	// TODO: Use real Photosynthesis-Irradiance (PI) curve.
	return this.parent.light_volume.flux_occluded;
}

// Get total mass of this and children.
// return :: float (kg)
Cell.prototype.get_mass = function() {
	var density = 1000; // kg/m^3

	var volume;
	if(this.cell_type === CellType.LEAF) {
		volume = 20e-3 * 3e-3 * this.stem_length;
	} else {
		volume = Math.pow(this.stem_diameter, 2) * this.stem_length;
	}

	return volume * density +
		sum(_.map(this.children, function(child) {return child.get_mass();}));
};

// counter :: dict(string, int)
// return :: dict(string, int)
Cell.prototype.count_type = function(counter) {
	var key = 'unknown';
	if(this.cell_type === CellType.SEED) {
		key = 'seed';
	} else if(this.cell_type === CellType.LEAF) {
		key = 'leaf';
	} else if(this.cell_type === CellType.SHOOT) {
		key = 'shoot';
	}

	counter[key] = 1 + (_.has(counter, key) ? counter[key] : 0);

	_.each(this.children, function(child) {
		child.count_type(counter);
	}, this);

	return counter;
};

// Get spherically approximated occuluders.
// return :: [(THREE.Vector3, float)]
Cell.prototype.get_occluders = function(parent_top, parent_rot) {
	return [];
};

// Add infinitesimal shoot cell.
// side :: boolean
// return :: ()
Cell.prototype.add_shoot_cont = function(side) {
	var shoot = new Cell(this.plant, CellType.SHOOT);
	shoot.core = this.core;

	var cone_angle = side ? 1.0 : 0.5;
	shoot.loc_to_parent = new THREE.Quaternion().setFromEuler(new THREE.Euler(
		(Math.random() - 0.5) * cone_angle,
		(Math.random() - 0.5) * cone_angle,
		0));

	this.add(shoot);
};

// shoot_base :: Cell
// return :: ()
Cell.prototype.add_leaf_cont = function() {
	var leaf = new Cell(this.plant, CellType.LEAF);
	leaf.core = this.core;
	leaf.loc_to_parent = new THREE.Quaternion().setFromEuler(new THREE.Euler(- Math.PI * 0.5, 0, 0));
	leaf.sx = 20e-3;
	leaf.sy = 3e-3;
	leaf.sz = 1e-3;
	this.add(leaf);
};


// Light Volume class suitable for simulating one directional light.
// This is actually a shadow map, but light energy is conserved.
// (No cheating via floating point error etc.)
// parent :: Chunk
var LightVolume = function(parent) {
	this.parent = parent;

	this.light_power = 1000;  // W/m^2 (assuming direct sunlight, all spectrum)

	// three.js world metrics
	this.z0 = 0.3;
	this.zstep = 0.1;
	this.direction = new THREE.Vector3(0, 0, -1);
	this.aperture = 0.5;

	this.n = 10;
	this.h = 5;  // height

	this.volume = new Float32Array(this.n * this.n * this.h);

	// occluders per layers
	this.occ_layers = _.map(_.range(this.h), function(z) {return [];}, this);

	// For debugging: initialize by [0,1] random values.
	_.each(_.range(this.volume.length), function(i) {
		this.volume[i] = 0;
	}, this);
};

// z :: int [0, this.h)
// return :: Float32Array[this.n^2] in Y-X order (e.g. (0,0,z), (1,0,z), ...)
LightVolume.prototype.slice = function(z) {
	if(z < 0 || z >= this.h) {
		throw "Given height is out of range.";
	}

	var n_slice = this.n * this.n;
	return this.volume.subarray(n_slice * z, n_slice * (z + 1));
};

// Fully propagate light thorough the LightVolume.
// return :: ()
LightVolume.prototype.step = function() {
	return;

	// Get occluders.
	var occs = _.flatten(_.map(this.parent.children, function(Cell) {
		return Cell.get_occluders(
			new THREE.Vector3(0, 0, 0.15 - Cell.stem_length / 2),
			new THREE.Quaternion(0, 0, 0, 1));
	}, this), true);

	// Separate occluders into layers.
	this.occ_layers = _.map(_.range(this.h), function(z) {return [];}, this);

	_.each(occs, function(occ) {
		var z = Math.floor((occ[0].z - this.z0) / this.zstep);
		if(0 <= z && z < this.h) {
			this.occ_layers[z].push(occ);
		}
	}, this);

	// inject
	var top_slice = this.slice(this.h - 1);
	_.each(_.range(this.n * this.n), function(i) {
		top_slice[i] = this.light_power;
	}, this);

	// step through layers.
	var flux_occluded = 0;
	var flux_escaped = 0;
	_.each(_.range(this.h-2, -1, -1), function(z) {
		// Bake occluders into transparency array.
		// TODO: occluder radius
		var transparency = _.map(_.range(this.n * this.n), function(i) {return 1.0;}, this);
		_.each(this.occ_layers[z+1], function(occ) {
			var center = occ[0];
			var ix = Math.floor(this.n * (center.x / this.aperture + 0.5));
			var iy = Math.floor(this.n * (center.y / this.aperture + 0.5));
			if(0 <= ix && ix < this.n && 0 <= iy && iy < this.n) {
				transparency[ix + iy * this.n] *= 0.2;
			}
		}, this);

		// Multiply with transparency and propagate.
		var slice_from = this.slice(z+1);
		var slice_to = this.slice(z);
		var tile_area = this.aperture * this.aperture / (this.n * this.n);
		if(z == 0) {
			flux_escaped = sum(slice_to) * tile_area;
		}

		_.each(_.range(this.n * this.n), function(i) {
			slice_to[i] = slice_from[i] * transparency[i];
			flux_occluded += slice_from[i] * (1 - transparency[i]) * tile_area;
		}, this);
	}, this);

	this.flux_occluded = flux_occluded;
	this.flux_escaped = flux_escaped;
};


// Get downwards lighting at given position.
// pos :: THREE.Vector3
// return :: float
LightVolume.prototype.get_down_lighting_at = function(pos) {
	var ix = Math.floor((pos.x / this.aperture + 0.5) * this.n);
	var iy = Math.floor((pos.y / this.aperture + 0.5) * this.n);
	var iz = Math.floor((pos.z - this.z0) / this.zstep);
	iz = Math.max(0, iz);  // assume empty space after LightVolume ends.

	if(ix < 0 || this.n <= ix || iy < 0 || this.n <= iy || iz < 0 || this.h <= iz) {
		return 0;
	} else {
		return this.slice(iz)[ix + this.n * iy];
	}
};

// flux :: float [0,+inf) W/m^2, total energy density
// return :: THREE.Color
LightVolume.prototype.flux_to_color = function(flux) {
	var v = flux / 1000;
	return new THREE.Color().setRGB(v, v, v);
};

// z :: int
// return :: THREE.Texture
LightVolume.prototype.generate_slice_texture = function(z) {
	var slice = this.slice(z);

	var size = 256;

	var canvas = document.createElement('canvas');
	canvas.width = size;
	canvas.height = size;

	var context = canvas.getContext('2d');

	// light volume values
	context.save();
	context.translate(0, size);
	context.scale(1, -1);
	_.each(_.range(this.n), function(y) {
		_.each(_.range(this.n), function(x) {
			var v = slice[this.n * y + x];
			var c = this.flux_to_color(v);

			// TODO: make coordinte saner
			var step = size / this.n;
			var patch_size = 3;
			context.beginPath();
			context.rect(
				(x + 0.5) * step - patch_size / 2,
				(y + 0.5) * step - patch_size / 2,
				patch_size, patch_size);
			context.fillStyle = c.getStyle();
			context.fill();
		}, this);
	}, this);
	context.restore();

	// light volume occluders
	context.save();
	context.scale(size, size);
	context.translate(0.5, 0.5);
	context.scale(1 / this.aperture, -1 / this.aperture);
	context.beginPath();
	context.lineWidth = 1e-3;
	_.each(this.occ_layers[z], function(occ) {
		var center = occ[0];
		var radius = occ[1];
		context.arc(center.x, center.y, radius, 0, 2 * Math.PI);
	});
	context.fillStyle = 'rgba(255, 0, 0, 0.2)';
	context.fill();
	context.restore();

	// stat
	context.save();
	context.translate(20, 20);
	context.beginPath();
	context.fillStyle = 'black';
	context.fillText('z=' + z + ' / ' + '#occluder=' + this.occ_layers[z].length, 0, 0);
	context.restore();

	// frame
	context.beginPath();
	context.rect(0, 0, size, size);
	context.strokeStyle = 'black';
	context.stroke();

	var tex = new THREE.Texture(canvas);
	tex.needsUpdate = true;

	return tex;
}


// Represents soil surface state by a grid.
// parent :: Chunk
var Soil = function(parent) {
	this.parent = parent;

	this.n = 10;
	this.size = 2;
};

// return :: ()
Soil.prototype.step = function() {
};

// return :: THREE.Object3D
Soil.prototype.materialize = function() {
	var soil_base = new THREE.Object3D();

	// Attach tiles to the base.
	var tex = THREE.ImageUtils.loadTexture("./texture_dirt.jpg");

	_.each(_.range(this.n), function(y) {
		_.each(_.range(this.n), function(x) {
			var p = new THREE.Vector3(
				-(x - this.n / 2 + 0.5) * this.size / this.n,
				-(y - this.n / 2 + 0.5) * this.size / this.n,
				0.01);

			var v = this.parent.light_volume.get_down_lighting_at(p) / 1000;
			var lighting = new THREE.Color().setRGB(v, v, v);

			var soil_tile = new THREE.Mesh(
				new THREE.CubeGeometry(this.size / this.n, this.size / this.n, 0.01),
				new THREE.MeshLambertMaterial({
					color: lighting,
					map: tex}));
			soil_base.add(soil_tile);
			soil_tile.position = p;
		}, this);
	}, this);

	return soil_base;
};


// Chunk world class. There's no interaction between bonsai instances,
// and Chunk just borrows scene, not owns it.
// Cells changes doesn't show up until you call re_materialize.
// re_materialize is idempotent from visual perspective.
var Chunk = function(scene) {
	this.scene = scene;

	// add pot (three.js scene)
	// dummy material
	this.land = new THREE.Object3D();
	this.land.position.z = -0.15;
	this.scene.add(this.land);

	// Soil (Cell sim)
	this.soil = new Soil(this);

	// Light (Cell sim)
	this.light_volume = new LightVolume(this);

	// Cells (Cell sim)
	// TODO: rename to Cells for easier access from soil and light_volume.
	this.children = [];
};

// flux :: float [0,+inf) W/m^2, sunlight energy density equivalent
// return :: ()
Chunk.prototype.set_flux = function(flux) {
	this.light_volume.light_power = flux;
};

// pos :: THREE.Vector3
// return :: Plant
Chunk.prototype.add_plant = function(pos) {
	console.assert(Math.abs(pos.z) < 1e-3);

	var shoot = new Plant(pos, this);
	this.children.push(shoot);

	return shoot;
};

// Cell :: Cell, must be returned by add_cell
// return :: ()
Chunk.prototype.remove_cell = function(Cell) {
	this.children = _.without(this.children, Cell);
};

// return :: object (stats)
Chunk.prototype.step = function() {
	var t0 = 0;
	var sim_stats = {};

	t0 = performance.now();
	_.each(this.children, function(Cell) {
		Cell.step();
	}, this);
	sim_stats['Cell/ms'] = performance.now() - t0;

	t0 = performance.now();
	this.light_volume.step();
	sim_stats['light/ms'] = performance.now() - t0;

	t0 = performance.now();
	this.soil.step();
	sim_stats['soil/ms'] = performance.now() - t0;

	return sim_stats;
};

// options :: dict(string, bool)
// return :: ()
Chunk.prototype.re_materialize = function(options) {
	// Throw away all children of pot.
	_.each(_.clone(this.land.children), function(three_cell_or_debug) {
		this.land.remove(three_cell_or_debug);
	}, this);

	// Materialize soil.
	var soil = this.soil.materialize();
	this.land.add(soil);

	// Materialize all Cells.
	_.each(this.children, function(Cell) {
		// Cell itself.
		var three_cell = Cell.materialize();
		three_cell.position = Cell.position.clone();
		this.land.add(three_cell);

		// Occluders.
		if(options['show_occluder']) {
			var occs = Cell.get_occluders(new THREE.Vector3(0, 0, 0.15 - Cell.stem_length / 2), new THREE.Quaternion(0, 0, 0, 1));
			_.each(occs, function(occ) {
				var three_occ = new THREE.Mesh(
					new THREE.IcosahedronGeometry(occ[1]),
					new THREE.MeshLambertMaterial({
						color: 'red'
					}));
				three_occ.position = occ[0];
				this.land.add(three_occ);
			}, this);
		}
	}, this);

	// Visualization common for all Cells.
	if(options['show_light_volume']) {
		_.each(_.range(this.light_volume.h), function(ix) {
			var slice = new THREE.Mesh(
				new THREE.PlaneGeometry(this.light_volume.aperture, this.light_volume.aperture),
				new THREE.MeshBasicMaterial({
					transparent: true,
					map: this.light_volume.generate_slice_texture(ix)}));
			slice.position.z = this.light_volume.z0 + this.light_volume.zstep * ix;
			this.land.add(slice);
		}, this);
	}
};

// xs :: [num]
// return :: num
function sum(xs) {
	return _.reduce(xs, function(x, y) { return x + y; }, 0);
}


return {
	'Chunk': Chunk
};

});  // define
