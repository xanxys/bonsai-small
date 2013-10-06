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
	this.is_leaf = false;
};

// sub_plant :: Plant
// return :: ()
Plant.prototype.add = function(sub_plant) {
	this.children.push(sub_plant);
};

// return :: ()
Plant.prototype.elongate = function() {
	this.stem_length += 0.01;

	_.each(this.children, function(sub_plant) {
		sub_plant.elongate();
	});
};

// return :: THREE.Object3D
Plant.prototype.materialize = function() {
	var color_diffuse = new THREE.Color(this.is_leaf ? 'green' : 'brown');
	var color_ambient = color_diffuse; // .offsetHSL(0, 0, -0.3);

	var geom;
	if (this.is_leaf) {
		geom = new THREE.CubeGeometry(20e-3, 3e-3, this.stem_length);
	} else {
		geom = new THREE.CubeGeometry(5e-3, 5e-3, this.stem_length);
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
	});

	return three_plant;
};

// Bonsai world class. There's no interaction between bonsai instances,
// and Bonsai just borrows scene, not owns it.
// Plants changes doesn't show up until you call re_materialize.
// re_materialize is idempotent from visual perspective.
var Bonsai = function(scene) {
	this.scene = scene;

	// add pot
	var tex = THREE.ImageUtils.loadTexture("./texture_dirt.jpg");

	this.pot = new THREE.Mesh(
		new THREE.CubeGeometry(0.3, 0.3, 0.3),
		new THREE.MeshLambertMaterial({
			color: 'orange',
			map: tex}));
	this.pot.position.z = -0.15;
	this.scene.add(this.pot);

	// Plants
	this.children = [];
};

// shoot_base :: Plant
// side :: boolean
// return :: ()
Bonsai.prototype.add_shoot_to = function(shoot_base, side) {
	var shoot = new Plant();

	var cone_angle = side ? 1.0 : 0.5;
	shoot.rotation = new THREE.Euler(
		(Math.random() - 0.5) * cone_angle,
		(Math.random() - 0.5) * cone_angle,
		0);
	shoot.stem_length = 30e-3;

	shoot_base.add(shoot);

	if(Math.random() < 0.5) {
		var z = Math.random();
		if(z < 0.4) {
			this.add_shoot_to(shoot, true);
		} else if(z < 0.7) {
			this.add_leaf_to(shoot);
		}
		this.add_shoot_to(shoot, false);
	}
};

// shoot_base :: Plant
// return :: ()
Bonsai.prototype.add_leaf_to = function(shoot_base) {
	var leaf = new Plant();
	leaf.rotation = new THREE.Euler(- Math.PI * 0.5, 0, 0);
	leaf.stem_length = 15e-3;
	leaf.is_leaf = true;
	shoot_base.add(leaf);
};

// return :: Plant
Bonsai.prototype.add_plant = function() {
	var shoot = new Plant();
	shoot.rotation.x = 0.1;

	this.add_shoot_to(shoot, false);
	this.children.push(shoot);
	return shoot;
};

// plant :: Plant, must be returned by add_plant
// return :: ()
Bonsai.prototype.remove_plant = function(plant) {
	this.children = _.without(this.children, plant);
};

// plant :: Plant, must be returned by add_plant
// return :: ()
Bonsai.prototype.elongate_plant = function(plant) {
	plant.elongate();
};

// return :: ()
Bonsai.prototype.re_materialize = function() {
	var pot = this.pot;

	// Throw away all children of pot.
	_.each(this.pot.children, function(three_plant) {
		pot.remove(three_plant);
	})

	// Materialize all plants.
	_.each(this.children, function(plant) {
		var three_plant = plant.materialize();
		pot.add(three_plant);
		three_plant.position.z += 0.15;
	});
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
	camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.005, 10 );
	camera.position.z = 0.2;
	camera.quaternion = new THREE.Quaternion(1, 1, 0, 0);

	scene = new THREE.Scene();

	var debug_plate = new THREE.Mesh(
		new THREE.PlaneGeometry(0.5, 0.5),
		new THREE.MeshBasicMaterial({
			transparent: true,
			map: THREE.ImageUtils.loadTexture('./xy_plate_debug.png')}));
	debug_plate.position.z = 0.01;
	scene.add(debug_plate);

	var sunlight = new THREE.DirectionalLight(0xffffff);
	sunlight.position.set(0.1, 0.2, 1).normalize();
	scene.add(sunlight);

	scene.add(new THREE.AmbientLight(0x333333));


	bonsai = new Bonsai(scene);
	current_plant = bonsai.add_plant();
	bonsai.re_materialize();

	// start canvas
	renderer = new THREE.WebGLRenderer();
	renderer.setSize(window.innerWidth, window.innerHeight);
	document.body.appendChild(renderer.domElement);

	// add mouse control (do this after canvas insertion)
	controls = new THREE.TrackballControls(camera, renderer.domElement);

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

/* UI Handlers */
function regrow() {
	if(current_plant === null ) {
		return;
	}

	bonsai.remove_plant(current_plant);
	current_plant = bonsai.add_plant();
	bonsai.re_materialize();
}

function step() {
	if(current_plant === null) {
		return;
	}
	bonsai.elongate_plant(current_plant);
	bonsai.re_materialize();
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
