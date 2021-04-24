"use strict";

Vue.component('line-plot', Vue.extend({
    extends: VueChartJs.Line,
    mixins: [VueChartJs.mixins.reactiveProp],
    props: ['options'],
    mounted: function() {
        this.renderChart(this.chartData, this.options);
    },
}));

const CURSOR_MODE_INSPECT = 'inspect';
const CURSOR_MODE_ADD = 'add';

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

            if (this.vm.cursorMode === CURSOR_MODE_INSPECT) {
                if (intersections.length > 0 && intersections[0].object.instanceIdToPlantId !== undefined) {
                    this.vm.plantSelected = true;
                    this.selectedPlantId = intersections[0].object.instanceIdToPlantId.get(intersections[0].instanceId);
                } else {
                    this.vm.plantSelected = false;
                    this.selectedPlantId = null;
                }
                this._updatePlantSelection();
            } else if (this.vm.cursorMode === CURSOR_MODE_ADD) {
                if (intersections.length > 0) {
                    this.requestAddPlant(intersections[0].point);
                }
            }
        };

        const app = this;
        this.vm = new Vue({
            el: '#ui',
            data: {
                playing: false,
                age: 0,
                numPlants: 0,
                numCells: 0,
                storedEnergy: 0,

                showingChart: false,
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

                plantSelected: false,
                selectedPlant: {},

                genomeList: [],
                currentGenome: "",

                cursorMode: CURSOR_MODE_INSPECT,

                showingAbout: false,
                simInfoText: '',
            },
            created: function() {
                const defaultGenome = "a,g,p,p,p>s,daci,dlf,r|a,g,p,p,p>s,dacw,dah,ra|a,ig,p,p>w,ra|w,p,p>x,y,y,yy|l>z|l,p,p,p,p,p,p>x,x,x,x,xu,xk,y|s>z|a,p,p,p>x,y|l,p,p,p>chlr";

                this.genomeList.push({encoded: defaultGenome});
                this.currentGenome = defaultGenome;
            },
            methods: {
                onClickToggleChart: function() {
                    this.showingChart = !this.showingChart;
                },
                onClickAbout: function() {
                    this.showingAbout = !this.showingAbout;
                },

                onClickPlay: function() {
                    this.playing = true;
                    app.requestExecStep();
                },
                onClickPause: function() {
                    this.playing = false;
                },
                onClickStep: function() {
                    this.playing = false;
                    app.requestExecStep();
                },
                onClickKillPlant: function() {
                    if (app.curr_selection !== null) {
                        app.requestKillPlant(app.selectedPlantId);
                        app.requestPlantStatUpdate();
                    }
                    this.plantSelected = false;
                },

                notifyStepComplete: function() {
                    if (this.playing) {
                        setTimeout(() => {
                            app.requestExecStep(1);
                        }, 50);
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


                onClickInspect: function() {
                    this.cursorMode = CURSOR_MODE_INSPECT;
                },
                onClickAdd: function() {
                    this.cursorMode = CURSOR_MODE_ADD;
                },
                updatePlantView: function(plantId, stat) {
                    const genome = Genome.decode(stat.genome);
                    this.selectedPlant = {
                        id: plantId,
                        age: stat['age'],
                        numCells: stat['#cell'],
                        storedEnergy: stat['energy:stored'],
                        deltaEnergy: stat['energy:delta'],
                        genomeSize: stat.genome.length,
                        numGenes: genome.genes.length,
                        cells: stat['cells'].map(cellStat => JSON.stringify(cellStat, null, 0)),
                        genome: genome,
                    };
                },

                onClickCopy: function() {
                    navigator.clipboard.writeText(this.currentGenome);
                },
                onClickPaste: async function() {
                    const text = await navigator.clipboard.readText();
                    this._insertGenomeIfNew(text);
                },

                onClickSave: function() {
                    this._insertGenomeIfNew(this.selectedPlant.genome.encode());
                },
                onClickGenome: function(genome) {
                    this.currentGenome = genome;
                },

                /**
                 * @param {string} newGenome 
                 * @returns true if inserted. false otherwise (i.e. alread exists)
                 */
                _insertGenomeIfNew: function(newGenome) {
                    if (this.genomeList.find(g => g.encoded === newGenome) !== undefined) {
                        return false;
                    }
                    this.genomeList.push({encoded: newGenome});
                    return true;
                }
            },
            computed: {
                selectedPlantGenomeRegistered: function() {
                    if (this.selectedPlant === null || this.selectedPlant.genome === undefined) {
                        return;
                    }
                    const genome = this.selectedPlant.genome.encode();
                    return (this.genomeList.find(g => g.encoded === genome) !== undefined);
                },
                selectedPlantGenesStyled: function() {
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
                    if (this.selectedPlant.genome === undefined) {
                        return [];
                    }
                    return this.selectedPlant.genome.genes.map(gene => {
                        return {
                            when: convertSignals(gene.when),
                            emit: convertSignals(gene.emit),
                        };
                    });
                },
                isInspectMode: function() {
                    return this.cursorMode === CURSOR_MODE_INSPECT;
                },
                isAddMode: function() {
                    return this.cursorMode === CURSOR_MODE_ADD;
                },
            },
        });

        this.chunkWorker = new Worker('script/worker.js');
        this.chunkWorker.addEventListener('message', ev => {
            const msgType = ev.data.type;
            const payload = ev.data.data;

            if (msgType === 'init-complete-event') {
                this.chunkWorker.postMessage({
                    type: 'serialize-req'
                });
            } else if (msgType === 'serialize-resp') {
                this.chunkState = payload;
                this._updateProxy();
                this._updatePlantSelection();

                this.vm.age = payload['stats']['age'];
                this.vm.numPlants = payload['stats']["#plant"];
                this.vm.numCells = payload['stats']["#cell"];
                this.vm.storedEnergy = payload['stats']["energy:stored"];
                this.num_plant_history.push(payload['stats']["#plant"]);
                this.energy_history.push(payload['stats']["energy:stored"]);
                this.vm.updateGraph();
            } else if (msgType === 'step-resp') {
                this.vm.simInfoText = JSON.stringify(payload, null, 2);
                this.vm.notifyStepComplete();
            } else if (msgType === 'inspect-plant-resp') {
                if (payload.stat !== null) {
                    this.vm.updatePlantView(payload.id, payload.stat);
                }
            } else {
                console.warn('unknown message type', msgType);
            }
        }, false);
    }

    /* chunk worker interface */
    requestAddPlant(pos) {
        this.chunkWorker.postMessage({
            type: 'add-plant-req',
            data: {
                position: {x: pos.x, y: pos.y, z: pos.z},
                encodedGenome: this.vm.currentGenome,
            },
        });
        this.chunkWorker.postMessage({
            type: 'serialize-req'
        });
    }

    requestKillPlant(plantId) {
        this.chunkWorker.postMessage({
            type: 'kill-plant-req',
            data: {id: plantId}
        });
        this.chunkWorker.postMessage({
            type: 'serialize-req'
        });
    }

    requestExecStep() {
        this.chunkWorker.postMessage({
            type: 'step-req'
        });
        this.requestPlantStatUpdate();
        this.chunkWorker.postMessage({
            type: 'serialize-req'
        });   
    }

    requestPlantStatUpdate() {
        this.chunkWorker.postMessage({
            type: 'inspect-plant-req',
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
                color: '#cccccc'
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
                color: new THREE.Color("#BC004F"),
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
        const soilInstanceMat = new THREE.MeshStandardMaterial({color:'#5A5165'});
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
