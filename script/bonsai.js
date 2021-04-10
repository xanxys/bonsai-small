"use strict";

Vue.component('line-plot', Vue.extend({
    extends: VueChartJs.Line,
    mixins: [VueChartJs.mixins.reactiveProp],
    props: ['options'],
    mounted: function() {
        this.renderChart(this.chartData, this.options);
    },
}));


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

        if (this.debug) {
            document.body.appendChild(this.stats.domElement);
        }
    }

    // return :: ()
    init() {
        this.age = 0;

        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.5, 1500);
        this.camera.up = new THREE.Vector3(0, 0, 1);
        this.camera.position.set(30, 30, 40);
        this.camera.lookAt(new THREE.Vector3(0, 0, 0));

        this.scene = new THREE.Scene();

        let sunlight = new THREE.DirectionalLight(0xcccccc);
        sunlight.position.set(0, 0, 100).normalize();
        this.scene.add(sunlight);

        this.scene.add(new THREE.AmbientLight(0x333333));

        let bg = new THREE.Mesh(
            new THREE.IcosahedronGeometry(800, 1),
            new THREE.MeshBasicMaterial({
                wireframe: true,
                color: '#ccc'
            }));
        this.scene.add(bg);

        // UI state
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

        document.getElementById('main').append(this.renderer.domElement);

        // add mouse control (do this after canvas insertion)
        this.controls = new TrackballControls(this.camera, this.renderer.domElement);
        this.controls.maxDistance = 500;

 
        // Connect signals
        this.controls.on_click = (pos_ndc) => {
            let caster = new THREE.Raycaster();
            caster.setFromCamera(pos_ndc, this.camera);
            //let caster = new THREE.Projector().pickingRay(pos_ndc, this.camera);
            let intersections = caster.intersectObject(this.scene, true);

            if (intersections.length > 0 &&
                intersections[0].object.plant_id !== undefined) {
                let plant = intersections[0].object;
                this.inspect_plant_id = plant.plant_id;

                if (curr_selection !== null) {
                    this.scene.remove(curr_selection);
                }
                curr_selection = this.serializeSelection(plant.plant_data);
                this.scene.add(curr_selection);
                this.requestPlantStatUpdate();
            }
        };

        const app = this;
        this.vm = new Vue({
            el: '#ui',
            data: {
                timePanelVisible: true,
                chunkPanelVisible: false,
                chartPanelVisible: false,
                plantPanelVisible: false,
                genomePanelVisible: false,
                aboutPanelVisible: false,

                playing: false,
                age: 0,

                historydata: {},
                historyoption: {
                    color: '#fff',
                    backgroundColor: '#eee',
                    borderColor: '#ccc',
                    responsive: false,
                    maintainAspectRatio: false,
                    animation: false, // line drawing can't catch up dynamic update with animation on
                    elements: {
                        point:{
                            radius: 1,
                        }
                    },
                    scales: {
                        y: {
                            type: 'linear',
                            display: true,
                            position: 'left',

                            ticks: {
                                color: '#fff',
                            },
                            
                        },
                        y1: {
                            type: 'linear',
                            display: true,
                            position: 'right',
                            ticks: {
                                color: '#fff',
                            },

                            // grid line settings
                            grid: {
                                drawOnChartArea: false, // only want the grid lines for one axis to show up
                            },
                        },
                    },
                },
            },
            methods: {
                onClickToggleTime: function() {
                    this.timePanelVisible = !this.timePanelVisible;
                },
                onClickToggleChunk: function() {
                    this.chunkPanelVisible = !this.chunkPanelVisible;
                },
                onClickToggleChart: function() {
                    this.chartPanelVisible = !this.chartPanelVisible;
                },
                onClickTogglePlant: function() {
                    this.plantPanelVisible = !this.plantPanelVisible;
                },
                onClickToggleGenome: function() {
                    this.genomePanelVisible = !this.genomePanelVisible;
                },
                onClickToggleAbout: function() {
                    this.aboutPanelVisible = !this.aboutPanelVisible;
                },

                onClickPlay: function() {
                    if (this.playing) {
                        this.playing = false;
                    } else {
                        this.playing = true;
                        this.execStep(1);
                    }
                },
                onClickStep: function(n) {
                    this.playing = false;
                    this.execStep(n);
                },

                execStep: function(n) {
                    for (let i = 0; i < n; i++) {
                        app.isolated_chunk.postMessage({
                            type: 'step'
                        });
                        app.isolated_chunk.postMessage({
                            type: 'stat'
                        });
                        app.requestPlantStatUpdate();
                    }
                    app.isolated_chunk.postMessage({
                        type: 'serialize'
                    });
                    this.age += n;
                },

                updateGraph: function() {
                    const timestamps = [];
                    for (let i = 0; i < this.age; i++) {
                        timestamps.push(i + 1);
                    }
                    
                    this.historydata = {
                        labels: timestamps,
                        datasets: [
                            {
                                label: '#plants',
                                data: app.num_plant_history
                            },
                            {
                                label: 'stored energy',
                                data: app.energy_history,
                                backgroundColor: '#afa',
                                borderColor: '#afa',
                                yAxisID: 'y1',
                            }
                        ]
                    };
                },
            },
        });

        $('#button_kill').on('click', () => {
            if (curr_selection !== null) {
                this.isolated_chunk.postMessage({
                    type: 'kill',
                    data: {
                        id: this.inspect_plant_id
                    }
                });

                this.isolated_chunk.postMessage({
                    type: 'serialize'
                });

                this.requestPlantStatUpdate();
            }
        })
        this.isolated_chunk.addEventListener('message', ev => {
            if (ev.data.type === 'init-complete') {
                this.isolated_chunk.postMessage({
                    type: 'serialize'
                });
            } else if (ev.data.type === 'serialize') {
                let proxy = this.deserialize(ev.data.data);

                // Update chunk proxy.
                if (curr_proxy) {
                    this.scene.remove(curr_proxy);
                }
                curr_proxy = proxy;
                this.scene.add(curr_proxy);

                // Update selection proxy if exists.
                if (curr_selection !== null) {
                    this.scene.remove(curr_selection);
                    curr_selection = null;
                }
                let target_plant_data = ev.data.data.plants.find(dp => {
                    return dp.id === this.inspect_plant_id;
                });
                if (target_plant_data !== undefined) {
                    curr_selection = this.serializeSelection(target_plant_data);
                    this.scene.add(curr_selection);
                }
            } else if (ev.data.type === 'stat-chunk') {
                this.num_plant_history.push(ev.data.data["plant"]);
                this.energy_history.push(ev.data.data["stored/E"]);
                this.vm.updateGraph();

                $('#info-chunk').text(JSON.stringify(ev.data.data, null, 2));
            } else if (ev.data.type === 'stat-sim') {
                $('#info-sim').text(JSON.stringify(ev.data.data, null, 2));
                if (this.vm.playing) {
                    setTimeout(() => {
                        this.vm.execStep(1);
                    }, 100);
                }
            } else if (ev.data.type === 'stat-plant') {
                this.updatePlantView(ev.data.data.stat);
            } else if (ev.data.type === 'genome-plant') {
                this.updateGenomeView(ev.data.data.genome);
            }
        }, false);
    }

    updatePlantView(stat) {
        $('#info-plant').empty();
        
        const reducedStats = {};
        Object.assign(reducedStats, stat);
        delete reducedStats.cells;
        
        $('#info-plant').append(JSON.stringify(reducedStats, null, 2));
        $('#info-plant').append($('<br/>'));

        if (stat !== null) {
            let table = $('<table/>');
            $('#info-plant').append(table);

            let n_cols = 5;
            let curr_row = null;
            stat['cells'].forEach((cell_stat, ix) => {
                if (ix % n_cols === 0) {
                    curr_row = $('<tr/>');
                    table.append(curr_row);
                }

                let stat = {};
                cell_stat.forEach(sig => {
                    if (stat[sig] !== undefined) {
                        stat[sig] += 1;
                    } else {
                        stat[sig] = 1;
                    }
                });

                let cell_info = $('<div/>');
                for (const [sig, n] of Object.entries(stat)) {
                    let mult = '';
                    if (n > 1) {
                        mult = '*' + n;
                    }
                    cell_info.append($('<span/>').text(sig + mult));
                }
                curr_row.append($('<td/>').append(cell_info));
            });
        }
    }

    updateGenomeView(genome) {
        function visualizeSignals(sigs) {
            // Parse signals.
            let raws = $('<tr/>');
            let descs = $('<tr/>');

            sigs.forEach(sig => {
                let desc = parseIntrinsicSignal(sig);

                let e_raw = $('<td/>').text(desc.raw);
                e_raw.addClass('ct-' + desc.type);
                raws.append(e_raw);

                let e_desc = $('<td/>').text(desc.long);
                if (desc.long === '') {
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
        if (genome === null) {
            return;
        }

        genome.unity.forEach(gene => {
            let gene_vis = $('<div/>').attr('class', 'gene');

            gene_vis.append(gene["tracer_desc"]);
            gene_vis.append($('<br/>'));
            gene_vis.append(visualizeSignals(gene["when"]));
            gene_vis.append(visualizeSignals(gene["emit"]));

            target.append(gene_vis);
        });
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
        let padding = new THREE.Vector3(5e-1, 5e-1, 5e-1);

        // Calculate AABB of the plant.
        let v_min = new THREE.Vector3(1e5, 1e5, 1e5);
        let v_max = new THREE.Vector3(-1e5, -1e5, -1e5);
        data_plant.vertices.forEach(data_vertex => {
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
            .add(new THREE.Vector3(0, 0, 5e-1 + 1e-1)));

        return proxy;
    }

    // data :: ChunkData
    // return :: THREE.Object3D
    deserialize(data) {
        const proxy = new THREE.Object3D();

        // de-serialize plants
        const plantMat = new THREE.MeshLambertMaterial({vertexColors: true});
        data.plants.forEach((data_plant) => {
            const geom = new THREE.Geometry();
            geom.vertices = data_plant.vertices;
            geom.faces = data_plant.faces;

            const mesh = new THREE.Mesh(geom, plantMat);
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
        for (let y = 0; y < data.soil.n; y++) {
            for (let x = 0; x < data.soil.n; x++) {
                const v = data.soil.luminance[x + y * data.soil.n];
                let lighting = new THREE.Color().setRGB(v, v, v);
                context.fillStyle = lighting.getStyle();
                context.fillRect(x, data.soil.n - 1 - y, 1, 1);
            }
        }

        // Attach tiles to the base.
        let tex = new THREE.Texture(canvas);
        tex.needsUpdate = true;

        const soil_plate = new THREE.Mesh(
            new THREE.BoxGeometry(data.soil.size, data.soil.size, 1e-1),
            new THREE.MeshBasicMaterial({map: tex}));
        proxy.add(soil_plate);
        // hides flipped backside texture
        const soilBackPlate = new THREE.Mesh(
            new THREE.BoxGeometry(data.soil.size, data.soil.size, 1),
            new THREE.MeshBasicMaterial({color: '#333'}));
        soilBackPlate.position.set(0, 0, -(1 + 1e-1)/2);
        proxy.add(soilBackPlate);

        return proxy;
    }

    /* UI Utils */
    animate() {
        this.stats.begin();

        // note: three.js includes requestAnimationFrame shim
        let _this = this;
        requestAnimationFrame(() => { this.animate(); });

        this.renderer.render(this.scene, this.camera);
        this.controls.update();

        this.stats.end();
    }
}


// run app
$(document).ready(() => {
    const bonsai = new Bonsai();
    bonsai.animate();
});
