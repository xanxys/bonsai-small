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
var Plant = function() {
	this.children = [];
	// Relative rotation in parent's frame.
	this.rotation = new THREE.Euler(); // Euler angles. TODO: make it quaternion

	this.stem_length = 30e-3;
	this.stem_diameter = 1e-3;
	this.is_leaf = false;
};

// return :: bool
Plant.prototype.is_end = function() {
	return this.children.length == 0 && !this.is_leaf;
}

// sub_plant :: Plant
// return :: ()
Plant.prototype.add = function(sub_plant) {
	this.children.push(sub_plant);
};

// return :: ()
Plant.prototype.step = function() {
	_.each(this.children, function(sub_plant) {
		sub_plant.step();
	}, this);

	this.stem_length += 3e-3;

	// Monocot stems do not replicate, so there's a limit to diameter.
	// On the other hands, most dicots stem cells do replicate, so they can grow
	// indefinitely (especially trees).
	this.stem_diameter = Math.min(5e-3, this.stem_diameter + 0.1e-3);

	if (this.is_end()) {
		var z = Math.random();
		if (z < 0.1) {
			this.add_shoot_cont(false);
			this.add_leaf_cont();
		} else if(z < 0.2) {
			this.add_shoot_cont(false);
			this.add_shoot_cont(true);
		}
	}
};

// return :: THREE.Object3D
Plant.prototype.materialize = function() {
	var color_diffuse = new THREE.Color(this.is_leaf ? 'green' : 'brown');
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

	var position = new THREE.Vector3(0, 0, this.stem_length/2).add(
		new THREE.Vector3(0, 0, this.stem_length/2).applyEuler(this.rotation));

	three_plant.rotation.copy(this.rotation);
	three_plant.position.copy(position);

	_.each(this.children, function(child) {
		three_plant.add(child.materialize());
	}, this);

	return three_plant;
};

// Get total mass of this and children.
// return :: float (kg)
Plant.prototype.mass = function() {
	var density = 1000; // kg/m^3

	var volume;
	if(this.is_leaf) {
		volume = 20e-3 * 3e-3 * this.stem_length;
	} else {
		volume = Math.pow(this.stem_diameter, 2) * this.stem_length;
	}

	var children_mass = _.map(this.children, function(child) {
		return child.mass();
	});

	var this_mass = volume * density;
	return  this_mass + _.reduce(children_mass, function(x, y) { return x + y; }, 0);
};

// counter :: dict(string, int)
// return :: dict(string, int)
Plant.prototype.count_type = function(counter) {
	var key = this.is_leaf ? "leaf" : "shoot";
	counter[key] = 1 + (_.has(counter, key) ? counter[key] : 0);

	_.each(this.children, function(child) {
		child.count_type(counter);
	}, this);

	return counter;
};

// Get spherically approximated occuluders.
// return :: array((THREE.Vector3, float))
Plant.prototype.occluders = function(parent_top, parent_rot) {
	var this_rot = parent_rot.clone().multiply(new THREE.Quaternion().setFromEuler(this.rotation));
	var this_top = parent_top.clone().add(new THREE.Vector3(0, 0, this.stem_length).applyQuaternion(this_rot));
	var this_center = parent_top.clone().add(new THREE.Vector3(0, 0, 0.5 * this.stem_length).applyQuaternion(this_rot));

	var radius = (this.stem_length + this.stem_diameter) / 2;
	var occl = [this_center, radius];

	var occs = _.flatten(_.map(this.children, function(child) {
		return child.occluders(this_top, this_rot);
	}), true);
	occs.push(occl);
	return occs;
};

// Infinitesimal version of add_shoot.
// side :: boolean
// return :: ()
Plant.prototype.add_shoot_cont = function(side) {
	var shoot = new Plant();

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
	var leaf = new Plant();
	leaf.rotation = new THREE.Euler(- Math.PI * 0.5, 0, 0);
	leaf.stem_length = 1e-3;
	leaf.is_leaf = true;
	this.add(leaf);
};


// Light Volume class suitable for simulating one directional light.
var LightVolume = function() {
	// three.js world metrics
	this.z0 = 0.3;
	this.zstep = 0.1;
	this.direction = new THREE.Vector3(0, 0, -1);
	this.aperture = 0.5;

	this.n = 10;
	this.h = 5;  // height

	// TODO: use Float32Array.subarray for safer operations.
	this.buffer = new ArrayBuffer(4 * this.n * this.n * this.h);

	// occluders per layers
	this.occ_layers = _.map(_.range(this.h), function(z) {return [];}, this);

	// For debugging: initialize by [0,1] random values.
	var flat_array = new Float32Array(this.buffer);
	_.each(_.range(this.n * this.n * this.h), function(i) {
		flat_array[i] = Math.random();
	}, this);
};

// z :: int [0, this.h)
// return :: Float32Array[this.n^2] in Y-X order (e.g. (0,0,z), (1,0,z), ...)
LightVolume.prototype.slice = function(z) {
	if(z < 0 || z >= this.h) {
		throw "Given height is out of range.";
	}

	return new Float32Array(this.buffer, 4 * this.n * this.n * z, this.n * this.n);
};

// occs :: [(center, radius)] spherical occluders
// return :: ()
LightVolume.prototype.step = function(occs) {
	// Separate occluders into layers.
	this.occ_layers = _.map(_.range(this.h), function(z) {return [];}, this);

	_.each(occs, function(occ) {
		var z = Math.floor((occ[0].z - this.z0) / this.zstep);
		if(0 <= z && z < this.h) {
			this.occ_layers[z].push(occ);
		}
	}, this);

	// step
	_.each(_.range(this.h-1), function(z) {
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
		_.each(_.range(this.n * this.n), function(i) {
			slice_to[i] = slice_from[i] * transparency[i];
		}, this);
	}, this);

	// emit
	var light_strength = 1.0;
	var top_slice = this.slice(this.h - 1);
	_.each(_.range(this.n * this.n), function(i) {
		top_slice[i] = light_strength;
	}, this);
};


// Bonsai world class. There's no interaction between bonsai instances,
// and Bonsai just borrows scene, not owns it.
// Plants changes doesn't show up until you call re_materialize.
// re_materialize is idempotent from visual perspective.
var Bonsai = function(scene) {
	this.scene = scene;

	// add pot (three.js scene)
	var tex = THREE.ImageUtils.loadTexture("./texture_dirt.jpg");

	this.pot = new THREE.Mesh(
		new THREE.CubeGeometry(0.3, 0.3, 0.3),
		new THREE.MeshLambertMaterial({
			color: 'orange',
			map: tex}));
	this.pot.position.z = -0.15;
	this.scene.add(this.pot);

	// Light (plant sim)
	this.light_volume = new LightVolume();

	// Plants (plant sim)
	this.children = [];
};


// return :: Plant
Bonsai.prototype.add_plant = function() {
	var shoot = new Plant();
	this.children.push(shoot);
	return shoot;
};

// plant :: Plant, must be returned by add_plant
// return :: ()
Bonsai.prototype.remove_plant = function(plant) {
	this.children = _.without(this.children, plant);
};

// return :: ()
Bonsai.prototype.step = function() {
	var occs = _.flatten(_.map(this.children, function(plant) {
		return plant.occluders(new THREE.Vector3(0, 0, 0.15 - plant.stem_length / 2), new THREE.Quaternion(0, 0, 0, 1));
	}, this), true);

	_.each(this.children, function(plant) {
		plant.step();
	}, this);

	this.light_volume.step(occs);
};

// options :: dict(string, bool)
// return :: ()
Bonsai.prototype.re_materialize = function(options) {
	// Throw away all children of pot.
	_.each(_.clone(this.pot.children), function(three_plant_or_debug) {
		this.pot.remove(three_plant_or_debug);
	}, this);

	// Materialize all plants.
	_.each(this.children, function(plant) {
		// Plant itself.
		var three_plant = plant.materialize();
		this.pot.add(three_plant);
		three_plant.position.z += 0.15 - plant.stem_length / 2;  // hack hack

		// Occluders.
		if(options['show_occluder']) {
			var occs = plant.occluders(new THREE.Vector3(0, 0, 0.15 - plant.stem_length / 2), new THREE.Quaternion(0, 0, 0, 1));
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
					map: this.generate_light_volume_slice_texture(this.light_volume, ix)}));
			slice.position.z = this.light_volume.z0 + this.light_volume.zstep * ix;
			this.pot.add(slice);
		}, this);
	}
};

// v :: float [0,1]
// return :: THREE.Color
Bonsai.prototype.value_to_color = function(v) {
	return new THREE.Color().setRGB(v, v, v);
};

// light_volume :: LightVolume
// z :: int
// return :: THREE.Texture
Bonsai.prototype.generate_light_volume_slice_texture = function(light_volume, z) {
	var n = light_volume.n;
	var slice = light_volume.slice(z);

	var size = 256;

	var canvas = document.createElement('canvas');
	canvas.width = size;
	canvas.height = size;

	var context = canvas.getContext('2d');


	var padding = 10;

	// light volume values
	_.each(_.range(n), function(y) {
		_.each(_.range(n), function(x) {
			var v = slice[n * y + x];
			var c = this.value_to_color(v);

			// TODO: make coordinte saner
			var step = size / n;
			var patch_size = 3;
			context.beginPath();
			context.rect(
				(x + 0.5) * step - patch_size / 2, (y + 0.5) * step - patch_size / 2,
				patch_size, patch_size);
			context.fillStyle = c.getStyle();
			context.fill();
		}, this);
	}, this);

	// light volume occluders
	context.save();
	context.scale(size, size);
	context.translate(0.5, 0.5);
	context.scale(1 / light_volume.aperture, -1 / light_volume.aperture);
	context.beginPath();
	context.lineWidth = 1e-3;
	_.each(light_volume.occ_layers[z], function(occ) {
		var center = occ[0];
		var radius = occ[1];
		context.arc(center.x, center.y, radius, 0, 2 * Math.PI);
	});
	context.fillStyle = 'rgba(255, 0, 0, 0.2)';
	context.fill();
	context.restore();

	// stat
	context.save();
	context.translate(30, 30);
	context.beginPath();
	context.fillStyle = 'black';
	context.fillText('z=' + z + ' / ' + '#occluder=' + light_volume.occ_layers[z].length, 0, 0);
	context.restore();

	// frame
	context.beginPath();
	context.rect(padding, padding, size - padding * 2, size - padding * 2);
	context.strokeStyle = 'black';
	context.stroke();

	var tex = new THREE.Texture(canvas);
	tex.needsUpdate = true;

	return tex;
}




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

	ui_update_stats();

	// start canvas
	renderer = new THREE.WebGLRenderer();
	renderer.setSize(window.innerWidth, window.innerHeight);
	document.body.appendChild(renderer.domElement);

	// add mouse control (do this after canvas insertion)
	controls = new THREE.TrackballControls(camera, renderer.domElement);
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
}

/* UI Utils */
function ui_update_stats() {
	var dict = current_plant.count_type({});
	dict['mass/g'] = current_plant.mass() * 1e3;

	$('#info').text(JSON.stringify(dict, null, 2));
}

/* UI Handlers */
function handle_replant() {
	if(current_plant === null ) {
		return;
	}

	bonsai.remove_plant(current_plant);
	current_plant = bonsai.add_plant();
	bonsai.re_materialize(ui_get_debug_option());

	ui_update_stats();
}

function handle_step(n) {
	if(current_plant === null) {
		return;
	}
	_.each(_.range(n), function(i) {
		bonsai.step();
	});
	bonsai.re_materialize(ui_get_debug_option());

	ui_update_stats();
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

function dict_to_v3(d) {
	return new THREE.Vector3(d['x'], d['y'], d['z']);
}

// Generate human-readable block element from given json object.
function json_to_dom(obj) {
	return $('<div/>').text(JSON.stringify(obj));
}

function get_ms(){
	return new Date().getTime();
}
