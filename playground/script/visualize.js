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
	'jquery', 'three', 'TrackballControls', 'bonsai'],
function($, THREE, TrackballControls, bonsai) {
"use strict";

// package imports for underscore
_.mixin(_.str.exports());


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


	bonsai = new bonsai.Bonsai(scene);
	current_plant = bonsai.add_plant();
	bonsai.re_materialize({});

	ui_update_stats({});

	// start canvas
	renderer = new THREE.WebGLRenderer();
	renderer.setSize(window.innerWidth, window.innerHeight);
	$('#main').append(renderer.domElement);

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
	dict['age/tick'] = current_plant.get_age();

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
		sim_stat = bonsai.step();
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

});  // requirejs
