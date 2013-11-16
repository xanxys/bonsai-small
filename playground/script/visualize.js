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


var Bonsai = function() {
	this.add_stats();
	this.init();
};

Bonsai.prototype.add_stats = function() {
	this.stats = new Stats();
	this.stats.setMode(1); // 0: fps, 1: ms

	// Align top-left
	this.stats.domElement.style.position = 'absolute';
	this.stats.domElement.style.right = '0px';
	this.stats.domElement.style.top = '0px';

	document.body.appendChild(this.stats.domElement);
}


Bonsai.prototype.init = function() {
	this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.005, 10);
	this.camera.up = new THREE.Vector3(0, 0, 1);
	this.camera.position = new THREE.Vector3(0.3, 0.3, 0.4);
	this.camera.lookAt(new THREE.Vector3(0, 0, 0));

	this.scene = new THREE.Scene();

	var sunlight = new THREE.DirectionalLight(0xffffff);
	sunlight.position.set(0, 0, 1).normalize();
	this.scene.add(sunlight);

	this.scene.add(new THREE.AmbientLight(0x333333));


	this.bonsai = new bonsai.Chunk(this.scene);
	this.current_plant = this.bonsai.add_plant(new THREE.Vector3(0, 0, 0));
	this.bonsai.re_materialize({});

	this.ui_update_stats({});

	// start canvas
	this.renderer = new THREE.WebGLRenderer();
	this.renderer.setSize(window.innerWidth, window.innerHeight);
	$('#main').append(this.renderer.domElement);

	// add mouse control (do this after canvas insertion)
	this.controls = new TrackballControls(this.camera, this.renderer.domElement);
	this.controls.maxDistance = 5;

	// Connect signals
	var _this = this;
	$('#debug_light_volume').on('click', function() {
		_this.handle_update_debug_options()
	});
	$('#debug_occluder').on('click', function() {
		_this.handle_update_debug_options();
	});
	$('#light_flux').change(function() {
		_this.handle_light_change();
	});
	$('#button_replant').on('click', function() {
		_this.handle_replant();
	});
	$('#button_step1').on('click', function() {
		_this.handle_step(1);
	});
	$('#button_step10').on('click', function() {
		_this.handle_step(10);
	});
}

/* UI Handlers */
Bonsai.prototype.handle_replant = function() {
	if(this.current_plant === null ) {
		return;
	}

	this.bonsai.remove_plant(this.current_plant);
	this.current_plant = this.bonsai.add_plant(new THREE.Vector3(0, 0, 0));
	this.bonsai.re_materialize(this.ui_get_debug_option());

	this.ui_update_stats({});
};

Bonsai.prototype.handle_step = function(n) {
	if(this.current_plant === null) {
		return;
	}

	var sim_stat = {};
	_.each(_.range(n), function(i) {
		sim_stat = this.bonsai.step();
	}, this);
	this.bonsai.re_materialize(this.ui_get_debug_option());

	this.ui_update_stats(sim_stat);
};

Bonsai.prototype.handle_light_change = function() {
	this.bonsai.set_flux($('#light_flux').val());
};

Bonsai.prototype.handle_update_debug_options = function() {
	this.bonsai.re_materialize(this.ui_get_debug_option());
};

/* UI Utils */
Bonsai.prototype.ui_update_stats = function(sim_stat) {
	var dict = this.current_plant.get_stat();
	
	/*	
	dict['flux/W'] = this.current_plant.get_flux();
	dict['mass/g'] = this.current_plant.get_mass() * 1e3;
	dict['age/tick'] = this.current_plant.get_age();
	*/

	$('#info').text(JSON.stringify(dict, null, 2));
	$('#info-sim').text(JSON.stringify(sim_stat, null, 2));
	$('#info-chunk').text(JSON.stringify(this.bonsai.get_stat(), null, 2));
};

Bonsai.prototype.ui_get_debug_option = function() {
	return {
		'show_occluder': $('#debug_occluder').prop('checked'),
		'show_light_volume': $('#debug_light_volume').prop('checked')};
};


Bonsai.prototype.animate = function() {
	this.stats.begin();

	// note: three.js includes requestAnimationFrame shim
	var _this = this;
	requestAnimationFrame(function(){_this.animate();});

	this.renderer.render(this.scene, this.camera);
	this.controls.update();

	this.stats.end();
};

// run app
new Bonsai().animate();

});  // requirejs
