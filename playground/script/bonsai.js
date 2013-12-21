(function() {
"use strict";

// package imports for underscore
_.mixin(_.str.exports());

// target :: CanvasElement
var RealtimePlot = function(canvas) {
	this.canvas = canvas;
	this.context = canvas.getContext('2d');
};

RealtimePlot.prototype.update = function(dataset) {
	var ctx = this.context;
	var max_steps = 5;

	ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

	var width_main = this.canvas.width - 50;
	var height_main = this.canvas.height;
	_.each(dataset, function(series) {
		if(series.data.length === 0) {
			return;
		}

		// Plan layout
		var scale_y = height_main / _.max(series.data);
		var scale_x = Math.min(2, width_main / series.data.length);

		// Draw horizontal line with label
		if(series.show_label) {
			var step;
			if(_.max(series.data) < max_steps) {
				step = 1;
			} else {
				step = Math.floor(_.max(series.data) / max_steps);
				if(step <= 0) {
					step = series.data / max_steps;
				}
			}

			_.each(_.range(0, _.max(series.data) + 1, step), function(yv) {
				var y = height_main - yv * scale_y;

				ctx.beginPath();
				ctx.moveTo(0, y);
				ctx.lineTo(width_main, y);
				ctx.strokeStyle = '#888';
				ctx.lineWidth = 3;
				ctx.stroke();

				ctx.textAlign = 'right';
				ctx.fillStyle = '#eee';
				ctx.fillText(yv, 20, y);
			});
		}

		// draw line segments
		ctx.beginPath();
		_.each(series.data, function(data, ix) {
			if(ix === 0) {
				ctx.moveTo(ix * scale_x, height_main - data * scale_y);
			} else {
				ctx.lineTo(ix * scale_x, height_main - data * scale_y);
			}
		});
		ctx.lineWidth = 2;
		ctx.strokeStyle = series.color;
		ctx.stroke();

		ctx.textAlign = 'left';
		ctx.fillStyle = series.color;
		ctx.fillText(
			series.label,
			series.data.length * scale_x,
			height_main - series.data[series.data.length - 1] * scale_y + 10);
	});
};



// Separate into
// 1. master class (holds chunk worker)
// 1': 3D GUI class
// 2. Panel GUI class
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

// return :: ()
Bonsai.prototype.init = function() {
	this.chart = new RealtimePlot($('#history')[0]);


	this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.005, 10);
	this.camera.up = new THREE.Vector3(0, 0, 1);
	this.camera.position = new THREE.Vector3(0.3, 0.3, 0.4);
	this.camera.lookAt(new THREE.Vector3(0, 0, 0));

	this.scene = new THREE.Scene();

	var sunlight = new THREE.DirectionalLight(0xcccccc);
	sunlight.position.set(0, 0, 1).normalize();
	this.scene.add(sunlight);

	this.scene.add(new THREE.AmbientLight(0x333333));

	// UI state
	this.playing = null;
	this.num_plant_history = [];
	this.energy_history = [];

	// new, web worker API
	var curr_proxy = null;

	this.isolated_chunk = new Worker('script/isolated_chunk.js');
	this.inspect_plant_id = null;

	// 3D UI
	var curr_selection = null;

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
	this.controls.on_click = function(pos_ndc) {
		var caster = new THREE.Projector().pickingRay(pos_ndc, _this.camera);
		var intersections = caster.intersectObject(_this.scene, true);

		if(intersections.length > 0 &&
			intersections[0].object.plant_id !== undefined) {
			var plant = intersections[0].object;

			if(curr_selection !== null) {
				_this.scene.remove(curr_selection);
			}
			var height = 0.2;
			curr_selection = new THREE.Mesh(
				new THREE.CubeGeometry(0.1, 0.1, height),
				new THREE.MeshBasicMaterial({
					wireframe: true,
					color: new THREE.Color("rgb(173,127,168)"),
					wireframeLinewidth: 2,

				}));
			curr_selection.position = plant.position.clone().add(new THREE.Vector3(0, 0, height / 2 + 1e-3));
			_this.scene.add(curr_selection);

			_this.inspect_plant_id = plant.plant_id;
			_this.requestPlantStatUpdate();
		}
	};

	$('#button_play').on('click', function() {
		if(_this.playing !== null) {
			clearInterval(_this.playing);
			_this.playing = null;
			$('#button_play').html('&#x25b6;'); // play symbol
		} else {
			_this.playing = setInterval(function() {
				_this.handle_step(1);
			}, 500);
			$('#button_play').html('&#x25a0;'); // stop symbol
		}
	});

	$('#button_step1').on('click', function() {
		if(_this.playing !== null) {
			clearInterval(_this.playing);
			_this.playing = null;
			$('#button_play').html('&#x25b6;'); // play symbol
		}
		_this.handle_step(1);
	});

	$('#button_step10').on('click', function() {
		if(_this.playing !== null) {
			clearInterval(_this.playing);
			_this.playing = null;
			$('#button_play').html('&#x25b6;'); // play symbol
		}
		_this.handle_step(10);
	});

	$('#button_step50').on('click', function() {
		if(_this.playing !== null) {
			clearInterval(_this.playing);
			_this.playing = null;
			$('#button_play').html('&#x25b6;'); // play symbol
		}
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
			_this.num_plant_history.push(ev.data.data["plant"]);
			_this.energy_history.push(ev.data.data["stored/E"]);
			_this.updateGraph();

			$('#info-chunk').text(JSON.stringify(ev.data.data, null, 2));
		} else if(ev.data.type === 'stat-sim') {
			$('#info-sim').text(JSON.stringify(ev.data.data, null, 2));
		} else if(ev.data.type === 'stat-plant') {
			$('#info-plant').text(JSON.stringify(ev.data.data.stat, null, 2));
		} else if(ev.data.type === 'genome-plant') {
			_this.updateGenomeView(ev.data.data.genome);
		}
	}, false);

	this.isolated_chunk.postMessage({
		type: 'serialize'
	});
};

Bonsai.prototype.updateGenomeView = function(genome) {
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

	var RvCT = {
		1: "Leaf",
		2: "Shoot",
		3: "ShootApex",
		4: "Flower",
		5: "Growth",
		6: "!Growth",
		7: "1/2",
	};

	var RvCTShort = {
		1: "Lf",
		2: "Sh",
		3: "ShAx",
		4: "Flr",
		5: "Gr",
		6: "!Gr",
		7: "/",
	};

	function visualizeCT(ix) {
		var element = $('<span/>');
		if(RvCT[ix]) {
			element
				.text(RvCTShort[ix])
				.attr('title', RvCT[ix]);
		} else {
			element
				.text('?')
				.attr('class', 'ct-broken');
		}
		if(RvCT[ix] === "Half" || RvCT[ix] === 'Growth' || RvCT[ix] === '!Growth') {
			element.attr('class', 'ct-factor');
		}
		return element;
	}

	var target = $('#genome-plant');
	target.empty();
	_.each(genome, function(gene) {
		var gene_vis = $('<div/>').attr('class', 'gene');

		gene_vis.append(gene["tracer_desc"]);
		gene_vis.append($('<br/>'));
		_.each(gene["when"], function(cond) {
			gene_vis.append(visualizeCT(cond));
		});
		gene_vis.append("->");
		gene_vis.append(visualizeCT(gene['become']));
		gene_vis.append("+");
		_.each(gene["produce"], function(cond) {
			gene_vis.append(visualizeCT(cond));
		});

		target.append(gene_vis);
	});
};

// return :: ()
Bonsai.prototype.updateGraph = function() {
	this.chart.update([
		{
			show_label: true,
			data: this.num_plant_history,
			color: '#eee',
			label: 'Num Plants',
		},
		{
			show_label: false,
			data: this.energy_history,
			color: '#e88',
			label: 'Total Energy',
		}
	]);
};

// return :: ()
Bonsai.prototype.requestPlantStatUpdate = function() {
	this.isolated_chunk.postMessage({
		type: 'stat-plant',
		data: {
			id: this.inspect_plant_id
		}
	});

	this.isolated_chunk.postMessage({
		type: 'genome-plant',
		data: {
			id: this.inspect_plant_id
		}
	});
};

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

		mesh.plant_id = data_plant.id;
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
			context.fillRect(x, data.soil.n - 1 - y, 1, 1);
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
	_.each(_.range(n), function(i) {
		this.isolated_chunk.postMessage({
			type: 'step'
		});
		this.isolated_chunk.postMessage({
			type: 'stat'
		});
		this.requestPlantStatUpdate();
	}, this);
	this.isolated_chunk.postMessage({
		type: 'serialize'
	});
};

/* UI Utils */
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
