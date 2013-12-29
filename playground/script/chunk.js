(function() {

var now = function() {
	if(typeof performance !== 'undefined') {
		return performance.now();
	} else {
		return new Date().getTime();
	}
};

var CellType = {
	LEAF: 1,
	SHOOT: 2,
	SHOOT_END: 3,  // Corresponds to shoot apical meristem
	FLOWER: 4,  // self-pollinating, seed-dispersing

	// This is not cell type
	GROWTH_FACTOR: 5,
	ANTI_GROWTH_FACTOR: 6,
	HALF: 7
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

var Differentiation = {
	SHOOT_MAIN: 1,
	SHOOT_SUB: 2,
	LEAF: 3,
};


var Genome = function() {
	this.discrete = [
		{
			"tracer_desc": "Produce leaf.",
			"when": [
				CellType.SHOOT_END, CellType.GROWTH_FACTOR, CellType.HALF, CellType.HALF, CellType.HALF],
			"become": CellType.SHOOT,
			"produce": [
				Differentiation.SHOOT_MAIN,
				Differentiation.LEAF,
			]
		},
		{
			"tracer_desc": "Produce branch.",
			"when": [
				CellType.SHOOT_END, CellType.GROWTH_FACTOR, CellType.HALF, CellType.HALF],
			"become": CellType.SHOOT,
			"produce": [
				Differentiation.SHOOT_MAIN,
				Differentiation.SHOOT_SUB,
			],
		},
		{
			"tracer_desc": "Stop growing and change to flower.",
			"become": CellType.FLOWER,
			"when": [
				CellType.SHOOT_END, CellType.ANTI_GROWTH_FACTOR, CellType.HALF, CellType.HALF],
			"produce": [],
		},
	];
};

// return :: int
Genome.prototype.getComplexity = function() {
	return sum(_.map(this.discrete, function(gene) {
		return
			2 +  // "TATA box"
			gene["when"].length +
			1 +  // become
			gene["produce"].length;
	}));
};

// Clone "naturally" with mutations.
// Since real bio is too complex, use a simple rule that can
// diffuse into all states.
// return :: Genome
Genome.prototype.naturalClone = function() {
	var _this = this;

	var genome = new Genome();
	genome.discrete = this._shuffle(this.discrete,
		function(gene) {
			return _this._naturalCloneGene(gene, '');
		},
		function(gene) {
			return _this._naturalCloneGene(gene, '/Duplicated/');
		});
	return genome;
};

// flag :: A text to attach to description tracer.
// return :: Genome.gene
Genome.prototype._naturalCloneGene = function(gene_old, flag) {
	var _this = this;

	var gene = {};
	
	gene["when"] = this._shuffle(gene_old["when"],
		function(ix) { return _this._naturalCloneId(ix); },
		function(ix) { return _this._naturalCloneId(ix); });
	gene["become"] = this._naturalCloneId(gene_old["become"]);
	gene["produce"] = this._shuffle(gene_old["produce"],
		function(ix_to) { return _this._naturalCloneId(ix_to); },
		function(ix_to) { return _this._naturalCloneId(ix_to); });

	gene["tracer_desc"] = flag + gene_old["tracer_desc"];
	return gene;
};

Genome.prototype._naturalCloneId = function(id) {
	if(Math.random() > 0.01) {
		return id;
	} else {
		return Math.floor(Math.random() * 10);
	}
};

Genome.prototype._shuffle = function(array, modifier_normal, modifier_dup) {
	var result = [];

	// 1st pass: Copy with occasional misses.
	_.each(array, function(elem) {
		if(Math.random() > 0.01) {
			result.push(modifier_normal(elem));
		}
	});

	// 2nd pass: Occasional duplications.
	_.each(array, function(elem) {
		if(Math.random() < 0.01) {
			result.push(modifier_dup(elem));
		}
	});

	return result;
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
var Plant = function(position, unsafe_chunk, energy, genome, plant_id) {
	this.unsafe_chunk = unsafe_chunk;

	// tracer
	this.age = 0;
	this.id = plant_id;

	// physics
	this.position = position;

	// biophysics
	this.energy = energy;
	this.seed = new Cell(this, CellType.SHOOT_END);
	//this.seed.loc_to_parent = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.random() * 2 * Math.PI);

	// genetics
	this.genome = genome;
};

Plant.prototype._validate_depth = function() {
	return this.seed._depth(0, []);
};

Plant.prototype.step = function() {
	//this._validate_depth();

	// Step cells (w/o collecting/stepping separation, infinite growth will occur)
	this.age += 1;
	var all_cells = [];
	var collect_cell_recursive = function(cell) {
		all_cells.push(cell);
		_.each(cell.children, collect_cell_recursive);
	}
	collect_cell_recursive(this.seed);

	_.each(all_cells, function(cell) {
		cell.step();
	});
	
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

Plant.prototype.get_genome = function() {
	return this.genome.discrete;
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

Cell.prototype._depth = function(i, ls) {
	// Cycle check.
	_.each(ls, function(l) {
		if(l === this) {
			this.children = ['Truncated'];

			throw {
				message: {
					text: 'Cyclic Plant. Aborting.',
					id: this.plant.id,
					genome: this.plant.genome,
					plant: this.plant,
				}
			};
		}
	}, this);

	// Depth check.
	if(i > 100) {
		this.children = ['Truncated'];

		throw {
			message: {
				text: 'Too deep Plant. Aborting.',
				id: this.plant.id,
				genome: this.plant.genome,
				plant: this.plant,
			}
		};
	}

	ls.push(this);

	_.each(this.children, function(cell) {
		return cell._depth(i + 1, ls);
	});
};

// sub_cell :: Cell
// return :: ()
Cell.prototype.add = function(sub_cell) {
	if(this === sub_cell) {
		throw new Error("Tried to add itself as child.", sub_cell);
	} else {
		this.children.push(sub_cell);
	}
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

	// basic consumption (stands for common func.)
	total -= 1e-9;

	// DNA consumption
	total -= 1e-9 * this.plant.genome.getComplexity();

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
	var _this = this;
	this.age += 1;

	// Grow continually.
	// TODO: these should also be included in Genome, but keep it as is.
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

	var rule_differentiate = this.plant.genome.discrete;

	function calc_prob(when) {
		var prob = 1;
		_.each(when, function(term) {
			if(term === CellType.HALF) {
				prob *= 0.5;
			} else if(term === CellType.GROWTH_FACTOR) {
				prob *= _this.plant.growth_factor();
			} else if(term === CellType.ANTI_GROWTH_FACTOR) {
				prob *= 1 - _this.plant.growth_factor();
			} else if(term === _this.cell_type) {
				prob *= 1;
			} else {
				prob *= 0;
			}
		});
		return prob;
	}

	_.each(rule_differentiate, function(clause) {
		if(calc_prob(clause['when']) > Math.random()) {
			_.each(clause['produce'], function(diff) {
				if(diff === Differentiation.SHOOT_MAIN) {
					_this.add_shoot_cont(false);
				} else if(diff === Differentiation.SHOOT_SUB) {
					_this.add_shoot_cont(true);
				} else if(diff === Differentiation.LEAF) {
					_this.add_leaf_cont();
				}
			});
			_this.cell_type = clause['become'];
		}
	});

	// Physics
	if(this.cell_type === CellType.FLOWER) {
		// Disperse seed once in a while.
		// TODO: this should be handled by physics, not biology.
		// Maybe dead cells with stored energy survives when fallen off.
		if(Math.random() < 0.01) {
			var seed_energy = Math.min(this.plant.energy, Math.pow(20e-3, 3) * 10);

			// TODO: should be world coodinate of the flower
			this.plant.unsafe_chunk.disperse_seed_from(new THREE.Vector3(
				this.plant.position.x,
				this.plant.position.y,
				0.1
				), seed_energy, this.plant.genome.naturalClone());
			this.plant.energy -= seed_energy;
		}
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
	if(this.plant.energy < 1e-4) {
		var t = 1 - this.plant.energy * 1e4;
		color_diffuse.offsetHSL(0, -t, 0);
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
	var canvas = this._generateTexture();

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

Soil.prototype.serialize = function() {
	var array = [];
	_.each(_.range(this.n), function(y) {
		_.each(_.range(this.n), function(x) {
			var v = this.parent.light.shadow_map[x + y * this.n] > 1e-3 ? 0.1 : 0.5;
			array.push(v);
		}, this);
	}, this);
	return {
		luminance: array,
		n: this.n,
		size: this.size
	};
};

// return :: Canvas
Soil.prototype._generateTexture = function() {
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
	return canvas;
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
	this.new_plant_id = 0;

	// dummy material
	this.land = new THREE.Object3D();
	this.scene.add(this.land);

	// Chunk spatail
	this.size = 0.5;

	// Soil (Cell sim)
	this.soil = new Soil(this, this.size);
	this.seeds = [];

	// Light
	this.light = new Light(this, this.size);

	// Cells (Cell sim)
	// TODO: rename to Cells for easier access from soil and light_volume.
	this.children = [];
};

// Add standard plant seed.
Chunk.prototype.add_default_plant = function(pos) {
	return this.add_plant(
		pos,
		Math.pow(20e-3, 3) * 100, // allow 2cm cube for 100T)
		new Genome());
};

// pos :: THREE.Vector3 (z must be 0)
// energy :: Total starting energy for the new plant.
// genome :: genome for new plant
// return :: Plant
Chunk.prototype.add_plant = function(pos, energy, genome) {
	console.assert(Math.abs(pos.z) < 1e-3);

	// Torus-like boundary
	pos = new THREE.Vector3(
		(pos.x + 1.5 * this.size) % this.size - this.size / 2,
		(pos.y + 1.5 * this.size) % this.size - this.size / 2,
		pos.z);

	var shoot = new Plant(pos, this, energy, genome, this.new_plant_id);
	this.new_plant_id += 1;
	this.children.push(shoot);

	return shoot;
};

// pos :: THREE.Vector3
// return :: ()
Chunk.prototype.disperse_seed_from = function(pos, energy, genome) {
	console.assert(pos.z >= 0);
	// Discard seeds thrown from too low altitude.
	if(pos.z < 0.01) {
		return;
	}

	var angle = Math.PI / 3;

	var sigma = Math.tan(angle) * pos.z;

	// TODO: Use gaussian 
	var dx = sigma * 2 * (Math.random() - 0.5);
	var dy = sigma * 2 * (Math.random() - 0.5);

	this.seeds.push({
		pos: new THREE.Vector3(pos.x + dx, pos.y + dy, 0),
		energy: energy,
		genome: genome
	});
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

// Retrieve current statistics about specified plant id.
// id :: int (plant id)
// return :: dict | null
Chunk.prototype.get_plant_stat = function(id) {
	var stat = null;
	_.each(this.children, function(plant) {
		if(plant.id === id) {
			stat = plant.get_stat();
		}
	});
	return stat;
};

// return :: array | null
Chunk.prototype.get_plant_genome = function(id) {
	var genome = null;
	_.each(this.children, function(plant) {
		if(plant.id === id) {
			genome = plant.get_genome();
		}
	});
	return genome;
};

// return :: object (stats)
Chunk.prototype.step = function() {
	this.age += 1;

	var t0 = 0;
	var sim_stats = {};

	t0 = now();
	_.each(this.children, function(plant) {
		plant.step();
	}, this);

	_.each(this.seeds, function(seed) {
		this.add_plant(seed.pos, seed.energy, seed.genome);
	}, this);
	this.seeds = [];
	sim_stats['plant/ms'] = now() - t0;

	t0 = now();
	this.light.step();
	sim_stats['light/ms'] = now() - t0;

	t0 = now();
	this.soil.step();
	sim_stats['soil/ms'] = now() - t0;

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


Chunk.prototype.serialize = function() {
	var ser = {};
	ser['plants'] = _.map(this.children, function(plant) {
		var mesh = plant.materialize(true);

		return {
			'id': plant.id,
			'vertices': mesh.geometry.vertices,
			'faces': mesh.geometry.faces,
			'position': {
				x: mesh.position.x,
				y: mesh.position.y,
				z: mesh.position.z
			}
		};
	}, this);
	ser['soil'] = this.soil.serialize();

	return ser;
};

// xs :: [num]
// return :: num
function sum(xs) {
	return _.reduce(xs, function(x, y) {
		return x + y;
	}, 0);
}

this.Chunk = Chunk;

})(this);
