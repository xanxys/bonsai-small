"use strict";

// package imports for underscore
_.mixin(_.str.exports());

var stats;
var camera, scene, renderer;
var controls;
var base_timestamp = 0;

var cursor, rot_box;

var g_frames;

var new_fetch_param = null;
var last_fetched_param = null;
var spinner;

// Bonsai world class. There's no interaction between bonsai instances,
// and Bonsai just borrows scene, not owns it.
var Bonsai = function(scene) {
	this.scene = scene;

	// add pot
	this.pot = new THREE.Mesh(
		new THREE.CubeGeometry(0.3, 0.3, 0.3),
		new THREE.MeshLambertMaterial({color: 'orange'}));
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

// bonsai instance
var bonsai;
var current_plant = null;



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

	// add cursor
	cursor = new THREE.Mesh(
		new THREE.CubeGeometry(0.1, 0.1, 0.1),
		new THREE.MeshBasicMaterial({color: 'red'}));
//	scene.add(cursor);

	// start canvas
	renderer = new THREE.WebGLRenderer();
	renderer.setSize(window.innerWidth, window.innerHeight);
	document.body.appendChild(renderer.domElement);

	// add mouse control (do this after canvas insertion)
	controls = new THREE.TrackballControls(camera, renderer.domElement);

	// add UI hooks
	$('#timestamp_slider').change(function(ev){
		set_timestamp(parseFloat(ev.target.value));
	});

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
	window.setInterval(update_frameinfo, 1000);
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
	requestAnimationFrame( animate );

	rot_box.rotation.x += 0.01;
	rot_box.rotation.y += 0.02;
	rot_box.position.z = 0.5;


	renderer.render( scene, camera );
	controls.update();

	stats.end();
}


function update_timestamp(ev) {
	console.log(ev);
}

function dict_to_v3(d) {
	return new THREE.Vector3(d['x'], d['y'], d['z']);
}

function set_base_timestamp(ts) {
	base_timestamp = ts;
	$('#base_timestamp').text('+' + _.numberFormat(ts, 3) + 's');
}

function set_timestamp(t) {
	if(g_frames === undefined)
		return;

	var ix = _.sortedIndex(g_frames, {timestamp: t+base_timestamp}, 'timestamp');
	cursor.position = dict_to_v3(g_frames[Math.min(ix, g_frames.length-1)]['pos']);

	var t_start = (ix > 0)? g_frames[ix-1]['timestamp'] : null;
	var t_end = (ix < g_frames.length) ? g_frames[ix]['timestamp'] : null;

	new_fetch_param = {
		start: t_start,
		end: t_end,
		interval: 0.01
	};

	spinner.spin($('#side_info')[0]);
}

// Generate human-readable block element from given json object.
function json_to_dom(obj) {
	return $('<div/>').text(JSON.stringify(obj));
}

function update_frameinfo() {
	// Skip update if not changed.
	if(new_fetch_param === last_fetched_param || new_fetch_param === null)
		return;

	// Refresh otherwise.
	var dataset_name = 'rgbd_dataset_freiburg1_room';
	$.getJSON('/a/trajectory/' + dataset_name, new_fetch_param, function(data) {
		last_fetched_param = new_fetch_param;
		spinner.stop();

		$('#frame_info').text(
			_.numberFormat(new_fetch_param['start'] - base_timestamp, 3));
		$('#frame_info').append(json_to_dom(data['frames'][0]));
	});
}


function get_ms(){
	return new Date().getTime();
}

function add_frames(frames) {
	g_frames = frames;

	// apply UI
	set_base_timestamp(frames[0]['timestamp']);
	$('#timestamp_slider').attr('min', 0);
	$('#timestamp_slider').attr('max', _.last(frames)['timestamp'] - base_timestamp);
	$('#timestamp_slider').attr('step', 0.01);

	// add objects
	var pt_mat = new THREE.MeshBasicMaterial({color: 'green'});
	var pt_array = [];
	var xgeom = new THREE.Geometry();

	_.each(frames, function(frame) {
		var geom = new THREE.IcosahedronGeometry(0.05);
		var obj = new THREE.Mesh(geom, pt_mat);
		obj.position = dict_to_v3(frame['pos']);
		scene.add(obj);

		pt_array.push([frame['pos']['x'], frame['pos']['y'], frame['pos']['z']])
	});


	var spline = new THREE.Spline();
	spline.initFromArray(pt_array);

	spline.reparametrizeByArcLength(200);
	xgeom.vertices = spline.points;

	var sp_mat = new THREE.LineBasicMaterial({color: 'black', linewidth:2});


	scene.add(new THREE.Line(xgeom, sp_mat, THREE.LineStrip));

	// add initial & last timestamps
	_.each([_.first, _.last], function(selector) {
		var frame = selector(frames);

		var mat = new THREE.MeshBasicMaterial({color: 'skyblue'});
		var text = _.numberFormat(frame['timestamp'] - base_timestamp, 3);
		var tgeom = new THREE.TextGeometry(text, {
			font: 'optimer',
			size: 0.15,
			height: 0.01
		});
		var ts_obj = new THREE.Mesh(tgeom, mat);
		ts_obj.position = dict_to_v3(frame['pos']);
		scene.add(ts_obj);
	});
}
