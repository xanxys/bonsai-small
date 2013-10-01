"use strict";

// package imports for underscore
_.mixin(_.str.exports());

// Bonsai world class. There's no interaction between bonsai instances,
// and Bonsai just borrows scene, not owns it.
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

};

// shoot_base :: THREE.Object3D
// side :: boolean
// return :: ()
Bonsai.prototype.add_shoot_to = function(shoot_base, side) {
	var shoot = new THREE.Mesh(
	new THREE.CubeGeometry(5e-3, 5e-3, 30e-3),
	new THREE.MeshLambertMaterial({color: 'green'}));

	var cone_angle = side ? 1.0 : 0.5;
	shoot.rotation.x = (Math.random() - 0.5) * cone_angle;
	shoot.rotation.y = (Math.random() - 0.5) * cone_angle;
	shoot.position = new THREE.Vector3(0, 0, 15e-3).add(
		new THREE.Vector3(0, 0, 15e-3).applyEuler(shoot.rotation));
	shoot_base.add(shoot);

	if(Math.random() < 0.5) {
		if(Math.random() < 0.4) {
			this.add_shoot_to(shoot, true);
		}
		this.add_shoot_to(shoot, false);
	}
};

// return :: THREE.Object3D
Bonsai.prototype.add_plant = function() {
	var shoot = new THREE.Mesh(
		new THREE.CubeGeometry(5e-3, 5e-3, 30e-3),
		new THREE.MeshLambertMaterial({color: 'green'}));
	shoot.position.z = 0.15 + 15e-3;
	shoot.rotation.x = 0.1;
	this.pot.add(shoot);

	this.add_shoot_to(shoot, false);
	return shoot;
};

// plant :: THREE.Object3D, must be returned by add_plant
// return :: ()
Bonsai.prototype.remove_plant = function(plant) {
	this.pot.remove(plant);
};


/* Global variables */
var stats;
var camera, scene, renderer;
var controls;

// bonsai related
var bonsai;
var current_plant = null;

// remnant of old code
var rot_box;
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

	// add whatever box
	rot_box = new THREE.Mesh(
		new THREE.CubeGeometry(0.3, 0.3, 0.3),
		new THREE.MeshBasicMaterial({
			color: 0xff0000,
			wireframe: true}));
	scene.add( rot_box );

	var sunlight = new THREE.DirectionalLight(0xffffff);
	sunlight.position.set(0.1, 0.2, 1).normalize();
	scene.add(sunlight);


	bonsai = new Bonsai(scene);
	current_plant = bonsai.add_plant();

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

function regrow() {
	if(current_plant === null ) {
		return;
	}

	bonsai.remove_plant(current_plant);
	current_plant = bonsai.add_plant();
}

function animate() {
	stats.begin();

	// note: three.js includes requestAnimationFrame shim
	requestAnimationFrame(animate);

	rot_box.rotation.x += 0.01;
	rot_box.rotation.y += 0.02;
	rot_box.position.z = 0.5;


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
