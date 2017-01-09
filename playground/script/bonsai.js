(function() {
"use strict";

// package imports for underscore
_.mixin(_.str.exports());

// target :: CanvasElement
class RealtimePlot {

  constructor(canvas) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d');
  }

  update(dataset) {
    let ctx = this.context;
    let max_steps = 5;

    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    let width_main = this.canvas.width - 50;
    let height_main = this.canvas.height;
    _.each(dataset, function(series) {
      if(series.data.length === 0) {
        return;
      }

      // Plan layout
      let scale_y = height_main / _.max(series.data);
      let scale_x = Math.min(2, width_main / series.data.length);

      // Draw horizontal line with label
      if(series.show_label) {
        let step;
        if(_.max(series.data) < max_steps) {
          step = 1;
        } else {
          step = Math.floor(_.max(series.data) / max_steps);
          if(step <= 0) {
            step = series.data / max_steps;
          }
        }

        _.each(_.range(0, _.max(series.data) + 1, step), function(yv) {
          let y = height_main - yv * scale_y;

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
  }
}


// Separate into
// 1. master class (holds chunk worker)
// 1': 3D GUI class
// 2. Panel GUI class
class Bonsai {
  constructor() {
    this.debug = (location.hash === '#debug');

    this.add_stats();
    this.init();
  }

  add_stats() {
    this.stats = new Stats();
    this.stats.setMode(1); // 0: fps, 1: ms

    // Align top-left
    this.stats.domElement.style.position = 'absolute';
    this.stats.domElement.style.right = '0px';
    this.stats.domElement.style.top = '0px';

    if(this.debug) {
      document.body.appendChild(this.stats.domElement);
    }
  }

  // return :: ()
  init() {
    this.chart = new RealtimePlot($('#history')[0]);

    this.age = 0;

    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.005, 15);
    this.camera.up = new THREE.Vector3(0, 0, 1);
    this.camera.position.set(0.3, 0.3, 0.4);
    this.camera.lookAt(new THREE.Vector3(0, 0, 0));

    this.scene = new THREE.Scene();

    let sunlight = new THREE.DirectionalLight(0xcccccc);
    sunlight.position.set(0, 0, 1).normalize();
    this.scene.add(sunlight);

    this.scene.add(new THREE.AmbientLight(0x333333));

    let bg = new THREE.Mesh(
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
    let curr_proxy = null;
    this.isolated_chunk = new Worker('script/isolated_chunk.js');

    // Selection
    this.inspect_plant_id = null;
    let curr_selection = null;

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
    let _this = this;
    this.controls.on_click = function(pos_ndc) {
      let caster = new THREE.Raycaster();
      caster.setFromCamera(pos_ndc, _this.camera);
      //let caster = new THREE.Projector().pickingRay(pos_ndc, _this.camera);
      let intersections = caster.intersectObject(_this.scene, true);

      if(intersections.length > 0 &&
        intersections[0].object.plant_id !== undefined) {
        let plant = intersections[0].object;
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
      let target = $(ev.currentTarget);

      let button_window_table = {
        button_toggle_time: 'bg-time',
        button_toggle_chunk: 'bg-chunk',
        button_toggle_chart: 'bg-chart',
        button_toggle_plant: 'bg-plant',
        button_toggle_genome: 'bg-genome',
        button_toggle_about: 'bg-about',
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

    $('#button_kill').on('click', function() {
      if(curr_selection !== null) {
        _this.isolated_chunk.postMessage({
          type: 'kill',
          data: {
            id: _this.inspect_plant_id
          }
        });

        _this.isolated_chunk.postMessage({
          type: 'serialize'
        });

        _this.requestPlantStatUpdate();
      }
    })
    this.isolated_chunk.addEventListener('message', function(ev) {
      if(ev.data.type === 'serialize') {
        let proxy = _this.deserialize(ev.data.data);

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
        let target_plant_data = _.find(ev.data.data.plants, function(dp) {
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
          }, 100);
        }
      } else if(ev.data.type === 'stat-plant') {
        _this.updatePlantView(ev.data.data.stat);
      } else if(ev.data.type === 'genome-plant') {
        _this.updateGenomeView(ev.data.data.genome);
      } else if(ev.data.type === 'exception') {
        console.log('Exception ocurred in isolated chunk:', ev.data.data);
      }
    }, false);

    this.isolated_chunk.postMessage({
      type: 'serialize'
    });
  }

  updatePlantView(stat) {
    $('#info-plant').empty();
    $('#info-plant').append(JSON.stringify(_.omit(stat, 'cells'), null, 2));
    $('#info-plant').append($('<br/>'));

    if(stat !== null) {
      let table = $('<table/>');
      $('#info-plant').append(table);

      let n_cols = 5;
      let curr_row = null;
      _.each(stat['cells'], function(cell_stat, ix) {
        if(ix % n_cols === 0) {
          curr_row = $('<tr/>');
          table.append(curr_row);
        }

        let stat = {};
        _.each(cell_stat, function(sig) {
          if(stat[sig] !== undefined) {
            stat[sig] += 1;
          } else {
            stat[sig] = 1;
          }
        });

        let cell_info = $('<div/>');
        _.each(stat, function(n, sig) {
          let mult = '';
          if(n > 1) {
            mult = '*' + n;
          }
          cell_info.append($('<span/>').text(sig + mult));
        });
        curr_row.append($('<td/>').append(cell_info));
      });
    }
  }

  updateGenomeView(genome) {
    function visualizeSignals(sigs) {
      // Parse signals.
      let raws = $('<tr/>');
      let descs = $('<tr/>');

      _.each(sigs, function(sig) {
        let desc = parseIntrinsicSignal(sig);

        let e_raw = $('<td/>').text(desc.raw);
        e_raw.addClass('ct-' + desc.type);
        raws.append(e_raw);

        let e_desc = $('<td/>').text(desc.long);
        if(desc.long === '') {
          e_desc.text(' ');
        }
        descs.append(e_desc);
      });

      let element = $('<table/>');
      element.append(raws);
      element.append(descs);
      return element;
    }

    let target = $('#genome-plant');
    target.empty();
    if(genome === null) {
      return;
    }

    _.each(genome.unity, function(gene) {
      let gene_vis = $('<div/>').attr('class', 'gene');

      gene_vis.append(gene["tracer_desc"]);
      gene_vis.append($('<br/>'));
      gene_vis.append(visualizeSignals(gene["when"]));
      gene_vis.append(visualizeSignals(gene["emit"]));

      target.append(gene_vis);
    });
  }

  // return :: ()
  updateGraph() {
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
  }

  // return :: ()
  requestPlantStatUpdate() {
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
  }

  // data :: PlantData
  // return :: THREE.Object3D
  serializeSelection(data_plant) {
    let padding = new THREE.Vector3(5e-3, 5e-3, 5e-3);

    // Calculate AABB of the plant.
    let v_min = new THREE.Vector3(1e3, 1e3, 1e3);
    let v_max = new THREE.Vector3(-1e3, -1e3, -1e3);
    _.each(data_plant.vertices, function(data_vertex) {
      let vertex = new THREE.Vector3().copy(data_vertex);
      v_min.min(vertex);
      v_max.max(vertex);
    });

    // Create proxy.
    v_min.sub(padding);
    v_max.add(padding);

    let proxy_size = v_max.clone().sub(v_min);
    let proxy_center = v_max.clone().add(v_min).multiplyScalar(0.5);

    let proxy = new THREE.Mesh(
      new THREE.CubeGeometry(proxy_size.x, proxy_size.y, proxy_size.z),
      new THREE.MeshBasicMaterial({
        wireframe: true,
        color: new THREE.Color("rgb(173,127,168)"),
        wireframeLinewidth: 2,

      }));

    proxy.position.copy(proxy_center
      .clone()
      .add(new THREE.Vector3(0, 0, 5e-3 + 1e-3)));

    return proxy;
  }

  // data :: ChunkData
  // return :: THREE.Object3D
  deserialize(data) {
    let proxy = new THREE.Object3D();

    // de-serialize plants
    _.each(data.plants, function(data_plant) {
      let geom = new THREE.Geometry();
      geom.vertices = data_plant.vertices;
      geom.faces = data_plant.faces;

      let mesh = new THREE.Mesh(geom,
        new THREE.MeshLambertMaterial({
          vertexColors: THREE.VertexColors}));

      mesh.plant_id = data_plant.id;
      mesh.plant_data = data_plant;
      proxy.add(mesh);
    });

    // de-serialize soil
    const tex_size = 64;
    let canvas = document.createElement('canvas');
    canvas.width = tex_size;
    canvas.height = tex_size;
    let context = canvas.getContext('2d');
    context.scale(tex_size / data.soil.n, tex_size / data.soil.n);
    for(let y = 0; y < data.soil.n; y++) {
      for(let x = 0; x < data.soil.n; x++) {
        const v = data.soil.luminance[x + y * data.soil.n];
        let lighting = new THREE.Color().setRGB(v, v, v);
        context.fillStyle = lighting.getStyle();
        context.fillRect(x, data.soil.n - 1 - y, 1, 1);
      }
    }

    // Attach tiles to the base.
    let tex = new THREE.Texture(canvas);
    tex.needsUpdate = true;

    let soil_plate = new THREE.Mesh(
      new THREE.CubeGeometry(data.soil.size, data.soil.size, 1e-3),
      new THREE.MeshBasicMaterial({
        map: tex
      }));
    proxy.add(soil_plate);

    return proxy;
  }

  /* UI Handlers */
  handle_step(n) {
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

    $('#ui_abs_time').text(this.age + 'T');
  }

  /* UI Utils */
  animate() {
    this.stats.begin();

    // note: three.js includes requestAnimationFrame shim
    let _this = this;
    requestAnimationFrame(function(){_this.animate();});

    this.renderer.render(this.scene, this.camera);
    this.controls.update();

    this.stats.end();
  }
}


// run app
$(document).ready(function() {
  new Bonsai().animate();
});

})();
