(function () {
    let Ammo = null;

    // Collections of cells that forms a "single" plant.
    // This is not biologically accurate depiction of plants,
    // (e.g. vegetative growth, physics)
    // Most plants seems to have some kind of information sharing system within them
    // via transportation of regulation growth factors.
    //
    // 100% efficiency, 0-latency energy storage and transportation within Plant.
    // (n.b. energy = power * time)
    //
    // position :: THREE.Vector3<World>
    class Plant {
        constructor(position, unsafeChunk, energy, genome, plantId) {
            this.unsafeChunk = unsafeChunk;

            // tracer
            this.age = 0;
            this.id = plantId;

            // physics
            const seedInnodeToWorld = new THREE.Matrix4().compose(
                position,
                new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.random() * 2 * Math.PI),
                new THREE.Vector3(1, 1, 1));
            this.position = position;

            // biophysics
            this.energy = energy;
            const seed = new Cell(this, Signal.SHOOT_END, null, seedInnodeToWorld);
            this.cells = [seed];  // flat cells in world coords

            // genetics
            this.genome = genome;
        }

        step() {
            // Step cells (w/o collecting/stepping separation, infinite growth will occur)
            this.age += 1;
            this.cells.forEach(cell => cell.step());

            // Consume/store in-Plant energy.
            this.energy += this._powerForPlant() * 1;

            if (this.energy <= 0) {
                // die
                this.unsafeChunk.removePlant(this);
            }
        }

        // Approximates lifetime of the plant.
        // Max growth=1, zero growth=0.
        // return :: [0,1]
        growthFactor() {
            return Math.exp(-this.age / 20);
        }

        serializeCells() {
            return this.cells.map(cell => {
                return {
                    'mat': Array.from(cell.cellToWorld.elements),
                    'size': [cell.sx, cell.sy, cell.sz],
                    'col': cell.getCellColor(),
                };
            });
        }

        getStat() {
            const statCells = this.cells.map(cell => cell.signals);
            const stat = {};
            stat["#cells"] = statCells.length;
            stat['cells'] = statCells;
            stat['age/T'] = this.age;
            stat['stored/E'] = this.energy;
            stat['delta/(E/T)'] = this._powerForPlant();
            return stat;
        }

        getGenome() {
            return this.genome;
        }

        _powerForPlant() {
            return sum(this.cells.map(cell => cell.powerForPlant()));
        }
    }

    // Cell's local coordinates is symmetric for X,Y, but not Z.
    // Normally Z is growth direction, assuming loc_to_parent to near to identity.
    //
    //  Power Generation (<- Light):
    //    sum of photosynthesis (LEAF)
    //  Power Consumption:
    //    basic (minimum cell volume equivalent)
    //    linear-volume
    class Cell {
        constructor(plant, initialSignal, parentCell, cellToWorld) {
            // tracer
            this.age = 0;

            // in-sim (light)
            this.photons = 0;

            // in-sim (phys + bio)
            this.sx = 0.5;
            this.sy = 0.5;
            this.sz = 0.5;
            this.cellToWorld = cellToWorld;

            // in-sim (bio)
            this.plant = plant;
            this.parentCell = parentCell;
            this.power = 0;

            // in-sim (genetics)
            this.signals = [initialSignal];
        }

        getMass() {
            return 1e-3 * this.sx * this.sy * this.sz;  // kg
        }

        // Return net usable power for Plant.
        // return :: float<Energy>
        powerForPlant() {
            return this.power;
        }

        _beginUsePower() {
            this.power = 0;
        }

        // return :: bool
        _withdrawEnergy(amount) {
            if (this.plant.energy > amount) {
                this.plant.energy -= amount;
                this.power -= amount;

                return true;
            } else {
                return false;
            }
        }

        _withdrawVariableEnergy(max_amount) {
            let amount = Math.min(Math.max(0, this.plant.energy), max_amount);
            this.plant.energy -= amount;
            this.power -= amount;
            return amount;
        }

        _withdrawStaticEnergy() {
            let delta_static = 0;

            // +: photo synthesis
            let efficiency = this._getPhotoSynthesisEfficiency();
            delta_static += this.photons * 1e-9 * 15000 * efficiency;

            // -: basic consumption (stands for common func.)
            delta_static -= 100 * 1e-9;

            // -: linear-volume consumption (stands for cell substrate maintainance)
            let volume_consumption = 1e-6;
            delta_static -= this.sx * this.sy * this.sz * volume_consumption;

            this.photons = 0;

            if (this.plant.energy < delta_static) {
                this.plant.energy = -1e-3;  // set death flag (TODO: implicit value encoding is bad idea)
            } else {
                this.power += delta_static;
                this.plant.energy += delta_static;
            }
        };

        _getPhotoSynthesisEfficiency() {
            // 1:1/2, 2:3/4, etc...
            let num_chl = sum(this.signals.map(sig => {
                return (sig === Signal.CHLOROPLAST) ? 1 : 0;
            }));

            return 1 - Math.pow(0.5, num_chl);
        }

        // return :: ()
        step() {
            let _this = this;
            this.age += 1;
            this._beginUsePower();
            this._withdrawStaticEnergy();

            // Unified genome.
            function unity_calc_prob_term(signal) {
                if (signal === Signal.HALF) {
                    return 0.5;
                } else if (signal === Signal.GROWTH) {
                    return _this.plant.growthFactor();
                } else if (signal.length >= 2 && signal[0] === Signal.INVERT) {
                    return 1 - unity_calc_prob_term(signal.substr(1));
                } else if (_this.signals.includes(signal)) {
                    return 1;
                } else {
                    return 0.001;
                }
            }

            function unity_calc_prob(when) {
                return product(when.map(unity_calc_prob_term));
            }

            // Gene expression and transcription.
            this.plant.genome.unity.forEach(gene => {
                if (unity_calc_prob(gene['when']) > Math.random()) {
                    let num_codon = sum(gene['emit'].map(sig => {
                        return sig.length
                    }));

                    if (_this._withdrawEnergy(num_codon * 1e-10)) {
                        _this.signals = _this.signals.concat(gene['emit']);
                    }
                }
            });

            // Bio-physics.
            // TODO: define remover semantics.
            let removers = {};
            this.signals.forEach(signal => {
                if (signal.length >= 2 && signal[0] === Signal.REMOVER) {
                    let rm = signal.substr(1);
                    if (removers[rm] !== undefined) {
                        removers[rm] += 1;
                    } else {
                        removers[rm] = 1;
                    }
                }
            });

            let new_signals = [];
            this.signals.forEach(signal => {
                if (signal.length === 3 && signal[0] === Signal.DIFF) {
                    _this.addCont(signal[1], signal[2]);
                } else if (signal === Signal.G_DX) {
                    _this.sx = Math.min(5, _this.sx + 0.1);
                } else if (signal === Signal.G_DY) {
                    _this.sy = Math.min(5, _this.sy + 0.1);
                } else if (signal === Signal.G_DZ) {
                    _this.sz = Math.min(5, _this.sz + 0.1);
                } else if (removers[signal] !== undefined && removers[signal] > 0) {
                    removers[signal] -= 1;
                } else {
                    new_signals.push(signal);
                }
            });
            this.signals = new_signals;

            // Physics
            if (this.signals.includes(Signal.FLOWER)) {
                // Disperse seed once in a while.
                // TODO: this should be handled by physics, not biology.
                // Maybe dead cells with stored energy survives when fallen off.
                if (Math.random() < 0.01) {
                    let seedEnergy = _this._withdrawVariableEnergy(Math.pow(20e-3, 3) * 10);

                    // Get world coordinates.
                    let trans = new THREE.Vector3();
                    let _rot = new THREE.Quaternion();
                    let _scale = new THREE.Vector3();
                    this.cellToWorld.decompose(trans, _rot, _scale);

                    // TODO: should be world coodinate of the flower
                    this.plant.unsafeChunk.disperseSeedFrom(
                        trans, seedEnergy, this.plant.genome.naturalClone());
                }
            }
        }

        /**
         * 
         * @returns {THREE.Matrix4}
         */
        getOutNodeToWorld() {
            const locToOutnode = new THREE.Matrix4().makeTranslation(0, 0, -this.sz / 2);
            const outnodeToLoc = new THREE.Matrix4().copy(locToOutnode).invert();
            return this.cellToWorld.clone().multiply(outnodeToLoc);
        }

        getBtTransform() {
            const trans = new THREE.Vector3();
            const quat = new THREE.Quaternion();
            const unusedScale = new THREE.Vector3();
            this.cellToWorld.decompose(trans, quat, unusedScale);

            const tf = new Ammo.btTransform();
            tf.setIdentity();
            tf.setOrigin(new Ammo.btVector3(trans.x, trans.y, trans.z));
            tf.setRotation(new Ammo.btQuaternion(quat.x, quat.y, quat.z, quat.w));
            return tf;
        }

        setBtTransform(tf) {
            const t = tf.getOrigin();
            const r = tf.getRotation();
            this.cellToWorld.compose(
                new THREE.Vector3(t.x(), t.y(), t.z()),
                new THREE.Quaternion(r.x(), r.y(), r.z(), r.w()),
                new THREE.Vector3(1, 1, 1));
        }

        getCellColor() {
            // Create cell object [-sx/2,sx/2] * [-sy/2,sy/2] * [0, sz]
            let flrRatio = (this.signals.includes(Signal.FLOWER)) ? 0.5 : 1;
            let chlRatio = 1 - this._getPhotoSynthesisEfficiency();

            const colorDiffuse = new THREE.Color();
            colorDiffuse.setRGB(
                chlRatio,
                flrRatio,
                flrRatio * chlRatio);

            if (this.photons === 0) {
                colorDiffuse.offsetHSL(0, 0, -0.4);
            }
            if (this.plant.energy < 1e-4) {
                let t = 1 - this.plant.energy * 1e4;
                colorDiffuse.offsetHSL(0, -t, 0);
            }
            return {r:colorDiffuse.r, g:colorDiffuse.g, b:colorDiffuse.b};
        }

        givePhoton() {
            this.photons += 1;
        }

        // initial :: Signal
        // locator :: LocatorSignal
        // return :: ()
        addCont(initial, locator) {
            function calcRot(desc) {
                if (desc === Signal.CONICAL) {
                    return new THREE.Quaternion().setFromEuler(new THREE.Euler(
                        Math.random() - 0.5,
                        Math.random() - 0.5,
                        0));
                } else if (desc === Signal.HALF_CONICAL) {
                    return new THREE.Quaternion().setFromEuler(new THREE.Euler(
                        (Math.random() - 0.5) * 0.5,
                        (Math.random() - 0.5) * 0.5,
                        0));
                } else if (desc === Signal.FLIP) {
                    return new THREE.Quaternion().setFromEuler(new THREE.Euler(
                        -Math.PI / 2,
                        0,
                        0));
                } else if (desc === Signal.TWIST) {
                    return new THREE.Quaternion().setFromEuler(new THREE.Euler(
                        0,
                        0,
                        (Math.random() - 0.5) * 1));
                } else {
                    return new THREE.Quaternion();
                }
            }

            const newcellToOutnode = new THREE.Matrix4().makeRotationFromQuaternion(calcRot(locator));
            const newcellToWorld = this.getOutNodeToWorld().multiply(newcellToOutnode);
            const newCell = new Cell(this.plant, initial, this, newcellToWorld);
            this.plant.cells.push(newCell);            
        }
    }

    // Represents soil surface state by a grid.
    // parent :: Chunk
    // size :: float > 0
    class Soil {
        constructor(parent, size) {
            this.parent = parent;

            this.n = 64;
            this.size = size;
        }

        serialize() {
            let array = [];
            for (let y = 0; y < this.n; y++) {
                for (let x = 0; x < this.n; x++) {
                    let v = Math.min(1, this.parent.light.shadowMap[x + y * this.n] / 2 + 0.1);
                    array.push(v);
                }
            }
            return {
                luminance: array,
                n: this.n,
                size: this.size
            };
        }
    }

    // Downward directional light.
    class Light {
        constructor(chunk, size) {
            this.chunk = chunk;

            this.n = 64;
            this.size = size;

            // number of photos that hit ground.
            this.shadowMap = new Float32Array(this.n * this.n);
        }

        step() {
            this._updateShadowMap(this.chunk.rigidWorld, this.chunk.indexToCell);
        }

        _updateShadowMap(rigidWorld, indexToCell) {
            const posFrom = new Ammo.btVector3();
            const posTo = new Ammo.btVector3();
            for (let i = 0; i < this.n; i++) {
                for (let j = 0; j < this.n; j++) {
                    this.shadowMap[i + j * this.n] = 0;

                    // 50% light in smaller i region
                    if (i < this.n / 2 && Math.random() < 0.5) {
                        continue;
                    }

                    const cb = new Ammo.ClosestRayResultCallback();
                    const x = ((i + Math.random()) / this.n - 0.5) * this.size;
                    const y = ((j + Math.random()) / this.n - 0.5) * this.size;
                    posFrom.setValue(x, y, 100);
                    posTo.setValue(x, y, -1);
                    rigidWorld.rayTest(posFrom, posTo, cb);

                    if (cb.hasHit()) {
                        const uIndex = cb.m_collisionObject.getUserIndex();
                        const cell = indexToCell.get(uIndex);
                        if (cell !== undefined) {
                            cell.givePhoton();
                        } else {
                            // hit ground
                            this.shadowMap[i + j * this.n] += 1.0;    
                        }
                    } else {
                        // hit nothing (shouldn't happen)
                    }
                    Ammo.destroy(cb);
                }
            }
            Ammo.destroy(posFrom);
            Ammo.destroy(posTo);
        }
    }

    /**
     * A chunk is non-singleton, finite patch of space containing bunch of plants, soil,
     * and light field.
     * Chunk have no coupling with DOM or external state. Main methods are
     * step & serialize. Other methods are mostly for statistics.
     */  
    class Chunk {
        constructor() {
            // Chunk spatial constants.
            this.size = 100;
            this.thickness = 5;

            // tracer
            this.age = 0;
            this.new_plant_id = 0;

            // Entities.
            this.plants = [];  // w/ internal "bio" aspect
            this.soil = new Soil(this, this.size);
            this.seeds = [];

            // chunk <-> ammo object mappings
            this.userIndex = 1;
            this.cellToIndex = new Map(); // Cell -> btRigidBody userindex
            this.indexToCell = new Map(); // btRigidBody userindex -> Cell
            this.indexToRigidBody = new Map(); // btRigidBody userindex -> btRigidBody

            this.indexToConstraint = new Map(); // btRigidBody userindex (child) -> btConstraint

            // Physical aspects.
            this.light = new Light(this, this.size);
            this.rigidWorld = this._createRigidWorld();
            this.light.step(); // update shadow map
        }

        _createRigidWorld() {
            const collisionConfig = new Ammo.btDefaultCollisionConfiguration();
            const dispatcher = new Ammo.btCollisionDispatcher(collisionConfig);
            const overlappingPairCache = new Ammo.btDbvtBroadphase();
            const solver = new Ammo.btSequentialImpulseConstraintSolver();
            const rigidWorld = new Ammo.btDiscreteDynamicsWorld(dispatcher, overlappingPairCache, solver, collisionConfig);
            rigidWorld.setGravity(new Ammo.btVector3(0, 0, -100));

            // Add ground.
            const groundShape = new Ammo.btBoxShape(new Ammo.btVector3(this.size / 2, this.size / 2, this.thickness / 2));
            const trans = new Ammo.btTransform();
            trans.setIdentity();
            trans.setOrigin(new Ammo.btVector3(0, 0, -this.thickness / 2));

            const motion = new Ammo.btDefaultMotionState(trans);
            const rbInfo = new Ammo.btRigidBodyConstructionInfo(0, motion, groundShape, new Ammo.btVector3(0, 0, 0)); // static (mass,intertia=0)
            const ground = new Ammo.btRigidBody(rbInfo);

            ground.setUserIndex(0);
            rigidWorld.addRigidBody(ground);
            this.groundRb = ground;

            return rigidWorld;
        }

        // Add standard plant seed.
        addDefaultPlant(pos) {
            return this.addPlant(
                pos,
                Math.pow(20e-3, 3) * 100, // allow 2cm cube for 100T)
                new Genome());
        }

        // pos :: THREE.Vector3 (z must be 0)
        // energy :: Total starting energy for the new plant.
        // genome :: genome for new plant
        // return :: Plant
        addPlant(pos, energy, genome) {
            console.assert(Math.abs(pos.z) < 1e-3);

            // Torus-like boundary
            pos = new THREE.Vector3(
                (pos.x + 1.5 * this.size) % this.size - this.size / 2,
                (pos.y + 1.5 * this.size) % this.size - this.size / 2,
                pos.z);

            let shoot = new Plant(pos, this, energy, genome, this.new_plant_id);
            this.new_plant_id += 1;
            this.plants.push(shoot);

            return shoot;
        }

        // pos :: THREE.Vector3
        // return :: ()
        disperseSeedFrom(pos, energy, genome) {
            console.assert(pos.z >= 0);
            // Discard seeds thrown from too low altitude.
            if (pos.z < 0.01) {
                return;
            }

            let angle = Math.PI / 3;

            let sigma = Math.tan(angle) * pos.z;

            // TODO: Use gaussian
            let dx = sigma * 2 * (Math.random() - 0.5);
            let dy = sigma * 2 * (Math.random() - 0.5);

            this.seeds.push({
                pos: new THREE.Vector3(pos.x + dx, pos.y + dy, 0),
                energy: energy,
                genome: genome
            });
        }

        // Plant :: must be returned by add_plant
        // return :: ()
        removePlant(plant) {
            this.plants = this.plants.filter(p => p !== plant);
        }

        // return :: dict
        getStat() {
            let storedEnergy = sum(this.plants.map(plant => {
                return plant.energy;
            }));

            return {
                'age/T': this.age,
                'plant': this.plants.length,
                'stored/E': storedEnergy
            };
        }

        /**
         * Retrieve current statistics about specified plant id.
         * @param {number} plant id 
         * @returns {Object | null}
         */
        getPlantStat(plantId) {
            let stat = null;
            this.plants.forEach(plant => {
                if (plant.id === plantId) {
                    stat = plant.getStat();
                }
            });
            return stat;
        }

        /**
         * 
         * @param {*} plantId 
         * @returns {Array | null}
         */
        getPlantGenome(plantId) {
            let genome = null;
            this.plants.forEach(plant =>{
                if (plant.id === plantId) {
                    genome = plant.getGenome();
                }
            });
            return genome;
        }

        /**
         * @returns {Object} stats
         */
        step() {
            this.age += 1;

            let t0 = 0;
            let sim_stats = {};

            t0 = performance.now();
            this.plants.forEach(plant => {
                plant.step();
            });

            this.seeds.forEach(seed => {
                this.addPlant(seed.pos, seed.energy, seed.genome);
            });
            this.seeds = [];
            sim_stats['bio/ms'] = performance.now() - t0;

            t0 = performance.now();
            const numLiveCells = this._syncCellsToRigid();
            sim_stats['#live_cell'] = numLiveCells;
            sim_stats['cell->rigid/ms'] = performance.now() - t0;

            t0 = performance.now();
            this.light.step(this.rigidWorld, this.indexToCell);
            sim_stats['light/ms'] = performance.now() - t0;

            t0 = performance.now();
            this.rigidWorld.stepSimulation(0.04, 2);
            this._syncRigidToCells();
            sim_stats['rigid/ms'] = performance.now() - t0;

            return sim_stats;
        }

        /**
         * Sync cell creation, growth, removal.
         * - creation: sets initial transform & constraint
         * - growth: sets size
         * - removal: removes dead cells.
         * Other cells remain untouched.
         * 
         * @returns {number} num of live cells
         */
        _syncCellsToRigid() {
            // NOTE: all new Ammo.XXXX() calls must be acoompanied by Ammo.destroy(), otherwise memory will leak.

            // Add/Update cells.
            const liveCells = new Set();
            for (const plant of this.plants) {
                for (const cell of plant.cells) {
                    const cellIndex = this.cellToIndex.get(cell);
                    const rb = cellIndex !== undefined ? this.indexToRigidBody.get(cellIndex) : undefined;

                    if (rb === undefined) {
                        // Add cell.
                        const boxSize = new Ammo.btVector3(0.5, 0.5, 0.5);
                        const localScaling = new Ammo.btVector3(cell.sx, cell.sy, cell.sz);
                        const cellShape = new Ammo.btBoxShape(boxSize); // (1cm)^3 cube
                        cellShape.setLocalScaling(localScaling);
                        Ammo.destroy(boxSize);
                        Ammo.destroy(localScaling);

                        const localInertia = new Ammo.btVector3(0, 0, 0);
                        cellShape.calculateLocalInertia(cell.getMass(), localInertia);
                        // TODO: Is it correct to use total mass, after LocalScaling??

                        const motionState = new Ammo.btDefaultMotionState(cell.getBtTransform());
                        const rbInfo = new Ammo.btRigidBodyConstructionInfo(cell.getMass(), motionState, cellShape, localInertia);
                        const rb = new Ammo.btRigidBody(rbInfo);
                        rb.setFriction(0.8);
                        this.addCellAsRigidBody(rb, cell);

                        Ammo.destroy(localInertia);
                        //Ammo.destroy(motionState); // this will lead to crash
                        Ammo.destroy(rbInfo);
                    } else {
                        const localScaling = new Ammo.btVector3(cell.sx, cell.sy, cell.sz);
                        const localInertia = new Ammo.btVector3(0, 0, 0);

                        // Update cell size.
                        rb.getCollisionShape().setLocalScaling(localScaling);
                        rb.getCollisionShape().calculateLocalInertia(cell.getMass(), localInertia);
                        rb.setMassProps(cell.getMass(), localInertia);
                        rb.updateInertiaTensor();
                        // TODO: maybe need to call some other updates?

                        Ammo.destroy(localScaling);
                        Ammo.destroy(localInertia);
                    }
                    liveCells.add(cell);
                }
            }

            // Add/Update constraints. (assumes each cell has exactly 1 constraint)
            const tfCell = new Ammo.btTransform();
            const tfParent = new Ammo.btTransform();
            for (const cell of liveCells) {
                const cellIndex = this.cellToIndex.get(cell);
                const constraint = this.indexToConstraint.get(cellIndex);

                tfCell.setIdentity();
                tfCell.setOrigin(new Ammo.btVector3(0, 0, -cell.sz / 2)); // innode

                tfParent.setIdentity();
                if (cell.parentCell === null) {
                    // point on ground
                    tfParent.setOrigin(new Ammo.btVector3(cell.plant.position.x, cell.plant.position.y, this.thickness / 2));
                } else {
                    // outnode of parent
                    tfParent.setOrigin(new Ammo.btVector3(0, 0, cell.parentCell.sz / 2));
                }

                if (constraint === undefined) {
                    const rb = this.indexToRigidBody.get(cellIndex);

                    // Add constraint.
                    let parentRb = cell.parentCell === null ? this.groundRb : this.indexToRigidBody.get(this.cellToIndex.get(cell.parentCell));
                    let constraint = new Ammo.btGeneric6DofSpringConstraint(rb, parentRb, tfCell, tfParent, true);
                    constraint.setAngularLowerLimit(new Ammo.btVector3(0.01, 0.01, 0.01));
                    constraint.setAngularUpperLimit(new Ammo.btVector3(-0.01, -0.01, -0.01));
                    constraint.setLinearLowerLimit(new Ammo.btVector3(0.01, 0.01, 0.01));
                    constraint.setLinearUpperLimit(new Ammo.btVector3(-0.01, -0.01, -0.01));
                    [0, 1, 2, 3, 4, 5].forEach(ix => {
                        constraint.enableSpring(ix, true);
                        constraint.setStiffness(ix, 100);
                        constraint.setDamping(ix, 0.1);
                    });
                    constraint.setBreakingImpulseThreshold(100);

                    this.rigidWorld.addConstraint(constraint, true); // true: collision between neighbors
                    this.indexToConstraint.set(cellIndex, constraint);
                } else {
                    // Update constraint.
                    const constraint = this.indexToConstraint.get(cellIndex);
                    constraint.setFrames(tfCell, tfParent);
                }
            }
            Ammo.destroy(tfCell);
            Ammo.destroy(tfParent);

            // Remove cells & constraints.
            for (const cell of this.cellToIndex.keys()) {
                if (!liveCells.has(cell)) {
                    const cellIndex = this.cellToIndex.get(cell);
                    this.removeConstraint(cellIndex);
                    this.removeCellAsRigidBody(cell);
                }
            }
            return liveCells.size;
        }
        
        addCellAsRigidBody(rb, cell) {
            const index = this.userIndex;
            this.userIndex++;
            if (this.userIndex >= 2**31) {
                console.warn('userIndex overflown; simulation might break');
                this.userIndex = 1; // restart from 1 (this will break if cell id 1 still retamins in the scene)
            }

            rb.setUserIndex(index);

            this.rigidWorld.addRigidBody(rb);
            this.cellToIndex.set(cell, index);
            this.indexToCell.set(index, cell);
            this.indexToRigidBody.set(index, rb);

            return index;
        }

        removeCellAsRigidBody(cell) {
            const index = this.cellToIndex.get(cell);
            console.assert(index !== undefined);
            const rb = this.indexToRigidBody.get(index);
            console.assert(rb !== undefined);

            this.rigidWorld.removeRigidBody(rb);
            this.cellToIndex.delete(cell);
            this.indexToCell.delete(index);
            this.indexToRigidBody.delete(index);
            Ammo.destroy(rb);
        }

        removeConstraint(cellIndex) {
            const constraint = this.indexToConstraint.get(cellIndex);
            this.indexToConstraint.delete(cellIndex);
            this.rigidWorld.removeConstraint(constraint);
            Ammo.destroy(constraint);
        }


        /** Syncs transform of rigid bodies back to cells, without touching creating / destroying objects. */
        _syncRigidToCells() {
            for (let [cell, index] of this.cellToIndex) {
                const rb = this.indexToRigidBody.get(index);
                cell.setBtTransform(rb.getCenterOfMassTransform());
            }
        }

        serialize() {
            let ser = {};
            ser['plants'] = this.plants.map(plant => {
                return {
                    'id': plant.id,
                    'cells': plant.serializeCells(),
                };
            });
            ser['soil'] = this.soil.serialize();

            return ser;
        }

        // Kill plant with specified id.
        kill(id) {
            this.plants = this.plants.filter(plant => {
                return (plant.id !== id);
            });
        }
    }

    // xs :: [num]
    // return :: num
    function sum(xs) {
        let r = 0;
        for (const x of xs) {
            r += x;
        }
        return r;
    }

    // xs :: [num]
    // return :: num
    function product(xs) {
        let r = 1;
        for (const x of xs) {
            r *= x;
        }
        return r;
    }

    this.setChunkAmmo = (ammo) => Ammo = ammo;
    this.Chunk = Chunk;

})(this);
