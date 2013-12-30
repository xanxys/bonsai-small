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
	this.debug = (location.hash === '#debug');

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

	this.age = 0;

	this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.005, 15);
	this.camera.up = new THREE.Vector3(0, 0, 1);
	this.camera.position = new THREE.Vector3(0.3, 0.3, 0.4);
	this.camera.lookAt(new THREE.Vector3(0, 0, 0));

	this.scene = new THREE.Scene();

	var sunlight = new THREE.DirectionalLight(0xcccccc);
	sunlight.position.set(0, 0, 1).normalize();
	this.scene.add(sunlight);

	this.scene.add(new THREE.AmbientLight(0x333333));

	var bg = new THREE.Mesh(
		new THREE.IcosahedronGeometry(8, 1),
		new THREE.MeshBasicMaterial({
			wireframe: true,
			color: '#ccc'
		}));
	this.scene.add(bg);

	// UI state
	this.playing = null;
	this.num_plant_history = [];
	this.energy_history = [];

	// new, web worker API
	var curr_proxy = null;
	this.isolated_chunk = new Worker('script/isolated_chunk.js');

	// Selection
	this.inspect_plant_id = null;
	var curr_selection = null;

	// start canvas
	this.renderer = new THREE.WebGLRenderer({
		antialias: true
	});
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
			_this.inspect_plant_id = plant.plant_id;

			if(curr_selection !== null) {
				_this.scene.remove(curr_selection);
			}
			curr_selection = _this.serializeSelection(plant.plant_data);
			_this.scene.add(curr_selection);
			_this.requestPlantStatUpdate();
		}
	};

	$('.column-buttons button').on('click', function(ev) {
		var target = $(ev.currentTarget);

		var button_window_table = {
			button_toggle_time: 'bg-time',
			button_toggle_chunk: 'bg-chunk',
			button_toggle_chart: 'bg-chart',
			button_toggle_plant: 'bg-plant',
			button_toggle_genome: 'bg-genome',
		};

		target.toggleClass('active');
		if(_this.debug) {
			$('.' + button_window_table[target[0].id]).toggle();
		} else {
			$('.' + button_window_table[target[0].id] + ':not(.debug)').toggle();
		}
	});

	$('#button_play').on('click', function() {
		if(_this.playing) {
			_this.playing = false;
			$('#button_play').html('&#x25b6;'); // play symbol
		} else {
			_this.playing = true;
			_this.handle_step(1);
			$('#button_play').html('&#x25a0;'); // stop symbol
		}
	});

	$('#button_step1').on('click', function() {
		_this.playing = false;
		$('#button_play').html('&#x25b6;'); // play symbol
		_this.handle_step(1);
	});

	$('#button_step10').on('click', function() {
		_this.playing = false;
		$('#button_play').html('&#x25b6;'); // play symbol
		_this.handle_step(10);
	});

	$('#button_step50').on('click', function() {
		_this.playing = false;
		$('#button_play').html('&#x25b6;'); // play symbol
		_this.handle_step(50);
	});

	this.isolated_chunk.addEventListener('message', function(ev) {
		if(ev.data.type === 'serialize') {
			var proxy = _this.deserialize(ev.data.data);
			
			// Update chunk proxy.
			if(curr_proxy) {
				_this.scene.remove(curr_proxy);
			}
			curr_proxy = proxy;
			_this.scene.add(curr_proxy);

			// Update selection proxy if exists.
			if(curr_selection !== null) {
				_this.scene.remove(curr_selection);
				curr_selection = null;
			}
			var target_plant_data = _.find(ev.data.data.plants, function(dp) {
				return dp.id === _this.inspect_plant_id;
			});
			if(target_plant_data !== undefined) {
				curr_selection = _this.serializeSelection(target_plant_data);
				_this.scene.add(curr_selection);
			}
		} else if(ev.data.type === 'stat-chunk') {
			_this.num_plant_history.push(ev.data.data["plant"]);
			_this.energy_history.push(ev.data.data["stored/E"]);
			_this.updateGraph();

			$('#info-chunk').text(JSON.stringify(ev.data.data, null, 2));
		} else if(ev.data.type === 'stat-sim') {
			$('#info-sim').text(JSON.stringify(ev.data.data, null, 2));
			if(_this.playing) {
				setTimeout(function() {
					_this.handle_step(1);
				}, 50);
			}
		} else if(ev.data.type === 'stat-plant') {
			$('#info-plant').text(JSON.stringify(ev.data.data.stat, null, 2));
		} else if(ev.data.type === 'genome-plant') {
			_this.updateGenomeView(ev.data.data.genome);
		} else if(ev.data.type === 'exception') {
			console.log('Exception ocurred in isolated chunk:', ev.data.data);
		}
	}, false);

	this.isolated_chunk.postMessage({
		type: 'serialize'
	});
};

Bonsai.prototype.updateGenomeView = function(genome) {
	function visualizeCellTag(ix) {
		var sig_name = CellType.convertToSignalName(ix);

		var element = $('<span/>')
			.text(sig_name.short)
			.attr('title', sig_name.long);

		if(sig_name.long === "?") {
			element.attr('class', 'ct-broken');
		} else if(sig_name.long === "Half" || sig_name.long === 'Growth' || sig_name.long === '!Growth') {
			element.attr('class', 'ct-factor');
		}
		return element;
	}

	function visualizeDifferentiationTag(ix) {
		var sig_name = Differentiation.convertToSignalName(ix);

		var element = $('<span/>')
			.text(sig_name.short)
			.attr('title', sig_name.long);

		if(sig_name.long === "?") {
			element.attr('class', 'ct-broken');
		}
		return element;
	}

	function visualizeRotationTag(ix) {
		var sig_name = Rotation.convertToSignalName(ix);

		var element = $('<span/>')
			.text(sig_name.short)
			.attr('title', sig_name.long);

		if(sig_name.long === "?") {
			element.attr('class', 'ct-broken');
		}
		return element;
	}

	var target = $('#genome-plant');
	target.empty();
	if(genome === null) {
		return;
	}

	_.each(genome.discrete, function(gene) {
		var gene_vis = $('<div/>').attr('class', 'gene');

		gene_vis.append(gene["tracer_desc"]);
		gene_vis.append($('<br/>'));
		_.each(gene["when"], function(cond) {
			gene_vis.append(visualizeCellTag(cond));
		});
		gene_vis.append("->");
		gene_vis.append(visualizeCellTag(gene['become']));
		gene_vis.append("+");
		_.each(gene["produce"], function(cond) {
			gene_vis.append(visualizeDifferentiationTag(cond));
		});

		target.append(gene_vis);
	});

	_.each(genome.continuous, function(gene) {
		var gene_vis = $('<div/>').attr('class', 'gene');
		gene_vis.append(visualizeCellTag(gene["when"]));
		gene_vis.append(":");
		gene_vis.append("+[" + gene.dx + "," + gene.dy + "," + gene.dz + "] / ");
		gene_vis.append("[" + gene.mx + "," + gene.my + "," + gene.mz + "]");

		target.append(gene_vis);
	});

	_.each(genome.positional, function(gene) {
		var gene_vis = $('<div/>').attr('class', 'gene');

		gene_vis.append(gene["tracer_desc"]);
		gene_vis.append($('<br/>'));
		gene_vis.append(visualizeDifferentiationTag(gene["when"]));
		gene_vis.append("->");
		gene_vis.append(visualizeCellTag(gene.produce));
		gene_vis.append("*");
		gene_vis.append(visualizeRotationTag(gene.rot));

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

// data :: PlantData
// return :: THREE.Object3D
Bonsai.prototype.serializeSelection = function(data_plant) {
	var padding = new THREE.Vector3(5e-3, 5e-3, 5e-3);

	// Calculate AABB of the plant.
	var v_min = new THREE.Vector3(0, 0, 0);
	var v_max = new THREE.Vector3(0, 0, 0);
	_.each(data_plant.vertices, function(data_vertex) {
		var vertex = new THREE.Vector3().copy(data_vertex);
		v_min.min(vertex);
		v_max.max(vertex);
	});

	// Create proxy.
	v_min.sub(padding);
	v_max.add(padding);

	var proxy_size = v_max.clone().sub(v_min);
	var proxy_center = v_max.clone().add(v_min).multiplyScalar(0.5);

	var proxy = new THREE.Mesh(
		new THREE.CubeGeometry(proxy_size.x, proxy_size.y, proxy_size.z),
		new THREE.MeshBasicMaterial({
			wireframe: true,
			color: new THREE.Color("rgb(173,127,168)"),
			wireframeLinewidth: 2,

		}));

	proxy.position = new THREE.Vector3(
		data_plant.position.x,
		data_plant.position.y,
		data_plant.position.z)
		.add(proxy_center)
		.add(new THREE.Vector3(0, 0, 5e-3 + 1e-3));

	return proxy;
};

// data :: ChunkData
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
		mesh.plant_data = data_plant;
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
	this.age += n;

	$('#ui_abs_time').text(this.age + ' T');
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
