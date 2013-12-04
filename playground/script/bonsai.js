(function() {
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

	var sunlight = new THREE.DirectionalLight(0xcccccc);
	sunlight.position.set(0, 0, 1).normalize();
	this.scene.add(sunlight);

	this.scene.add(new THREE.AmbientLight(0x333333));


	// new, web worker API
	var curr_proxy = null;

	this.isolated_chunk = new Worker('script/isolated_chunk.js');

	// old-fashioned, blocking API
	/*
	this.bonsai = new Chunk(this.scene);
	this.current_plant = this.bonsai.add_plant(
		new THREE.Vector3(0, 0, 0),
		Math.pow(20e-3, 3) * 100 // allow 2cm cube for 100T
		);
	this.bonsai.re_materialize({});
	*/

	this.ui_update_stats({});

	// start canvas
	this.renderer = new THREE.WebGLRenderer();
	this.renderer.setSize(window.innerWidth, window.innerHeight);
	this.renderer.setClearColor('#eee');
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
	$('#button_step1').on('click', function() {
		_this.handle_step(1);
	});
	$('#button_step10').on('click', function() {
		_this.handle_step(10);
	});
	$('#button_step50').on('click', function() {
		_this.handle_step(50);
	});

	this.isolated_chunk.addEventListener('message', function(ev) {
		if(ev.data.type === 'serialize') {
			var proxy = _this.deserialize(ev.data.data);
			
			if(curr_proxy) {
				_this.scene.remove(curr_proxy);
			}
			curr_proxy = proxy;
			_this.scene.add(curr_proxy);
		} else if(ev.data.type === 'stat-chunk') {
			$('#info-chunk').text(JSON.stringify(ev.data.data, null, 2));
		} else if(ev.data.type === 'stat-sim') {
			$('#info-sim').text(JSON.stringify(ev.data.data, null, 2));
		}
	}, false);

	this.isolated_chunk.postMessage({
		type: 'serialize'
	});
}

// return :: THREE.Object3D
Bonsai.prototype.deserialize = function(data) {
	var proxy = new THREE.Object3D();

	// de-serialize plants
	_.each(data.plants, function(data_plant) {
		var geom = new THREE.Geometry();
		geom.vertices = data_plant.vertices;
		geom.faces = data_plant.faces;

		var mesh = new THREE.Mesh(geom,
			new THREE.MeshLambertMaterial({
				vertexColors: THREE.VertexColors}));

		mesh.position = new THREE.Vector3(
			data_plant.position.x,
			data_plant.position.y,
			data_plant.position.z);
		proxy.add(mesh);
	});

	// de-serialize soil
	var canvas = document.createElement('canvas');
	canvas.width = data.soil.n;
	canvas.height = data.soil.n;
	var context = canvas.getContext('2d');
	_.each(_.range(data.soil.n), function(y) {
		_.each(_.range(data.soil.n), function(x) {
			var v = data.soil.luminance[x + y * data.soil.n];
			var lighting = new THREE.Color().setRGB(v, v, v);

			context.fillStyle = lighting.getStyle();
			context.fillRect(x, data.soil.n - y, 1, 1);
		}, this);
	}, this);

	// Attach tiles to the base.
	var tex = new THREE.Texture(canvas);
	tex.needsUpdate = true;

	var soil_plate = new THREE.Mesh(
		new THREE.CubeGeometry(data.soil.size, data.soil.size, 1e-3),
		new THREE.MeshBasicMaterial({
			map: tex
		}));
	proxy.add(soil_plate);
			
	return proxy;
};

/* UI Handlers */
Bonsai.prototype.handle_step = function(n) {
	if(this.current_plant === null) {
		return;
	}

	_.each(_.range(n), function(i) {
		this.isolated_chunk.postMessage({
			type: 'step'
		});
	}, this);
	this.isolated_chunk.postMessage({
		type: 'serialize'
	});
	this.isolated_chunk.postMessage({
		type: 'stat'
	});


	var sim_stat = {};
	/*
	_.each(_.range(n), function(i) {
		sim_stat = this.bonsai.step();
	}, this);
	*/
	//this.bonsai.re_materialize(this.ui_get_debug_option());

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
	return;

	var dict = this.current_plant.get_stat();
	if(dict['stored/E'] < 0) {
		$('#info').text('<dead>\n' + JSON.stringify(dict, null, 2)).css('color', 'hotpink');
	} else {
		$('#info').text(JSON.stringify(dict, null, 2)).css('color', null);
	}
	


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
$(document).ready(function() {
	new Bonsai().animate();
});

})();
