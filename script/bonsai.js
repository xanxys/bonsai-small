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
        this.camera.position.set(70, 70, 50);
        this.camera.lookAt(new THREE.Vector3(0, 0, 15));

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
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        document.getElementById('main').append(this.renderer.domElement);

        // add mouse control (need to be done after canvas insertion)
        this.controls = new TrackballControls(this.camera, this.renderer.domElement);
        this.controls.maxDistance = 500;
 
        this.controls.on_click = posNdc => {
            const caster = new THREE.Raycaster();
            caster.setFromCamera(posNdc, this.camera);
            const intersections = caster.intersectObject(this.scene, true);

            if (intersections.length > 0 && intersections[0].object.instanceIdToPlantId !== undefined) {
                this.selectedPlantId = intersections[0].object.instanceIdToPlantId.get(intersections[0].instanceId);
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
                aboutPanelVisible: false,

                playing: false,
                age: 0,

                chunkInfoText: '',
                simInfoText: '',
                plantGenome: null,

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
                        this.plantGenome = null;
                        return;
                    }
            
                    this.plantGenome = genome.genes.map(gene => {
                        return {
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
                this.vm.updateGenomeView(Genome.decode(payload.stat.genome));
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
        const sunlight = new THREE.DirectionalLight();
        sunlight.intensity = 0.8;
        sunlight.position.set(0, 0, 250);
        sunlight.castShadow = true;
        
        const halfSize = 50;
        const halfSizeWithMargin = halfSize * 1.2;
        sunlight.shadow.camera.left = -halfSizeWithMargin;
        sunlight.shadow.camera.bottom = -halfSizeWithMargin;
        sunlight.shadow.camera.right = halfSizeWithMargin;
        sunlight.shadow.camera.top = halfSizeWithMargin;
        sunlight.shadow.camera.updateProjectionMatrix();
        this.scene.add(sunlight);
        //this.scene.add(new THREE.CameraHelper(sunlight.shadow.camera));

        const amblight = new THREE.AmbientLight();
        amblight.intensity = 0.2;
        this.scene.add(amblight);

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
            new THREE.BoxGeometry(cursorSize.x, cursorSize.y, cursorSize.z),
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
        const cellInstanceGeom = new THREE.BoxGeometry(1, 1, 1);
        const cellInstanceMat = new THREE.MeshStandardMaterial();

        let cellCount = 0;
        chunk.plants.forEach(plant => {
            cellCount += plant.cells.length;
        });

        const cellMesh = new THREE.InstancedMesh(cellInstanceGeom, cellInstanceMat, cellCount);
        const instanceIdToPlantId = new Map();
        let cellIndex = 0;
        chunk.plants.forEach(plant => {
            plant.cells.forEach(cell => {
                const m = new THREE.Matrix4();
                m.set(...cell.mat);
                m.transpose();
                m.scale(new THREE.Vector3(...cell.size));

                cellMesh.setColorAt(cellIndex, new THREE.Color(cell.col.r, cell.col.g, cell.col.b));
                cellMesh.setMatrixAt(cellIndex, m);
                instanceIdToPlantId.set(cellIndex, plant.id);

                cellIndex++;
            });
        });
        cellMesh.instanceIdToPlantId = instanceIdToPlantId;
        cellMesh.receiveShadow = true;
        cellMesh.castShadow = true;
        proxy.add(cellMesh);


        // de-serialize soil
        const soilInstanceGeom = new THREE.BoxGeometry(1, 1, 1);
        const soilInstanceMat = new THREE.MeshStandardMaterial({color:'#877'});
        const soilMesh = new THREE.InstancedMesh(soilInstanceGeom, soilInstanceMat, chunk.soil.blocks.length);
        chunk.soil.blocks.forEach((block, blockIx) => {
            const m = new THREE.Matrix4();
            m.compose(
                new THREE.Vector3(block.t.x, block.t.y, block.t.z),
                new THREE.Quaternion(block.r.x, block.r.y, block.r.z, block.r.w),
                new THREE.Vector3(1,1,1));
            m.scale(new THREE.Vector3(block.s.x, block.s.y, block.s.z));
            soilMesh.setMatrixAt(blockIx, m);
        });
        soilMesh.receiveShadow = true;
        soilMesh.castShadow = true;
        proxy.add(soilMesh);

        return proxy;
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
