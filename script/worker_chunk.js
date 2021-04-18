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

            // common physics
            this.rooted = false;

            // physics
            const seedInnodeToWorld = new THREE.Matrix4().compose(
                position,
                new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.random() * 2 * Math.PI),
                new THREE.Vector3(1, 1, 1));

            // biophysics
            this.energy = energy;
            const seed = new Cell(this, Signal.SHOOT_END, null, seedInnodeToWorld);
            this.cells = [seed];  // flat cells in world coords

            // genetics
            this.genome = genome;
        }

        step() {
            if (!this.rooted) {
                return;
            }

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
            stat['genome'] = this.genome.encode();
            return stat;
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
            function genes_calc_prob_term(signal) {
                if (signal === Signal.HALF) {
                    return 0.5;
                } else if (signal === Signal.GROWTH) {
                    return _this.plant.growthFactor();
                } else if (signal.length >= 2 && signal[0] === Signal.INVERT) {
                    return 1 - genes_calc_prob_term(signal.substr(1));
                } else if (_this.signals.includes(signal)) {
                    return 1;
                } else {
                    return 0.001;
                }
            }

            function genes_calc_prob(when) {
                return product(when.map(genes_calc_prob_term));
            }

            // Gene expression and transcription.
            this.plant.genome.genes.forEach(gene => {
                if (genes_calc_prob(gene['when']) > Math.random()) {
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
            const removers = {};
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

            const newSignals = [];
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
                    newSignals.push(signal);
                }
            });
            this.signals = newSignals;

            // Physics
            if (this.signals.includes(Signal.FLOWER)) {
                // Disperse seed once in a while.
                // Maybe dead cells with stored energy survives when fallen off.
                if (Math.random() < 0.01) {
                    const seedEnergy = _this._withdrawVariableEnergy(Math.pow(20e-3, 3) * 10);
                    const seedPosWorld = new THREE.Vector3().applyMatrix4(this.cellToWorld);
                    this.plant.unsafeChunk.addPlant(seedPosWorld, seedEnergy, this.plant.genome.naturalClone());
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

        computeBtTransform(tf) {
            const trans = new THREE.Vector3();
            const quat = new THREE.Quaternion();
            const unusedScale = new THREE.Vector3();
            this.cellToWorld.decompose(trans, quat, unusedScale);

            tf.setIdentity();
            tf.setOrigin(new Ammo.btVector3(trans.x, trans.y, trans.z));
            tf.setRotation(new Ammo.btQuaternion(quat.x, quat.y, quat.z, quat.w));
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

    // Downward directional light.
    class Light {
        constructor(chunk, size) {
            this.chunk = chunk;

            this.n = 64;
            this.size = size;
        }

        step() {
            this._castRays(this.chunk.rigidWorld, this.chunk.indexToCell);
        }

        _castRays(rigidWorld, indexToCell) {
            const posFrom = new Ammo.btVector3();
            const posTo = new Ammo.btVector3();
            for (let i = 0; i < this.n; i++) {
                for (let j = 0; j < this.n; j++) {
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
                            // hit soil
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
     * 
     * @param {number} horizontalSize
     * @returns {Array<{t:THREE.Vector3, r:THREE.Quaternion, s:THREE.Vector3}>} (s is full size (not half size))
     */
    function generateSoil(horizontalSize) {
        const thickness = 5;
        const res = [
            {
                t: new THREE.Vector3(0, 0, -thickness/2),
                r: new THREE.Quaternion(),
                s: new THREE.Vector3(horizontalSize, horizontalSize, thickness),
            }
        ];

        // "rocks"
        let pos = new THREE.Vector3();
        let scaleFactor = 1;
        for (let i = 0; i < 10; i++) {
            if (i === 0 || Math.random() < 0.5) {
                pos = new THREE.Vector3((Math.random() - 0.5) * horizontalSize * 0.7, (Math.random() - 0.5) * horizontalSize * 0.7, 0);
                scaleFactor = 1;
            }
            
            res.push({
                t: pos.clone(),
                r: new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random() * Math.PI, Math.random() * Math.PI, 0)),
                s: new THREE.Vector3(Math.random() * 60 * scaleFactor + 5, Math.random() * 40 * scaleFactor + 5, Math.random() * 20 * scaleFactor + 5),
            });

            pos.add(new THREE.Vector3((Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, Math.random() * 15));
            scaleFactor *= 0.8;
        }

        // "pillar"
        for (let i = 0; i < 1; i++) {
            const h = Math.random() * 60 + 40;
            pos = new THREE.Vector3((Math.random() - 0.5) * horizontalSize * 0.3, (Math.random() - 0.5) * horizontalSize * 0.3, h * 0.4);
            
            res.push({
                t: pos.clone(),
                r: new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random() * Math.PI * 0.1, Math.random() * Math.PI * 0.1, Math.random() * Math.PI * 0.1)),
                s: new THREE.Vector3(Math.random() * 20 + 5, Math.random() * 20 + 5, h),
            });
        }

        // "ceilings"
        for (let i = 0; i < 2; i++) {
            pos = new THREE.Vector3((Math.random() - 0.5) * horizontalSize * 0.7, (Math.random() - 0.5) * horizontalSize * 0.7, 20 + Math.random() * 60);
            
            res.push({
                t: pos.clone(),
                r: new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random() * Math.PI * 0.1, Math.random() * Math.PI * 0.1, Math.random() * Math.PI)),
                s: new THREE.Vector3(Math.random() * 100, Math.random() * 50, Math.random() * 5 + 5),
            });
        }

        return res.map(d => {
            return {
                t: {x:d.t.x, y:d.t.y, z:d.t.z},
                r: {x:d.r.x, y:d.r.y, z:d.r.z, w:d.r.w},
                s: {x:d.s.x, y:d.s.y, z:d.s.z},
            };
        });
    }

    /**
     * A chunk is non-singleton, finite patch of space containing bunch of plants, soil,
     * and light field.
     * Chunk have no coupling with DOM or external state. Main methods are
     * step & serialize. Other methods are mostly for statistics.
     */  
    class Chunk {
        static COLLISION_MASK_SOIL = 0b01
        static COLLISION_MASK_CELL = 0b10

        constructor() {
            const approxChunkSize = 100;

            // tracer
            this.age = 0;
            this.newPlantId = 0;

            // Entities.
            this.plants = [];  // w/ internal "bio" aspect

            // chunk <-> ammo object mappings
            this.userIndex = 1;
            this.soilIndices = new Set();
            this.cellToIndex = new Map(); // Cell -> btRigidBody userindex
            this.indexToCell = new Map(); // btRigidBody userindex -> Cell
            this.indexToRigidBody = new Map(); // btRigidBody userindex -> btRigidBody
            
            this.cellIndexToSoilIndex = new Map(); // Cell ix-> soil ix
            this.indexToConstraint = new Map(); // btRigidBody userindex (child) -> btConstraint

            // Physical aspects.
            this.light = new Light(this, approxChunkSize);
            this.rigidWorld = this._createRigidWorld();

            this.soilData = generateSoil(approxChunkSize);
            this._addSoil(this.soilData);
        }

        _createRigidWorld() {
            const collisionConfig = new Ammo.btDefaultCollisionConfiguration();
            const dispatcher = new Ammo.btCollisionDispatcher(collisionConfig);
            const overlappingPairCache = new Ammo.btDbvtBroadphase();
            const solver = new Ammo.btSequentialImpulseConstraintSolver();
            const rigidWorld = new Ammo.btDiscreteDynamicsWorld(dispatcher, overlappingPairCache, solver, collisionConfig);
            const gravity = new Ammo.btVector3(0, 0, -100);
            rigidWorld.setGravity(gravity);
            Ammo.destroy(gravity);
            return rigidWorld;
        }

        _addSoil(soil) {
            soil.forEach(block => {
                const shape = new Ammo.btBoxShape(new Ammo.btVector3(block.s.x / 2, block.s.y / 2, block.s.z / 2));
                const trans = new Ammo.btTransform();
                trans.setIdentity();
                trans.getOrigin().setValue(block.t.x, block.t.y, block.t.z);
                trans.setRotation(new Ammo.btQuaternion(block.r.x, block.r.y, block.r.z, block.r.w));
    
                const motion = new Ammo.btDefaultMotionState(trans);
                const rbInfo = new Ammo.btRigidBodyConstructionInfo(0, motion, shape, new Ammo.btVector3(0, 0, 0)); // static (mass,intertia=0)
                const rb = new Ammo.btRigidBody(rbInfo);
    
                this.addSoilRigidBody(rb);
            });
        }

        // Add standard plant seed.
        addDefaultPlant(pos) {
            return this.addPlant(
                pos,
                Math.pow(20e-3, 3) * 100, // allow 2cm cube for 100T
                new Genome());
        }

        // pos :: THREE.Vector3 (z must be 0)
        // energy :: Total starting energy for the new plant.
        // genome :: genome for new plant
        // return :: Plant
        addPlant(pos, energy, genome) {
            const seed = new Plant(pos, this, energy, genome, this.newPlantId);
            this.newPlantId += 1;
            this.plants.push(seed);
            return seed;
        }

        // Plant :: must be returned by add_plant
        // return :: ()
        removePlant(plant) {
            this.plants = this.plants.filter(p => p !== plant);
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
         * @returns {Object} stats
         */
        step() {
            this.age += 1;

            let t0 = 0;
            const simStats = {};

            t0 = performance.now();
            this.plants.forEach(plant => plant.step());
            simStats['bio/ms'] = performance.now() - t0;

            t0 = performance.now();
            this._syncCellsToRigid();
            simStats['cell->rigid/ms'] = performance.now() - t0;

            t0 = performance.now();
            this.light.step(this.rigidWorld, this.indexToCell);
            simStats['light/ms'] = performance.now() - t0;

            t0 = performance.now();
            this.rigidWorld.stepSimulation(0.04, 2);
            this._syncRigidToCells();
            simStats['rigid/ms'] = performance.now() - t0;

            this._despawnPlants();

            return simStats;
        }

        /**
         * Sync cell creation, growth, removal.
         * - creation: sets initial transform & constraint
         * - growth: sets size
         * - removal: removes dead cells.
         * Other cells remain untouched.
         */
        _syncCellsToRigid() {
            // NOTE: all new Ammo.XXXX() calls must be acoompanied by Ammo.destroy(), otherwise memory will leak.

            // Add/Update cells.
            const cellBoxSize = new Ammo.btVector3(0.5, 0.5, 0.5);
            const liveCells = new Set();
            for (const plant of this.plants) {
                for (const cell of plant.cells) {
                    const cellIndex = this.cellToIndex.get(cell);
                    const rb = cellIndex !== undefined ? this.indexToRigidBody.get(cellIndex) : undefined;

                    const localScaling = new Ammo.btVector3(cell.sx, cell.sy, cell.sz);
                    const localInertia = new Ammo.btVector3(0, 0, 0);
                    if (rb === undefined) {
                        // Add cell.
                        const cellShape = new Ammo.btBoxShape(cellBoxSize); // (1cm)^3 cube
                        cellShape.setLocalScaling(localScaling);
                        cellShape.calculateLocalInertia(cell.getMass(), localInertia);

                        const tf = new Ammo.btTransform();
                        cell.computeBtTransform(tf);
                        const motionState = new Ammo.btDefaultMotionState(tf);
                        Ammo.destroy(tf);
                        const rbInfo = new Ammo.btRigidBodyConstructionInfo(cell.getMass(), motionState, cellShape, localInertia);
                        const rb = new Ammo.btRigidBody(rbInfo);
                        rb.setFriction(0.8);
                        this.addCellRigidBody(rb, cell);

                        //Ammo.destroy(motionState); // this will lead to a crash
                        Ammo.destroy(rbInfo);
                    } else {
                        // Update cell size.
                        rb.getCollisionShape().setLocalScaling(localScaling);
                        rb.getCollisionShape().calculateLocalInertia(cell.getMass(), localInertia);
                        rb.setMassProps(cell.getMass(), localInertia);
                        rb.updateInertiaTensor();    
                    }
                    Ammo.destroy(localScaling);
                    Ammo.destroy(localInertia);

                    liveCells.add(cell);
                }
            }
            Ammo.destroy(cellBoxSize);

            // Add/Update constraints. (assumes each cell has exactly 1 constraint)
            const tfCell = new Ammo.btTransform();
            const tfParent = new Ammo.btTransform();
            for (const cell of liveCells) {
                const cellIndex = this.cellToIndex.get(cell);
                const constraint = this.indexToConstraint.get(cellIndex);

                tfCell.setIdentity();
                tfCell.getOrigin().setValue(0, 0, -cell.sz / 2); // innode

                if (constraint === undefined) {
                    if (cell.plant.rooted) {
                        const rb = this.indexToRigidBody.get(cellIndex);

                        let parentRb = null;
                        if (cell.parentCell === null) {
                            // soil
                            parentRb = this.indexToRigidBody.get(this.cellIndexToSoilIndex.get(cellIndex));
                            
                            const cellPos = new THREE.Vector3().applyMatrix4(cell.cellToWorld);
                            const cellPosWorld = new Ammo.btVector3(cellPos.x, cellPos.y, cellPos.z);
                            const cellPosLoc = parentRb.getCenterOfMassTransform().invXform(cellPosWorld);
                            tfParent.setIdentity();
                            tfParent.setOrigin(cellPosLoc);
                            Ammo.destroy(cellPosWorld);
                            Ammo.destroy(cellPosLoc);
                        } else {
                            // outnode of parent
                            parentRb = this.indexToRigidBody.get(this.cellToIndex.get(cell.parentCell));
                            tfParent.setIdentity();
                            tfParent.getOrigin().setValue(0, 0, cell.parentCell.sz / 2);
                        }

                        // Add constraint.
                        const constraint = new Ammo.btGeneric6DofSpringConstraint(rb, parentRb, tfCell, tfParent, true);
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
    
                        this.rigidWorld.addConstraint(constraint, true); // true: disable collision between neighbors
                        this.indexToConstraint.set(cellIndex, constraint);
                    }
                } else {
                    // Update constraint.
                    const constraint = this.indexToConstraint.get(cellIndex);

                    if (cell.parentCell === null) {
                        // cell-soil link
                        constraint.setFrames(tfCell, constraint.getFrameOffsetB());
                    } else {
                        // cell-parent cell link
                        tfParent.setIdentity();
                        tfParent.getOrigin().setValue(0, 0, cell.parentCell.sz / 2);
                        constraint.setFrames(tfCell, tfParent);
                    }
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
        }

        addSoilRigidBody(rb) {
            const index = this.issueNewUserIndex();
            rb.setUserIndex(index);

            this.rigidWorld.addRigidBody(rb, Chunk.COLLISION_MASK_SOIL, Chunk.COLLISION_MASK_CELL | Chunk.COLLISION_MASK_SOIL);
            this.soilIndices.add(index);
            this.indexToRigidBody.set(index, rb);

            return index;
        }
        
        addCellRigidBody(rb, cell) {
            const index = this.issueNewUserIndex();
            rb.setUserIndex(index);

            this.rigidWorld.addRigidBody(rb, Chunk.COLLISION_MASK_CELL, Chunk.COLLISION_MASK_CELL | Chunk.COLLISION_MASK_SOIL);
            this.cellToIndex.set(cell, index);
            this.indexToCell.set(index, cell);
            this.indexToRigidBody.set(index, rb);

            return index;
        }

        issueNewUserIndex() {
            const index = this.userIndex;

            this.userIndex++;
            if (this.userIndex >= 2**31) {
                this.userIndex = 1; // restart from 1 (this will break if cell id 1 still retamins in the scene)
            }

            return this.indexToRigidBody.has(index) ? this.issueNewUserIndex() : index;
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
            this.cellIndexToSoilIndex.delete(index);
            Ammo.destroy(rb);
        }

        removeConstraint(cellIndex) {
            const constraint = this.indexToConstraint.get(cellIndex);
            if (constraint !== undefined) {
                this.indexToConstraint.delete(cellIndex);
                this.rigidWorld.removeConstraint(constraint);
                Ammo.destroy(constraint);
            }
        }

        /** Syncs transform of rigid bodies back to cells, without touching creating / destroying objects. */
        _syncRigidToCells() {
            for (const [cell, index] of this.cellToIndex) {
                const rb = this.indexToRigidBody.get(index);
                cell.setBtTransform(rb.getCenterOfMassTransform());
            }

            const dispatcher = this.rigidWorld.getDispatcher();
            for (let i = 0; i < dispatcher.getNumManifolds(); i++) {
                const collision = dispatcher.getManifoldByIndexInternal(i);
                if (collision.getNumContacts() === 0) {
                    // contact may be 0 (i.e. colliding in broadphase, but not in narrowphase)
                    continue;
                }

                const i0 = collision.getBody0().getUserIndex();
                const i1 = collision.getBody1().getUserIndex();
                if (this.soilIndices.has(i0)) {
                    this.indexToCell.get(i1).plant.rooted = true;
                    this.cellIndexToSoilIndex.set(i1, i0);
                } else if (this.soilIndices.has(i1)) {
                    this.indexToCell.get(i0).plant.rooted = true;
                    this.cellIndexToSoilIndex.set(i0, i1);
                }
            }
        }

        _despawnPlants() {
            const despawnHeight = -50;
            const p = new THREE.Vector3();

            const plantToDestroy = new Set();
            for (const cell of this.cellToIndex.keys()) {
                p.set(0, 0, 0);
                p.applyMatrix4(cell.cellToWorld);
                if (p.z < despawnHeight) {
                    plantToDestroy.add(cell.plant);
                }               
            }
            this.plants = this.plants.filter(plant => !plantToDestroy.has(plant));
        }

        serialize() {
            const ser = {};
            ser['plants'] = this.plants.map(plant => {
                return {
                    'id': plant.id,
                    'cells': plant.serializeCells(),
                };
            });
            ser['soil'] = {
                'blocks': this.soilData,
            };
            ser['stats'] = this._getStat();

            return ser;
        }

        _getStat() {
            const storedEnergy = sum(this.plants.map(plant => {
                return plant.energy;
            }));
            const numCells = sum(this.plants.map(plant => plant.cells.length));

            return {
                'age': this.age,
                '#plant': this.plants.length,
                '#cell': numCells,
                'energy:stored': storedEnergy
            };
        }

        // Kill plant with specified id.
        killPlant(plantId) {
            this.plants = this.plants.filter(plant => {
                return (plant.id !== plantId);
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
