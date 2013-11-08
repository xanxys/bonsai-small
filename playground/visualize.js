requirejs.config({
	shim: {
		'underscore': {
			exports: '_'
		},
		'three': {
			exports: 'THREE'
		}
	}
});

requirejs([
	'jquery', 'three', 'TrackballControls'],
function($, THREE, TrackballControls) {
"use strict";

// package imports for underscore
_.mixin(_.str.exports());

// Bonsai plant. This class uses THREE.Vector3 or Quaternion, but doesn't depend on
// scene, mesh, geometry etc. Instead, Plant is capable of generating Object3D instance
// given scene.
// Single plant instance corresponds roughly to Object3D.
//
// Plant grows Z+ direction when rotation is identity.
// When the Plant is a leaf,  photosynthetic plane is Y+.
// parent :: Bonsai
var Plant = function(parent, is_seed) {
	this.parent = parent;

	this.core = this;
	this.children = [];

	this.age = 0;

	// Relative rotation in parent's frame.
	this.rotation = new THREE.Euler(); // Euler angles. TODO: make it quaternion

	this.max_stress = 0.15e9; // 0.15GPa, from Schwendener 1874, Plant Physics p. 143

	this.stem_length = 30e-3;
	this.stem_diameter = 1e-3;
	this.is_leaf = false;
	this.is_seed = false;

	if(is_seed) {
		this.stem_length = 1e-3;
		this.is_seed = true;
		this.add_shoot_cont(false);
	}
};

// return :: [0,1]
Plant.prototype.growth_factor = function() {
	return this.core.growth_factor();
};

// Return max moment cylindrical plant segment (e.g. stem) can withstand.
// radius :: float (m)
// return :: moment (N*m)
Plant.prototype.max_moment = function(radius) {
	var second_moment_area = Math.PI * Math.pow(radius, 4) / 4;
	return this.max_stress * second_moment_area / radius;
};

// return :: bool
Plant.prototype.is_shoot_end = function() {
	return this.children.length == 0 && !this.is_leaf;
}

// sub_plant :: Plant
// return :: ()
Plant.prototype.add = function(sub_plant) {
	this.children.push(sub_plant);
};

// dt :: sec
// return :: ()
Plant.prototype.step = function(dt) {
	this.age += dt;

	// TODO: Use real Photosynthesis-Irradiance (PI) curve.
	// var 0.5 * 1-1/(x/100+1) // [0,+inf) -> [0,1], 0.8 @ 200
	var max_delta_mass_glucose = this.parent.light_volume.flux_occluded * 0.5 * (dt / (24 * 60 * 60));
	var max_delta_mass_total = max_delta_mass_glucose * 10;  // 90% of plant mass is water.
	var max_delta_mass = max_delta_mass_total * 0.5;  // half of them go to root system.


	_.each(this.children, function(sub_plant) {
		sub_plant.step(dt);
	}, this);

	if(!this.is_seed) {
		this.stem_length += 3e-3 * this.growth_factor();
	}

	// Monocot stems do not replicate, so there's a limit to diameter.
	// On the other hands, most dicots stem cells do replicate, so they can grow
	// indefinitely (especially trees).
	this.stem_diameter = Math.min(5e-3, this.stem_diameter + 0.1e-3 * this.growth_factor());

	var z_x = Math.random();
	if(z_x < this.growth_factor()) {
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
};

// return :: THREE.Object3D
Plant.prototype.materialize = function(attached_to_seed) {
	var color_diffuse;
	if(this.is_leaf) {
		color_diffuse = 'green';
	} else if(this.is_seed) {
		color_diffuse = 'blue';
	} else {
		color_diffuse = 'brown';
	}
	var color_ambient = color_diffuse; // .offsetHSL(0, 0, -0.3);

	var geom;
	if (this.is_leaf) {
		geom = new THREE.CubeGeometry(20e-3, 3e-3, this.stem_length);
	} else {
		geom = new THREE.CubeGeometry(this.stem_diameter, this.stem_diameter, this.stem_length);
	}

	var three_plant = new THREE.Mesh(
		geom,
		new THREE.MeshLambertMaterial({
			color: color_diffuse,
			ambient: color_ambient}));

	var position;
	if(this.is_seed) {
		position = new THREE.Vector3(0, 0, 0);
	} else if(attached_to_seed) {
		position = new THREE.Vector3(0, 0, this.stem_length/2).applyEuler(this.rotation);
	} else {
		position = new THREE.Vector3(0, 0, this.stem_length/2).add(
			new THREE.Vector3(0, 0, this.stem_length/2).applyEuler(this.rotation));
	}
	 

	three_plant.rotation.copy(this.rotation);
	three_plant.position.copy(position);

	_.each(this.children, function(child) {
		three_plant.add(child.materialize(this.is_seed));
	}, this);

	return three_plant;
};

// Get plant age in seconds.
// return :: float (sec)
Plant.prototype.get_age = function() {
	return this.age;
};

// Return received sunlight. This will not be completely accurate,
// but robust to strange geometry.
// return :: float [0,+inf) (W)
Plant.prototype.get_flux = function() {
	// TODO: DO NOT call light_volume... here. It should be stored in Plant instances
	// in step phase.
	// TODO: this is wrong when non-plant occluders or multiple plants exist.
	// TODO: what about normals?
	// TODO: Use real Photosynthesis-Irradiance (PI) curve.
	return this.parent.light_volume.flux_occluded;
}

// Get total mass of this and children.
// return :: float (kg)
Plant.prototype.get_mass = function() {
	var density = 1000; // kg/m^3

	var volume;
	if(this.is_leaf) {
		volume = 20e-3 * 3e-3 * this.stem_length;
	} else {
		volume = Math.pow(this.stem_diameter, 2) * this.stem_length;
	}

	return volume * density +
		sum(_.map(this.children, function(child) {return child.get_mass();}));
};

// counter :: dict(string, int)
// return :: dict(string, int)
Plant.prototype.count_type = function(counter) {
	var key = this.is_leaf ? "leaf" : "shoot";
	if(this.is_seed) {
		key = "seed";
	}

	counter[key] = 1 + (_.has(counter, key) ? counter[key] : 0);

	_.each(this.children, function(child) {
		child.count_type(counter);
	}, this);

	return counter;
};

// Get spherically approximated occuluders.
// return :: array((THREE.Vector3, float))
Plant.prototype.get_occluders = function(parent_top, parent_rot) {
	var this_rot = parent_rot.clone().multiply(new THREE.Quaternion().setFromEuler(this.rotation));
	var this_top = parent_top.clone().add(new THREE.Vector3(0, 0, this.stem_length).applyQuaternion(this_rot));
	var this_center = parent_top.clone().add(new THREE.Vector3(0, 0, 0.5 * this.stem_length).applyQuaternion(this_rot));

	var radius = (this.stem_length + this.stem_diameter) / 2;
	var occl = [this_center, radius];

	var occs = _.flatten(_.map(this.children, function(child) {
		return child.get_occluders(this_top, this_rot);
	}), true);
	occs.push(occl);
	return occs;
};

// Add infinitesimal shoot cell.
// side :: boolean
// return :: ()
Plant.prototype.add_shoot_cont = function(side) {
	var shoot = new Plant(this.parent);
	shoot.core = this.core;

	var cone_angle = side ? 1.0 : 0.5;
	shoot.rotation = new THREE.Euler(
		(Math.random() - 0.5) * cone_angle,
		(Math.random() - 0.5) * cone_angle,
		0);
	shoot.stem_length = 1e-3;

	this.add(shoot);
};

// shoot_base :: Plant
// return :: ()
Plant.prototype.add_leaf_cont = function() {
	var leaf = new Plant(this.parent);
	leaf.core = this.core;
	leaf.rotation = new THREE.Euler(- Math.PI * 0.5, 0, 0);
	leaf.stem_length = 1e-3;
	leaf.is_leaf = true;
	this.add(leaf);
};


// Light Volume class suitable for simulating one directional light.
// parent :: Bonsai
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
// dt :: sec
// return :: ()
LightVolume.prototype.step = function(dt) {
	// Get occluders.
	var occs = _.flatten(_.map(this.parent.children, function(plant) {
		return plant.get_occluders(
			new THREE.Vector3(0, 0, 0.15 - plant.stem_length / 2),
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
// parent :: Bonsai
var Soil = function(parent) {
	this.parent = parent;

	this.n = 4;
	this.size = 0.3;
};

// dt :: sec
// return :: ()
Soil.prototype.step = function(dt) {
};

// return :: THREE.Object3D
Soil.prototype.materialize = function() {
	var soil_base = new THREE.Mesh(
		new THREE.CubeGeometry(this.size, this.size, 0.01),
		new THREE.MeshLambertMaterial({
			color: 'black'}));

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


// Bonsai world class. There's no interaction between bonsai instances,
// and Bonsai just borrows scene, not owns it.
// Plants changes doesn't show up until you call re_materialize.
// re_materialize is idempotent from visual perspective.
//
// TODO: Supplant pot by introducing light - soil - plant interaction.
// Instead, add dummy object for creating three.js coordinate frame, and
// rename Bonsai to Chunk or something.
var Bonsai = function(scene) {
	this.scene = scene;

	// add pot (three.js scene)
	// dummy material
	this.pot = new THREE.Mesh(
		new THREE.CubeGeometry(0.3, 0.3, 0.3),
		new THREE.MeshLambertMaterial({
			color: 'blue',
			wireframe: true}));
	this.pot.position.z = -0.15;
	this.scene.add(this.pot);

	// Soil (plant sim)
	this.soil = new Soil(this);

	// Light (plant sim)
	this.light_volume = new LightVolume(this);

	// Plants (plant sim)
	// TODO: rename to plants for easier access from soil and light_volume.
	this.children = [];
};

// flux :: float [0,+inf) W/m^2, sunlight energy density equivalent
// return :: ()
Bonsai.prototype.set_flux = function(flux) {
	this.light_volume.light_power = flux;
};

// return :: Plant
Bonsai.prototype.add_plant = function() {
	var shoot = new Plant(this, true);
	shoot.core = {
		growth_factor: function() {
			return Math.exp(-shoot.age / (30 * 24 * 60 * 60));
		}
	};
	this.children.push(shoot);
	return shoot;
};

// plant :: Plant, must be returned by add_plant
// return :: ()
Bonsai.prototype.remove_plant = function(plant) {
	this.children = _.without(this.children, plant);
};

// dt :: float (sec)
// return :: object (stats)
Bonsai.prototype.step = function(dt) {
	var t0 = 0;
	var sim_stats = {};

	t0 = performance.now();
	_.each(this.children, function(plant) {
		plant.step(dt);
	}, this);
	sim_stats['plant/ms'] = performance.now() - t0;

	t0 = performance.now();
	this.light_volume.step(dt);
	sim_stats['light/ms'] = performance.now() - t0;

	t0 = performance.now();
	this.soil.step(dt);
	sim_stats['soil/ms'] = performance.now() - t0;

	return sim_stats;
};

// options :: dict(string, bool)
// return :: ()
Bonsai.prototype.re_materialize = function(options) {
	// Throw away all children of pot.
	_.each(_.clone(this.pot.children), function(three_plant_or_debug) {
		this.pot.remove(three_plant_or_debug);
	}, this);

	// Materialize soil.
	var soil = this.soil.materialize();
	this.pot.add(soil);
	soil.position.z = 0.15;

	// Materialize all plants.
	_.each(this.children, function(plant) {
		// Plant itself.
		var three_plant = plant.materialize();
		this.pot.add(three_plant);
		three_plant.position.z += 0.15;  // hack hack

		// Occluders.
		if(options['show_occluder']) {
			var occs = plant.get_occluders(new THREE.Vector3(0, 0, 0.15 - plant.stem_length / 2), new THREE.Quaternion(0, 0, 0, 1));
			_.each(occs, function(occ) {
				var three_occ = new THREE.Mesh(
					new THREE.IcosahedronGeometry(occ[1]),
					new THREE.MeshLambertMaterial({
						color: 'red'
					}));
				three_occ.position = occ[0];
				this.pot.add(three_occ);
			}, this);
		}
	}, this);

	// Visualization common for all plants.
	if(options['show_light_volume']) {
		_.each(_.range(this.light_volume.h), function(ix) {
			var slice = new THREE.Mesh(
				new THREE.PlaneGeometry(this.light_volume.aperture, this.light_volume.aperture),
				new THREE.MeshBasicMaterial({
					transparent: true,
					map: this.light_volume.generate_slice_texture(ix)}));
			slice.position.z = this.light_volume.z0 + this.light_volume.zstep * ix;
			this.pot.add(slice);
		}, this);
	}
};




/* Global variables */
var stats;
var camera, scene, renderer;
var controls;

// bonsai related
var bonsai;
var current_plant = null;

// remnant of old code
var spinner;


add_stats();
init();
animate();

function add_stats() {
	stats = new Stats();
	stats.setMode(1); // 0: fps, 1: ms

	// Align top-left
	stats.domElement.style.position = 'absolute';
	stats.domElement.style.right = '0px';
	stats.domElement.style.top = '0px';

	document.body.appendChild( stats.domElement );
}


function init() {
	camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.005, 10);
	camera.up = new THREE.Vector3(0, 0, 1);
	camera.position = new THREE.Vector3(0.3, 0.3, 0.4);
	camera.lookAt(new THREE.Vector3(0, 0, 0));

	scene = new THREE.Scene();

	var debug_plate = new THREE.Mesh(
		new THREE.PlaneGeometry(0.5, 0.5),
		new THREE.MeshBasicMaterial({
			transparent: true,
			map: THREE.ImageUtils.loadTexture('./xy_plate_debug.png')}));
	debug_plate.position.z = 0.01;
	scene.add(debug_plate);

	var sunlight = new THREE.DirectionalLight(0xffffff);
	sunlight.position.set(0, 0, 1).normalize();
	scene.add(sunlight);

	scene.add(new THREE.AmbientLight(0x333333));


	bonsai = new Bonsai(scene);
	current_plant = bonsai.add_plant();
	bonsai.re_materialize({});

	ui_update_stats({});

	// start canvas
	renderer = new THREE.WebGLRenderer();
	renderer.setSize(window.innerWidth, window.innerHeight);
	document.body.appendChild(renderer.domElement);

	// add mouse control (do this after canvas insertion)
	controls = new TrackballControls(camera, renderer.domElement);
	controls.maxDistance = 5;

	// register frame info update hook
	var opts = {
		lines: 7, // The number of lines to draw
		length: 0, // The length of each line
		width: 10, // The line thickness
		radius: 12, // The radius of the inner circle
		corners: 1, // Corner roundness (0..1)
		rotate: 0, // The rotation offset
		direction: 1, // 1: clockwise, -1: counterclockwise
		color: '#000', // #rgb or #rrggbb or array of colors
		speed: 1.5, // Rounds per second
		trail: 27, // Afterglow percentage
		shadow: false, // Whether to render a shadow
		hwaccel: false, // Whether to use hardware acceleration
		className: 'spinner', // The CSS class to assign to the spinner
		zIndex: 2e9, // The z-index (defaults to 2000000000)
		top: 'auto', // Top position relative to parent in px
		left: 'auto' // Left position relative to parent in px
	};
	var target = document.getElementById('side_info');
	spinner = new Spinner(opts);


	// Connect signals
	$('#debug_light_volume').on('click', handle_update_debug_options);
	$('#debug_occluder').on('click', handle_update_debug_options);
	$('#light_flux').change(handle_light_change);
	$('#button_replant').on('click', handle_replant);
	$('#button_step1').on('click', function(){handle_step(1);});
	$('#button_step10').on('click', function(){handle_step(10);});
}

/* UI Utils */
function ui_update_stats(sim_stat) {
	// TODO: plant stats code should be moved to Bonsai.
	var dict = current_plant.count_type({});
	dict['flux/W'] = current_plant.get_flux();
	dict['mass/g'] = current_plant.get_mass() * 1e3;
	dict['age/d'] = current_plant.get_age() / (24 * 60 * 60);

	$('#info').text(JSON.stringify(dict, null, 2));
	$('#info-sim').text(JSON.stringify(sim_stat, null, 2));
}

/* UI Handlers */
function handle_replant() {
	if(current_plant === null ) {
		return;
	}

	bonsai.remove_plant(current_plant);
	current_plant = bonsai.add_plant();
	bonsai.re_materialize(ui_get_debug_option());

	ui_update_stats({});
}

function handle_step(n) {
	if(current_plant === null) {
		return;
	}

	var sim_stat = {};
	_.each(_.range(n), function(i) {
		sim_stat = bonsai.step(24 * 60 * 60);  // step 1day
	});
	bonsai.re_materialize(ui_get_debug_option());

	ui_update_stats(sim_stat);
}

function handle_light_change() {
	bonsai.set_flux($('#light_flux').val());
}

function handle_update_debug_options() {
	bonsai.re_materialize(ui_get_debug_option());
}

function ui_get_debug_option() {
	return {
		'show_occluder': $('#debug_occluder').prop('checked'),
		'show_light_volume': $('#debug_light_volume').prop('checked')};
}

function animate() {
	stats.begin();

	// note: three.js includes requestAnimationFrame shim
	requestAnimationFrame(animate);

	renderer.render(scene, camera);
	controls.update();

	stats.end();
}

// xs :: [num]
// return :: num
function sum(xs) {
	return _.reduce(xs, function(x, y) { return x + y; }, 0);
}

});  // requirejs
