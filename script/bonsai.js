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
        this.scene = new THREE.Scene();

        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.5, 1500);
        this.camera.up = new THREE.Vector3(0, 0, 1);
        this.camera.position.set(30, 30, 40);
        this.camera.lookAt(new THREE.Vector3(0, 0, 0));

        this._insertBackground();

        // 3D view data
        this.chunkState = {};
        this.selectedPlantId = null;
        this.num_plant_history = [];
        this.energy_history = [];

        // 3D view presentation
        this.currProxy = null;
        this.selectionCursor = null;

        // start canvas
        this.renderer = new THREE.WebGLRenderer({antialias: true});
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setClearColor('#eee');
        document.getElementById('main').append(this.renderer.domElement);

        // add mouse control (need to be done after canvas insertion)
        this.controls = new TrackballControls(this.camera, this.renderer.domElement);
        this.controls.maxDistance = 500;
 
        this.controls.on_click = posNdc => {
            const caster = new THREE.Raycaster();
            caster.setFromCamera(posNdc, this.camera);
            const intersections = caster.intersectObject(this.scene, true);

            if (intersections.length > 0 && intersections[0].object.plantId !== undefined) {
                this.selectedPlantId = intersections[0].object.plantId;
            } else {
                this.selectedPlantId = null;
            }
            this._updatePlantSelection();
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

                chunkInfoText: '',
                simInfoText: '',

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

                plantInfoText: '',
                cells: [],

                genome: [],
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
                        app.requestExecStep(1);
                    }
                },
                onClickStep: function(n) {
                    this.playing = false;
                    app.requestExecStep(n);
                },
                notifyStepComplete: function() {
                    if (this.playing) {
                        setTimeout(() => {
                            app.requestExecStep(1);
                        }, 50);
                    }
                },

                onClickKillPlant: function() {
                    if (app.curr_selection !== null) {
                        app.requestKillPlant(app.selectedPlantId);
                        app.requestPlantStatUpdate();
                    }
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

                updatePlantView: function(stat) {
                    const statsWithoutCellDetail = {};
                    Object.assign(statsWithoutCellDetail, stat);
                    delete statsWithoutCellDetail.cells;
                    this.plantInfoText = JSON.stringify(statsWithoutCellDetail, null, 2);
             
                    let cells = [];
                    if (stat !== null) {
                        cells = stat['cells'].map(cellStat => JSON.stringify(cellStat, null, 0));
                    }
                    this.cells = cells;
                },

                updateGenomeView: function(genome) {
                    function convertSignals(sigs) {
                        return sigs.map(sig => {
                            const desc = parseIntrinsicSignal(sig);
            
                            const classObj = {};
                            classObj['ct-' + desc.type] = true;
            
                            const role = desc.long === '' ? ' ' : desc.long;
                            return {
                                seq: desc.raw,
                                classObj: classObj,
                                role: role,
                            };
                        });
                    }
            
                    if (genome === null) {
                        this.genome = [];
                        return;
                    }
            
                    this.genome = genome.unity.map(gene => {
                        return {
                            name: gene["tracer_desc"],
                            when: convertSignals(gene.when),
                            emit: convertSignals(gene.emit),
                        };
                    });
                }
            },
        });

        this.chunkWorker = new Worker('script/worker.js');
        this.chunkWorker.addEventListener('message', ev => {
            const msgType = ev.data.type;
            const payload = ev.data.data;

            if (msgType === 'init-complete') {
                this.chunkWorker.postMessage({
                    type: 'serialize'
                });
            } else if (msgType === 'serialize') {
                this.chunkState = payload;
                this._updateProxy();
                this._updatePlantSelection();
            } else if (msgType === 'stat-chunk') {
                this.vm.age = payload['age/T'];
                this.num_plant_history.push(payload["plant"]);
                this.energy_history.push(payload["stored/E"]);
                this.vm.updateGraph();
                this.vm.chunkInfoText = JSON.stringify(payload, null, 2);
            } else if (msgType === 'step-complete') {
                this.vm.simInfoText = JSON.stringify(payload, null, 2);
                this.vm.notifyStepComplete();
            } else if (msgType === 'stat-plant') {
                this.vm.updatePlantView(payload.stat);
            } else if (msgType === 'genome-plant') {
                this.vm.updateGenomeView(payload.genome);
            }
        }, false);
    }

    /* chunk worker interface */
    requestKillPlant(plantId) {
        this.chunkWorker.postMessage({
            type: 'kill',
            data: {id: plantId}
        });
        this.chunkWorker.postMessage({
            type: 'serialize'
        });
    }

    requestExecStep(n) {
        for (let i = 0; i < n; i++) {
            this.chunkWorker.postMessage({
                type: 'step'
            });
            this.chunkWorker.postMessage({
                type: 'stat'
            });
            this.requestPlantStatUpdate();
        }
        this.chunkWorker.postMessage({
            type: 'serialize'
        });   
    }

    requestPlantStatUpdate() {
        this.chunkWorker.postMessage({
            type: 'stat-plant',
            data: {
                id: this.selectedPlantId
            }
        });
        this.chunkWorker.postMessage({
            type: 'genome-plant',
            data: {
                id: this.selectedPlantId
            }
        });
    }

    /* 3D UI */
    _insertBackground() {
        const sunlight = new THREE.DirectionalLight(0xcccccc);
        sunlight.position.set(0, 0, 100).normalize();
        this.scene.add(sunlight);

        this.scene.add(new THREE.AmbientLight(0x333333));

        const bg = new THREE.Mesh(
            new THREE.IcosahedronGeometry(800, 1),
            new THREE.MeshBasicMaterial({
                wireframe: true,
                color: '#ccc'
            }));
        this.scene.add(bg);
    }

    _updatePlantSelection() {
        if (this.selectionCursor !== null) {
            this.scene.remove(this.selectionCursor);
        }

        const plant = this.chunkState.plants.find(plant => plant.id === this.selectedPlantId);
        if (plant === undefined) {
            return;
        }

        this.selectionCursor = this.createSelectionCursor(plant);
        this.scene.add(this.selectionCursor);
        this.requestPlantStatUpdate();
    }

    _updateProxy() {
        const proxy = this._createProxy(this.chunkState);

        if (this.currProxy !== null) {
            this.scene.remove(this.currProxy);
        }
        this.scene.add(proxy);
        this.currProxy = proxy;
    }

    /**
     * @param {PlantData} plant 
     * @returns {THREE.Object3D}
     */
    createSelectionCursor(plant) {
        // Calculate AABB of the plant.
        const vMin = new THREE.Vector3(1e5, 1e5, 1e5);
        const vMax = new THREE.Vector3(-1e5, -1e5, -1e5);
        plant.cells.forEach(cell => {
            const m = new THREE.Matrix4();
            m.set(...cell.mat);
            m.transpose();

            const t = new THREE.Vector3();
            const r = new THREE.Quaternion();
            const s = new THREE.Vector3();
            m.decompose(t, r, s);

            vMin.min(t);
            vMax.max(t);
        });

        // Create cursor.
        const padding = new THREE.Vector3(1, 1, 1);
        vMin.sub(padding);
        vMax.add(padding);

        const cursorSize = vMax.clone().sub(vMin);
        const cursorCenter = vMax.clone().add(vMin).multiplyScalar(0.5);

        const cursor = new THREE.Mesh(
            new THREE.CubeGeometry(cursorSize.x, cursorSize.y, cursorSize.z),
            new THREE.MeshBasicMaterial({
                wireframe: true,
                color: new THREE.Color("rgb(173,127,168)"),
                wireframeLinewidth: 2,
            }));
        cursor.position.copy(cursorCenter.clone().add(new THREE.Vector3(0, 0, 5e-1 + 1e-1)));
        return cursor;
    }

    /**
     * @param {ChunkData} chunk 
     * @returns {THREE.Object3D}
     */
    _createProxy(chunk) {
        const proxy = new THREE.Object3D();

        // de-serialize plants
        chunk.plants.forEach(plant => {
            plant.cells.forEach(cell => {
                const mat = new THREE.MeshLambertMaterial({color: new THREE.Color(cell.col.r, cell.col.g, cell.col.b)});
                const geom = new THREE.BoxGeometry(1, 1, 1);
                const cellMesh = new THREE.Mesh(geom, mat);
                cellMesh.plantId = plant.id;
                 
                proxy.add(cellMesh);
                cellMesh.matrixAutoUpdate = false;
                cellMesh.matrix.set(...cell.mat);
                cellMesh.matrix.transpose();
                cellMesh.matrix.scale(new THREE.Vector3(...cell.size));
                cellMesh.matrixWorldNeedsUpdate = true;
            });
        });

        // Attach tiles to the base.
        const tex = this._deserializeSoilTexture(chunk.soil);
        const soil_plate = new THREE.Mesh(
            new THREE.BoxGeometry(chunk.soil.size, chunk.soil.size, 1e-1),
            new THREE.MeshBasicMaterial({map: tex}));
        proxy.add(soil_plate);

        // hides flipped backside texture
        const soilBackPlate = new THREE.Mesh(
            new THREE.BoxGeometry(chunk.soil.size, chunk.soil.size, 1),
            new THREE.MeshBasicMaterial({color: '#333'}));
        soilBackPlate.position.set(0, 0, -(1 + 1e-1)/2);
        proxy.add(soilBackPlate);

        return proxy;
    }

    _deserializeSoilTexture(soil) {
        const texSize = 64;

        if (this.soilDeserializerCanvas === undefined) {
            const canvas = document.createElement('canvas');
            canvas.width = texSize;
            canvas.height = texSize;
            this.soilDeserializerCanvas = canvas;
        }

        const ctx = this.soilDeserializerCanvas.getContext('2d');
        ctx.save();
        ctx.scale(texSize / soil.n, texSize / soil.n);
        for (let y = 0; y < soil.n; y++) {
            for (let x = 0; x < soil.n; x++) {
                const v = soil.luminance[x + y * soil.n];
                let lighting = new THREE.Color().setRGB(v, v, v);
                ctx.fillStyle = lighting.getStyle();
                ctx.fillRect(x, soil.n - 1 - y, 1, 1);
            }
        }
        ctx.restore();

        const tex = new THREE.Texture(this.soilDeserializerCanvas);
        tex.needsUpdate = true;
        return tex;
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        this.renderer.render(this.scene, this.camera);
        this.controls.update();
    }
}

// run app
const bonsai = new Bonsai();
bonsai.animate();
