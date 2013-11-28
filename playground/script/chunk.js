(function() {

var CellType = {
	LEAF: 1,
	SHOOT: 2,
	SHOOT_END: 3,  // Corresponds to shoot apical meristem
	FLOWER: 4  // self-pollinating, seed-dispersing
};

var convertCellTypeToKey = function(type) {
	if(type === CellType.LEAF) {
		return 'leaf';
	} else if(type === CellType.SHOOT) {
		return 'shoot';
	} else if(type === CellType.SHOOT_END) {
		return 'shoot_apex';
	} else if(type === CellType.FLOWER) {
		return 'flower';
	} else {
		return 'unknown';
	}
};

var convertCellTypeToColor = function(type) {
	if(type === CellType.LEAF) {
		return 'green';
	} else if(type === CellType.SHOOT) {
		return 'brown';
	} else if(type === CellType.SHOOT_END) {
		return 'brown';
	} else if(type === CellType.FLOWER) {
		return 'red';
	} else {
		return 'white';
	}
};


// Collections of cells that forms a "single" plant.
// This is not biologically accurate depiction of plants,
// (e.g. vegetative growth, physics)
// Most plants seems to have some kind of information sharing system within them
// via transportation of regulation growth factors.
//
// 100% efficiency, 0-latency energy storage and transportation within Plant.
// (n.b. energy = power * time)
//
// position :: THREE.Vector3<World>
var Plant = function(position, unsafe_chunk, energy) {
	this.unsafe_chunk = unsafe_chunk;

	this.age = 0;
	this.position = position;

	this.energy = energy;
	this.seed = new Cell(this, CellType.SHOOT_END);
};

Plant.prototype.step = function() {
	// Step cells
	this.age += 1;
	var step_cell_recursive = function(cell) {
		cell.step();
		_.each(cell.children, step_cell_recursive);
	}
	step_cell_recursive(this.seed);

	console.assert(this.seed.age === this.age);

	// Consume/store in-Plant energy.
	this.energy += this._powerForPlant() * 1;

	if(this.energy <= 0) {
		// die
		this.unsafe_chunk.remove_plant(this);
	}
};

// Approximates lifetime of the plant.
// Max growth=1, zero growth=0.
// return :: [0,1]
Plant.prototype.growth_factor = function() {
	return Math.exp(-this.age / 20);
};

// return :: THREE.Object3D<world>
Plant.prototype.materialize = function(merge) {
	var three_plant = this.seed.materialize();

	// TODO: maybe merge should be moved to Chunk, since it's UI-specific.
	if(merge) {
		// Merge everything
		var merged_geom = new THREE.Geometry();
		three_plant.traverse(function(child) {
			if(child.parent){
				child.updateMatrixWorld();
				child.applyMatrix(child.parent.matrixWorld);    
			}

			if(child instanceof THREE.Mesh) {
				THREE.GeometryUtils.merge(merged_geom, child);
			}
		});

		var merged_plant = new THREE.Mesh(
			merged_geom,
			new THREE.MeshLambertMaterial({vertexColors: THREE.VertexColors}));

		merged_plant.position = this.position;
		return merged_plant;
	} else {
		three_plant.position = this.position;
		return three_plant;
	}
};

Plant.prototype.get_stat = function() {
	var stat = this.seed.count_type({});
	stat['age/T'] = this.age;
	stat['stored/E'] = this.energy;
	stat['delta/(E/T)'] = this._powerForPlant();
	return stat;
};

Plant.prototype._powerForPlant = function() {
	var sum_power_cell_recursive = function(cell) {
		return cell.powerForPlant() +
			sum(_.map(cell.children, sum_power_cell_recursive));
	};
	return sum_power_cell_recursive(this.seed);
}

// Cell's local coordinates is symmetric for X,Y, but not Z.
// Normally Z is growth direction, assuming loc_to_parent to near to identity.
//
//  Power Generation (<- Light):
//    sum of photosynthesis (LEAF)
//  Power Consumption:
//    basic (minimum cell volume equivalent)
//    linear-volume
var Cell = function(plant, cell_type) {
	// tracer
	this.age = 0;

	// in-sim (light)
	this.photons = 0;

	// in-sim (phys + bio)
	this.loc_to_parent = new THREE.Quaternion();
	this.sx = 1e-3;
	this.sy = 1e-3;
	this.sz = 1e-3;

	// in-sim (bio)
	this.cell_type = cell_type;
	this.plant = plant;
	this.children = [];
	this.power = 0;
};

// sub_cell :: Cell
// return :: ()
Cell.prototype.add = function(sub_cell) {
	this.children.push(sub_cell);
};

// Return net usable power for Plant.
// return :: float<Energy>
Cell.prototype.powerForPlant = function() {
	return this.power;
};

Cell.prototype._updatePowerForPlant = function() {
	var total = 0;

	if(this.cell_type === CellType.LEAF) {
		total += this.photons * 1e-9 * 3000;
	}

	// basic consumption (stands for DNA-related func.)
	total -= 1e-9;

	// linear-volume consumption (stands for cell substrate maintainance)
	var volume_consumption = 1.0;
	if(this.cell_type === CellType.SHOOT) {
		volume_consumption = 1;
	} else {
		// Functional cells (LEAF, SAM, FLOWER) consume more energy to be alive.
		// TODO: separate cell traits and cell type
		volume_consumption = 2;
	}
	total -= this.sx * this.sy * this.sz * volume_consumption;
	
	this.power = total;
	this.photons = 0;
};

// return :: ()
Cell.prototype.step = function() {
	this.age += 1;

	// Grow continually.
	if(this.cell_type === CellType.FLOWER) {
		this.sx = Math.min(10e-3, this.sx + 0.1e-3);
		this.sy = Math.min(10e-3, this.sy + 0.1e-3);
		this.sz = Math.min(5e-3, this.sz + 0.1e-3);
	} else if(this.cell_type === CellType.LEAF) {
		this.sx = Math.min(15e-3, this.sx + 0.5e-3);
		this.sy = Math.min(2e-3, this.sy + 0.1e-3);
		this.sz = Math.min(40e-3, this.sz + 2e-3);
	} else {
		this.sx = Math.min(5e-3, this.sx + 0.1e-3 * this.plant.growth_factor());
		this.sy = Math.min(5e-3, this.sy + 0.1e-3 * this.plant.growth_factor());
		this.sz += 3e-3 * this.plant.growth_factor();
	}
	
	// Divide.
	var z_x = Math.random();
	if(z_x < this.plant.growth_factor()) {
		if(this.cell_type === CellType.SHOOT_END) {
			var z = Math.random();
			if(z < 0.1) {
				this.add_shoot_cont(false);
				this.add_leaf_cont();
				this.cell_type = CellType.SHOOT;
			} else if(z < 0.2) {
				this.add_shoot_cont(false);
				this.add_shoot_cont(true);
				this.cell_type = CellType.SHOOT;
			}
		}
	}

	if(this.cell_type === CellType.FLOWER) {
		// Disperse seed once in a while.
		// TODO: this should be handled by physics, not biology.
		// Maybe dead cells with stored energy survives when fallen off.
		if(Math.random() < 0.01) {
			var seed_energy = Math.min(this.plant.energy, Math.pow(20e-3, 3) * 10);

			this.plant.unsafe_chunk.add_plant(new THREE.Vector3(
				this.plant.position.x + Math.random() * 1 - 0.5,
				this.plant.position.y + Math.random() * 1 - 0.5,
				0
				), seed_energy);
			this.plant.energy -= seed_energy;
		}
	}

	// Differentiate.
	if(this.plant.growth_factor() < 0.1 && this.cell_type === CellType.SHOOT_END) {
		this.cell_type = CellType.FLOWER;
	}

	// Update power
	this._updatePowerForPlant();
};

// return :: THREE.Object3D
Cell.prototype.materialize = function() {
	// Create cell object [-sx/2,sx/2] * [-sy/2,sy/2] * [0, sz]
	var color_diffuse = new THREE.Color(convertCellTypeToColor(this.cell_type));
	if(this.photons === 0) {
		color_diffuse.offsetHSL(0, 0, -0.2);
	}

	var geom_cube = new THREE.CubeGeometry(this.sx, this.sy, this.sz);
	for(var i = 0; i < geom_cube.faces.length; i++) {
		for(var j = 0; j < 3; j++) {
			geom_cube.faces[i].vertexColors[j] = color_diffuse;
		}
	}

	var object_cell = new THREE.Mesh(
		geom_cube,
		new THREE.MeshLambertMaterial({
			vertexColors: THREE.VertexColors}));

	object_cell.position.z = this.sz / 2;

	// Create children coordinates frame.
	var object_frame_children = new THREE.Object3D();
	object_frame_children.position.z += this.sz;

	// Create cell coordinates frame.
	var object_frame = new THREE.Object3D();
	object_frame.quaternion = this.loc_to_parent.clone();  // TODO: is this ok?
	object_frame.add(object_cell);
	object_frame.add(object_frame_children);

	// Add children.
	_.each(this.children, function(child) {
		object_frame_children.add(child.materialize());
	}, this);

	// Add cell interaction slot.
	object_cell.cell = this;

	return object_frame;
};

Cell.prototype.givePhoton = function() {
	this.photons += 1;
};

// Get Cell age in ticks.
// return :: int (tick)
Cell.prototype.get_age = function() {
	return this.age;
};

// counter :: dict(string, int)
// return :: dict(string, int)
Cell.prototype.count_type = function(counter) {
	var key = convertCellTypeToKey(this.cell_type);

	counter[key] = 1 + (_.has(counter, key) ? counter[key] : 0);

	_.each(this.children, function(child) {
		child.count_type(counter);
	}, this);

	return counter;
};

// Add infinitesimal shoot cell.
// side :: boolean
// return :: ()
Cell.prototype.add_shoot_cont = function(side) {
	var shoot = new Cell(this.plant, CellType.SHOOT_END);

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

	leaf.loc_to_parent = new THREE.Quaternion().setFromEuler(new THREE.Euler(- Math.PI * 0.5, 0, 0));
	this.add(leaf);
};


// Represents soil surface state by a grid.
// parent :: Chunk
// size :: float > 0
var Soil = function(parent, size) {
	this.parent = parent;

	this.n = 25;
	this.size = size;
};

// return :: ()
Soil.prototype.step = function() {
};

// return :: THREE.Object3D
Soil.prototype.materialize = function() {
	// Create texture.
	var canvas = document.createElement('canvas');
	canvas.width = this.n;
	canvas.height = this.n;
	var context = canvas.getContext('2d');
	_.each(_.range(this.n), function(y) {
		_.each(_.range(this.n), function(x) {
			var v = this.parent.light.shadow_map[x + y * this.n] > 1e-3 ? 0.1 : 0.5;
			var lighting = new THREE.Color().setRGB(v, v, v);

			context.fillStyle = lighting.getStyle();
			context.fillRect(x, this.n - y, 1, 1);
		}, this);
	}, this);

	// Attach tiles to the base.
	var tex = new THREE.Texture(canvas);
	tex.needsUpdate = true;

	var soil_plate = new THREE.Mesh(
		new THREE.CubeGeometry(this.size, this.size, 1e-3),
		new THREE.MeshBasicMaterial({
			map: tex
		}));
	return soil_plate;
};

// Downward directional light.
var Light = function(chunk, size) {
	this.chunk = chunk;

	this.n = 25;
	this.size = size;

	this.shadow_map = new Float32Array(this.n * this.n);
};

Light.prototype.step = function() {
	this.updateShadowMap();


};

Light.prototype.updateShadowMap = function() {
	var dummy = new THREE.Scene();
	_.each(this.chunk.children, function(plant) {
		dummy.add(plant.materialize(false));
	});
	// We need this call since dummy doesn't belong to render path,
	// so world matrix (used by raycaster) isn't automatically updated.
	dummy.updateMatrixWorld();

	for(var i = 0; i < this.n; i++) {
		for(var j = 0; j < this.n; j++) {
			var isect = new THREE.Raycaster(
				new THREE.Vector3(
					(i / this.n - 0.5) * this.size,
					(j / this.n - 0.5) * this.size,
					10),
				new THREE.Vector3(0, 0, -1),
				0.1,
				1e2).intersectObject(dummy, true);

			if(isect.length > 0) {
				isect[0].object.cell.givePhoton();
				this.shadow_map[i + j * this.n] = isect[0].point.z;
			} else {
				this.shadow_map[i + j * this.n] = 0;
			}
		}
	}
};



// Chunk world class. There's no interaction between bonsai instances,
// and Chunk just borrows scene, not owns it.
// Cells changes doesn't show up until you call re_materialize.
// re_materialize is idempotent from visual perspective.
var Chunk = function(scene) {
	this.scene = scene;

	// tracer
	this.age = 0;

	// dummy material
	this.land = new THREE.Object3D();
	this.scene.add(this.land);

	// Chunk spatail
	this.size = 0.5;

	// Soil (Cell sim)
	this.soil = new Soil(this, this.size);

	// Light
	this.light = new Light(this, this.size);

	// Cells (Cell sim)
	// TODO: rename to Cells for easier access from soil and light_volume.
	this.children = [];
};

// pos :: THREE.Vector3
// return :: Plant
Chunk.prototype.add_plant = function(pos, energy) {
	console.assert(Math.abs(pos.z) < 1e-3);

	// Torus-like boundary
	pos = new THREE.Vector3(
		(pos.x + 1.5 * this.size) % this.size - this.size / 2,
		(pos.y + 1.5 * this.size) % this.size - this.size / 2,
		pos.z);

	var shoot = new Plant(pos, this, energy);
	this.children.push(shoot);

	return shoot;
};

// Plant :: must be returned by add_plant
// return :: ()
Chunk.prototype.remove_plant = function(plant) {
	this.children = _.without(this.children, plant);
};

// return :: dict
Chunk.prototype.get_stat = function() {
	var stored_energy = sum(_.map(this.children, function(plant) {
		return plant.energy;
	}));

	return {
		'age/T': this.age,
		'plant': this.children.length,
		'stored/E': stored_energy
	};
};

// return :: object (stats)
Chunk.prototype.step = function() {
	this.age += 1;

	var t0 = 0;
	var sim_stats = {};

	t0 = performance.now();
	_.each(this.children, function(plant) {
		plant.step();
	}, this);
	sim_stats['plant/ms'] = performance.now() - t0;

	t0 = performance.now();
	this.light.step();
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

	// Materialize all Plant.
	_.each(this.children, function(plant) {
		this.land.add(plant.materialize(true));
	}, this);
};

// xs :: [num]
// return :: num
function sum(xs) {
	return _.reduce(xs, function(x, y) { return x + y; }, 0);
}

this.Chunk = Chunk;

})(this);
