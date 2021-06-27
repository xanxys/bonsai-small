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
            const seed = new Cell(this, new Map(), seedInnodeToWorld, new THREE.Quaternion(), null);
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
            this.energy += this._powerForPlant();

            const maxEnergy = this.cells.length * 100;
            this.energy = Math.min(this.energy, maxEnergy);

            if (this.energy <= 0) {
                // die
                this.unsafeChunk.removePlantById(this.id);
            }
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
            stat["#cell"] = statCells.length;
            stat['cells'] = statCells;
            stat['age'] = this.age;
            stat['energy:stored'] = this.energy;
            stat['energy:delta'] = this._powerForPlant();
            stat['genome'] = this.genome.encode();
            return stat;
        }

        _powerForPlant() {
            return sum(this.cells.map(cell => cell.powerForPlant()));
        }
    }

    function removeRandom(signals) {
        let ixToRemove = Math.floor(Math.random() * sum(signals.values()));
        let sigToRemove = null;
        for (const [sig, num] of signals.entries()) {
            if (ixToRemove < num) {
                sigToRemove = sig;
                break;
            }
            ixToRemove -= num;
        }
        signals.delete(sigToRemove);
    }

    function applyDelta(signals, k, n) {
        const newN = (signals.get(k) ?? 0) + n;
        if (newN <= 0) {
            signals.delete(k);
        } else {
            signals.set(k, newN);
        }
    }

    const INITIAL_CELL_SIZE = 0.5;
    //  Power Generation (<- Light):
    //    sum of photosynthesis (LEAF)
    //  Power Consumption:
    //    basic (minimum cell volume equivalent)
    //    linear-volume
    //
    // I-node (in-node): where this cell connects with the parent cell or soil. (0, 0, -sz/2)
    // O-node (out-node): where this cell connects with a children. (0, 0, sz/2)
    class Cell {
        /**
         * @param {Plant} plant 
         * @param {Map<string, number>} initialSignals
         * @param {THREE.Matrix4} cellToWorld 
         * @param {THREE.Quaternion | null} parentRot (this i-node -> (parent o-node | soil) transform)
         * @param {Cell | null} parentCell 
         */
        constructor(plant, initialSignals, cellToWorld, parentRot, parentCell) {
            // tracer
            this.age = 0;

            // in-sim (light)
            this.photons = 0;

            // in-sim (phys + bio)
            this.sx = INITIAL_CELL_SIZE;
            this.sy = INITIAL_CELL_SIZE;
            this.sz = INITIAL_CELL_SIZE;
            this.cellToWorld = cellToWorld;

            // in-sim (fixed phys)
            this.parentCell = parentCell;
            this.parentRot = parentRot;

            // in-sim (bio)
            this.plant = plant;
            this.power = 0;

            // in-sim (genetics)
            this.signals = initialSignals;
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
            let deltaStatic = 0;

            // +: photo synthesis
            const efficiency = this._getPhotoSynthesisEfficiency();
            deltaStatic += this.photons * efficiency;
            this.photons = 0;

            // -: cell primitive cost (penalize number of cells (mainly for stabilizing physics))
            deltaStatic -= 1;

            // -: linear-volume consumption (stands for cell substrate maintainance)
            const volumeConsumption = 1.0;
            deltaStatic -= this.sx * this.sy * this.sz * volumeConsumption;

            if (this.plant.energy < deltaStatic) {
                this.plant.energy = -1000;  // set death flag (TODO: implicit value encoding is bad idea)
            } else {
                this.power += deltaStatic;
                this.plant.energy += deltaStatic;
            }
        };

        _getPhotoSynthesisEfficiency() {
            // 0:0, 1:0.2, 2:0.36, 3:0.49, ...
            const numChlr = this.signals.get(Signal.CHLOROPLAST) ?? 0;
            return 1 - Math.pow(0.8, numChlr);
        }

        // return :: ()
        step() {
            this.age += 1;
            this._beginUsePower();
            this._withdrawStaticEnergy();

            // Gene expression and transcription.
            this.plant.genome.genes.forEach(gene => {
                if (this._geneExpressionProbability(gene['when']) > Math.random()) {
                    const numCodon = sum(gene['emit'].map(sig => sig.length));
                    if (this._withdrawEnergy(numCodon * 1e-2)) {
                        gene['emit'].forEach(sig => applyDelta(this.signals, sig, 1));
                    }
                }
            });

            // Bio-physics.
            while (this.signals.get(Signal.REMOVER) ?? 0 > 0) {
                applyDelta(this.signals, Signal.REMOVER, -1);
                removeRandom(this.signals);
            }

            const numRotZ = this.signals.get(Signal.CR_Z) ?? 0;
            const numRotX = this.signals.get(Signal.CR_X) ?? 0;

            if ((this.signals.get(Signal.DIFF) ?? 0) >= 10) {
                applyDelta(this.signals, Signal.DIFF, -10);
                this.addCont(numRotZ, numRotX);
            }
            this.sx = Math.min(5, this.sx + 0.1 * (this.signals.get(Signal.G_DX) ?? 0));
            this.signals.delete(Signal.G_DX);

            this.sy = Math.min(5, this.sy + 0.1 * (this.signals.get(Signal.G_DY) ?? 0));
            this.signals.delete(Signal.G_DY);

            this.sz = Math.min(5, this.sz + 0.1 * (this.signals.get(Signal.G_DZ) ?? 0));
            this.signals.delete(Signal.G_DZ);

            if ((this.signals.get(Signal.FLOWER) ?? 0) > 0) {
                // Disperse seed once in a while.
                // Maybe dead cells with stored energy survives when fallen off.
                if (Math.random() < 0.01) {
                    const seedEnergy = this._withdrawVariableEnergy(80);
                    const seedPosWorld = new THREE.Vector3().applyMatrix4(this.cellToWorld);
                    this.plant.unsafeChunk.addPlant(seedPosWorld, this.plant.genome.naturalClone(), seedEnergy);
                }
            }
        }

        _geneExpressionProbability(when) {
            let prob = 1;
            when.forEach(signal => {
                if (signal === Signal.INVERT) {
                    prob = 1 - prob;
                } else {
                    const numMatches = this.signals.get(signal) ?? 0;
                    prob *= 0.5 + 0.5 * (1 - Math.pow(0.8, numMatches)); // 0.5, 0.6, 0.7, ...
                }
            });
            return prob;
        }

        computeBtTransform(tf) {
            const trans = new THREE.Vector3();
            const quat = new THREE.Quaternion();
            const unusedScale = new THREE.Vector3();
            this.cellToWorld.decompose(trans, quat, unusedScale);

            const t = new Ammo.btVector3(trans.x, trans.y, trans.z);
            const q = new Ammo.btQuaternion(quat.x, quat.y, quat.z, quat.w);
            tf.setIdentity();
            tf.setOrigin(t);
            tf.setRotation(q);
            Ammo.destroy(t);
            Ammo.destroy(q);
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
            let flrRatio = (this.signals.has(Signal.FLOWER)) ? 0.5 : 1;
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

        giveLight(n) {
            this.photons += n;
        }

        /**
         * @param {string} initial: initial signal
         */
        addCont(numRotZ, numRotX) {
            const childSigs = new Map();
            for (const [sig, n] of this.signals) {
                childSigs.set(sig, 1);
                if (n > 2) {
                    this.signals.set(sig, n - 1);
                } else {
                    this.signals.delete(sig);
                }
            }

            // child-i -> self-o
            const rotQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(
                Math.min(numRotZ / 16, 1) * Math.PI,
                0,
                Math.min(numRotX / 16, 1) * Math.PI,
                'ZYX'));

            const c2ci = new THREE.Matrix4().makeTranslation(0, 0, -INITIAL_CELL_SIZE / 2);
            const ci2so = new THREE.Matrix4().makeRotationFromQuaternion(rotQ);
            const so2s = new THREE.Matrix4().makeTranslation(0, 0, this.sz / 2);
            const s2w = this.cellToWorld;

            const c2w = new THREE.Matrix4();
            c2w.premultiply(c2ci);
            c2w.premultiply(ci2so);
            c2w.premultiply(so2s);
            c2w.premultiply(s2w);

            const newCell = new Cell(this.plant, childSigs, c2w, rotQ, this);
            this.plant.cells.push(newCell);            
        }
    }

    // Downward directional light.
    class Light {
        /**
         * @param {Chunk} chunk 
         * @param {number} size: full extend of the light
         * @param {*} intensity: photon count / (cm^2 * step)
         */
        constructor(chunk, size, intensity) {
            this.chunk = chunk;
            this.halfSize = Math.ceil(size / 2);
            this.intensity = intensity;
        }

        step() {
            this._castRays(this.chunk.rigidWorld, this.chunk.indexToCell);
        }

        _castRays(rigidWorld, indexToCell) {
            const posFrom = new Ammo.btVector3();
            const posTo = new Ammo.btVector3();
            for (let iy = -this.halfSize; iy < this.halfSize; iy++) {
                for (let ix = -this.halfSize; ix < this.halfSize; ix++) {

                    const cb = new Ammo.ClosestRayResultCallback();
                    const x = ix + Math.random();
                    const y = iy + Math.random();
                    posFrom.setValue(x, y, 100);
                    posTo.setValue(x, y, -1);
                    rigidWorld.rayTest(posFrom, posTo, cb);

                    if (cb.hasHit()) {
                        const uIndex = cb.m_collisionObject.getUserIndex();
                        const cell = indexToCell.get(uIndex);
                        if (cell !== undefined) {
                            cell.giveLight(this.intensity);
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
            const approxChunkSize = 100; // end-to-end size of the chunk (soil) in cm

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
            this.light = new Light(this, approxChunkSize, 6);
            this.rigidWorld = this._createRigidWorld();

            this.lightMultipler = 5;

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
            const inertia = new Ammo.btVector3(0, 0, 0);
            soil.forEach(block => {
                const size = new Ammo.btVector3(block.s.x / 2, block.s.y / 2, block.s.z / 2);
                const shape = new Ammo.btBoxShape(size);
                Ammo.destroy(size);

                const trans = new Ammo.btTransform();
                trans.setIdentity();
                trans.getOrigin().setValue(block.t.x, block.t.y, block.t.z);
                const q = new Ammo.btQuaternion(block.r.x, block.r.y, block.r.z, block.r.w);
                trans.setRotation(q);
                Ammo.destroy(q);
    
                const motion = new Ammo.btDefaultMotionState(trans);
                const rbInfo = new Ammo.btRigidBodyConstructionInfo(0, motion, shape, inertia); // static (mass,intertia=0)
                const rb = new Ammo.btRigidBody(rbInfo);

                Ammo.destroy(trans);
                Ammo.destroy(rbInfo);
    
                this.addSoilRigidBody(rb);
            });
            Ammo.destroy(inertia);
        }

        /**
         * @param {THREE.Vector3} pos 
         * @param {Genome} genome 
         * @param {number} energy 
         * @returns {Plant} added plant
         */
        addPlant(pos, genome, energy) {
            const DEFAULT_SEED_ENERGY = 100;

            const seedPlant = new Plant(pos, this, energy ?? DEFAULT_SEED_ENERGY, genome, this.newPlantId);
            this.newPlantId += 1;
            this.plants.push(seedPlant);
            return seedPlant;
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
            this.light.intensity = (Math.sin(this.age / 1000 * (2 * Math.PI)) * 0.5 + 1) * this.lightMultipler;
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
                            
                            const cellPos = new THREE.Vector3(0, 0, -cell.sz / 2).applyMatrix4(cell.cellToWorld);
                            const cellPosWorld = new Ammo.btVector3(cellPos.x, cellPos.y, cellPos.z);
                            const centerOfMassTf = parentRb.getCenterOfMassTransform();
                            const cellPosLoc = centerOfMassTf.invXform(cellPosWorld);
                            Ammo.destroy(centerOfMassTf);

                            tfParent.setIdentity();
                            tfParent.setOrigin(cellPosLoc);
                            const q = new Ammo.btQuaternion(cell.parentRot.x, cell.parentRot.y, cell.parentRot.z, cell.parentRot.w);
                            tfParent.setRotation(q);
                            Ammo.destroy(q);
                            Ammo.destroy(cellPosWorld);
                            Ammo.destroy(cellPosLoc);
                        } else {
                            // outnode of parent
                            parentRb = this.indexToRigidBody.get(this.cellToIndex.get(cell.parentCell));
                            tfParent.setIdentity();
                            tfParent.getOrigin().setValue(0, 0, cell.parentCell.sz / 2);
                            const q = new Ammo.btQuaternion(cell.parentRot.x, cell.parentRot.y, cell.parentRot.z, cell.parentRot.w);
                            tfParent.setRotation(q);
                            Ammo.destroy(q);
                        }

                        // Add constraint.
                        const constraint = new Ammo.btGeneric6DofSpringConstraint(rb, parentRb, tfCell, tfParent, true);
                        const ctLower = new Ammo.btVector3(0.01, 0.01, 0.01);
                        const ctUpper = new Ammo.btVector3(-0.01, -0.01, -0.01);
                        constraint.setAngularLowerLimit(ctLower);
                        constraint.setAngularUpperLimit(ctUpper);
                        constraint.setLinearLowerLimit(ctLower);
                        constraint.setLinearUpperLimit(ctUpper);
                        Ammo.destroy(ctLower);
                        Ammo.destroy(ctUpper);
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
                        const fb = constraint.getFrameOffsetB();
                        constraint.setFrames(tfCell, fb);
                        Ammo.destroy(fb);
                    } else {
                        // cell-parent cell link
                        tfParent.setIdentity();
                        tfParent.getOrigin().setValue(0, 0, cell.parentCell.sz / 2);
                        const q = new Ammo.btQuaternion(cell.parentRot.x, cell.parentRot.y, cell.parentRot.z, cell.parentRot.w);
                        tfParent.setRotation(q);
                        Ammo.destroy(q);
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

            // HACK: with current ammo.js, superclasses can't be removed from internal cache
            // https://github.com/kripken/ammo.js/issues/284
            // (sy == __cache__, qy = ptr)
            const ms = rb.getMotionState();
            Ammo.destroy(ms);
            delete Ammo.btDefaultMotionState.sy[ms.qy];

            const cs = rb.getCollisionShape();
            Ammo.destroy(cs);
            delete Ammo.btBoxShape.sy[cs.qy];

            this.rigidWorld.removeRigidBody(rb);
            this.cellToIndex.delete(cell);
            this.indexToCell.delete(index);
            this.indexToRigidBody.delete(index);
            this.cellIndexToSoilIndex.delete(index);
            Ammo.destroy(rb);
            delete Ammo.btCollisionObject.sy[rb.qy];
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
                const tf = rb.getCenterOfMassTransform();
                cell.setBtTransform(tf);
                Ammo.destroy(tf);
            }

            const dispatcher = this.rigidWorld.getDispatcher();
            for (let i = 0; i < dispatcher.getNumManifolds(); i++) {
                const collision = dispatcher.getManifoldByIndexInternal(i);
                if (collision.getNumContacts() === 0) {
                    // contact may be 0 (i.e. colliding in broadphase, but not in narrowphase)
                    delete Ammo.btPersistentManifold.sy[collision.qy]; // HACK: https://github.com/kripken/ammo.js/issues/284
                    continue;
                }

                const i0 = collision.getBody0().getUserIndex();
                const i1 = collision.getBody1().getUserIndex();
                delete Ammo.btPersistentManifold.sy[collision.qy]; // HACK: https://github.com/kripken/ammo.js/issues/284

                let [soilIx, cellIx] = [null, null];
                if (this.soilIndices.has(i0)) {
                    [soilIx, cellIx] = [i0, i1];
                } else if (this.soilIndices.has(i1)) {
                    [soilIx, cellIx] = [i1, i0];
                }

                if (soilIx !== null) {
                    this.indexToCell.get(cellIx).plant.rooted = true;
                    const seedCell = this.indexToCell.get(cellIx).plant.cells[0];

                    const q = new THREE.Quaternion();
                    seedCell.cellToWorld.decompose(new THREE.Vector3(), q, new THREE.Vector3());
                    seedCell.parentRot = q;

                    this.cellIndexToSoilIndex.set(cellIx, soilIx);
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
                    'genome': plant.genome.encode(),
                    'cells': plant.serializeCells(),
                };
            });
            ser['soil'] = {
                'blocks': this.soilData,
            };
            ser['light'] = this.light.intensity;
            ser['stats'] = this._getStat();

            return ser;
        }

        setEnvironment(lightMultipler) {
            this.lightMultipler = lightMultipler;
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

        /**
         * @param {number} plantId 
         */
        removePlantById(plantId) {
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
