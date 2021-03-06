(function() {
    let Ammo = null;

    function serializeCells(cells) {
        return cells.map(cell => {
            return {
                'mat': Array.from(cell.cellToWorld.elements),
                'size': [cell.sx, cell.sy, cell.sz],
                'col': cell.getCellColor(),
            };
        });
    }

    function getPlantStatFromCells(cells) {
        const root = cells[0].getRootCell();

        const stat = {};
        stat["#cell"] = cells.length;
        stat['cells'] = cells.map(cell => cell.signals);
        stat['age'] = root.age;
        stat['energy:stored'] = sum(cells.map(cell => cell.getNumAct()));
        stat['energy:delta'] = sum(cells.map(cell => cell.getNumAct() - cell.prevNumAct));
        stat['genome'] = root.genome.encode();
        return stat; 
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
    const MAX_CONC = 255;
    //  Power Generation (<- Light):
    //    sum of photosynthesis (LEAF)
    //  Power Consumption:
    //    basic (minimum cell volume equivalent)
    //    linear-volume
    //
    // I-node (in-node): where this cell connects with the parent cell or soil. (0, 0, -sz/2)
    // O-node (out-node): where this cell connects with a children. (0, 0, sz/2)
    class Cell {
        static newId = 1;

        /**
         * @param {Chunk} unsafeChunk
         * @param {Genome} genome
         * @param {Map<string, number>} initialSignals
         * @param {THREE.Matrix4} cellToWorld 
         * @param {THREE.Quaternion | null} parentRot (this i-node -> (parent o-node | soil) transform)
         * @param {Cell | null} parentCell 
         */
        constructor(unsafeChunk, genome, initialSignals, cellToWorld, parentRot, parentCell) {
            this.unsafeChunk = unsafeChunk;

            // tracer
            this.age = 0;
            this.id = Cell.newId;
            Cell.newId++;

            // in-sim (light)
            this.photons = 0;

            // in-sim (phys + bio)
            this.sx = INITIAL_CELL_SIZE;
            this.sy = INITIAL_CELL_SIZE;
            this.sz = INITIAL_CELL_SIZE;
            this.cellToWorld = cellToWorld;

            // in-sim (fixed phys)
            // cell state is one of:
            // 1. free (!rooted && parentCell === null)
            // 2. rooted (rooted && parentCell === null)
            // 3. connected (!rooted && parentCell !== null)
            this.rooted = false;
            this.parentCell = parentCell;
            this.parentRot = parentRot;

            // in-sim (bio)
            this.genome = genome;

            // in-sim (genetics)
            this.signals = initialSignals;
        }

        getRootCell() {
            if (this.parentCell === null) {
                return this;
            } else {
                return this.parentCell.getRootCell();
            }
        }

        getMass() {
            return 1e-2 * this.sx * this.sy * this.sz;
        }

        getNumAct() {
            return this.signals.get(Signal.M_ACTIVE) ?? 0;
        }

        getNumBase() {
            return this.signals.get(Signal.M_BASE) ?? 0;
        }

        // return :: bool
        _withdrawEnergy(amount) {
            if (this.getNumAct() >= amount) {
                applyDelta(this.signals, Signal.M_ACTIVE, -amount);
                return true;
            } else {
                return false;
            }
        }

        _withdrawVariableEnergy(maxAmount) {
            let amount = Math.min(Math.max(0, this.getNumAct()), maxAmount);
            applyDelta(this.signals, Signal.M_ACTIVE, -amount);
            return amount;
        }

        _withdrawStaticEnergy() {
            let deltaStatic = 0;

            // -: cell primitive cost (penalize number of cells (mainly for stabilizing physics))
            deltaStatic -= 1;

            // -: linear-volume consumption (stands for cell substrate maintainance)
            const volumeConsumption = 1.0;
            deltaStatic -= this.sx * this.sy * this.sz * volumeConsumption;

            applyDelta(this.signals, Signal.M_ACTIVE, Math.round(deltaStatic));
        };

        _getPhotoSynthesisEfficiency() {
            const numChlr = this.signals.get(Signal.CHLOROPLAST) ?? 0;
            return numChlr / MAX_CONC;
        }

        // return :: ()
        step() {
            
            // update tracer
            this.prevNumAct = this.getNumAct();
            this.age += 1;

            // actual sim
            this._withdrawStaticEnergy();

            // photo synthesis
            let numConversion = Math.floor(this.photons * this._getPhotoSynthesisEfficiency());
            this.photons = 0;
            numConversion = Math.min(numConversion, this.getNumBase(), MAX_CONC - this.getNumAct());
            applyDelta(this.signals, Signal.M_BASE, -numConversion);
            applyDelta(this.signals, Signal.M_ACTIVE, numConversion);

            // Gene expression and transcription.
            let modeLookup = true;
            let val = 1;
            let numAct = this.signals.get(Signal.M_ACTIVE) ?? 0;            
            for (const s of this.genome.genome) {
                if (s === Signal.INVERT) {
                    val = 1 - val;
                } else if (s === Signal.MODE_LOOKUP) {
                    modeLookup = true;
                } else if (s === Signal.MODE_PRODUCE) {
                    modeLookup = false;
                } else if (modeLookup) {
                    val *= (this.signals.get(s) ?? 0) / MAX_CONC;
                } else {
                    if (val > Math.random()) {
                        // some signals cannot be produced directly.
                        if (s === Signal.M_ACTIVE || s === Signal.M_BASE) {
                            continue;
                        } else if (numAct > 0) {
                            applyDelta(this.signals, s, 1);
                            numAct--;
                        }
                    }
                }
            }
            this.signals.set(Signal.M_ACTIVE, numAct);

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

            // signal transporter
            const numTrAUp = (this.signals.get(Signal.TR_A_UP) ?? 0);
            if (numTrAUp > 0 && this.parentCell !== null) {
                const x = Math.min(MAX_CONC - this.parentCell.getNumAct(), this.getNumAct(), numTrAUp);
                applyDelta(this.signals, Signal.M_ACTIVE, -x);
                applyDelta(this.parentCell.signals, Signal.M_ACTIVE, x);
            }
            const numTrADown = (this.signals.get(Signal.TR_A_DOWN) ?? 0);
            if (numTrADown > 0 && this.parentCell !== null) {
                const x = Math.min(this.parentCell.getNumAct(), MAX_CONC - this.getNumAct(), numTrADown);
                applyDelta(this.signals, Signal.M_ACTIVE, x);
                applyDelta(this.parentCell.signals, Signal.M_ACTIVE, -x);
            }
            const numTrBDown = (this.signals.get(Signal.TR_B_DOWN) ?? 0);
            if (numTrBDown > 0) {
                if (this.rooted) {
                    const x = Math.min(MAX_CONC - this.getNumBase(), numTrBDown);
                    applyDelta(this.signals, Signal.M_BASE, x);
                } else if (this.parentCell !== null) {
                    const x = Math.min(this.parentCell.getNumBase(), MAX_CONC - this.getNumBase(), numTrBDown);
                    applyDelta(this.signals, Signal.M_BASE, x);
                    applyDelta(this.parentCell.signals, Signal.M_BASE, -x);
                }
            }

            // cap signals
            for (const [sig, n] of this.signals) {
                if (n > MAX_CONC) {
                    this.signals.set(sig, MAX_CONC);
                }
            }
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
            const ratioA = (this.signals.get(Signal.M_ACTIVE) ?? 0) / MAX_CONC; // magenta (absortbs green)
            const ratioB = (this.signals.get(Signal.M_BASE) ?? 0) / MAX_CONC; // cyan (absorbs red)
            const ratioC = (this.signals.get(Signal.CHLOROPLAST) ?? 0) / MAX_CONC; // green (absorbs red, blue)

            const col = new THREE.Color(1, 1, 1);
            col.multiply(new THREE.Color(1, 1 - ratioA * 0.3, 1));
            col.multiply(new THREE.Color(1 - ratioB * 0.2, 1, 1));
            col.multiply(new THREE.Color(1 - ratioC, 1, 1 - ratioC));
            return {r:col.r, g:col.g, b:col.b};
        }

        giveLight(n) {
            this.photons += n * 5;
        }

        /**
         * @param {string} initial: initial signal
         */
        addCont(numRotZ, numRotX) {
            const childSigs = new Map();
            for (const [sig, n] of this.signals) {
                const nChild = Math.floor(n / 4);
                applyDelta(this.signals, sig, -nChild);
                applyDelta(childSigs, sig, nChild);
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

            const newCell = new Cell(this.unsafeChunk, this.genome.naturalClone(), childSigs, c2w, rotQ, this);
            this.unsafeChunk.liveCells.add(newCell);
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

            // Entities.
            this.liveCells = new Set(); // w/ internal "bio" aspect

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
         * @returns {Cell} added cell
         */
        addPlant(pos, genome, energy) {
            const DEFAULT_SEED_ENERGY = MAX_CONC;

            const seedInnodeToWorld = new THREE.Matrix4().compose(
                pos,
                new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.random() * 2 * Math.PI),
                new THREE.Vector3(1, 1, 1));
            const seedCell = new Cell(this, genome, new Map([[Signal.M_ACTIVE, energy ?? DEFAULT_SEED_ENERGY]]), seedInnodeToWorld, new THREE.Quaternion(), null);
            this.liveCells.add(seedCell);
            return seedCell;
        }

        /**
         * Retrieve current statistics about specified plant id.
         * @param {number} plant id 
         * @returns {Object | null}
         */
        getPlantStat(plantId) {
            const cells = [];
            for (const cell of this.liveCells) {
                if (cell.getRootCell().id === plantId) {
                    cells.push(cell);
                }
            }
            if (cells.length === 0) {
                return null;
            } else {
                return getPlantStatFromCells(cells);
            }
        }

        /**
         * @returns {Object} stats
         */
        step() {
            this.age += 1;

            let t0 = 0;
            const simStats = {};

            t0 = performance.now();

            if (Math.random() < 0.01) {
                this._randomGenomeTransfer();
            }

            for (const cell of this.liveCells) {
                cell.step();
            }

            const dyingCells = new Set();
            for (const cell of this.liveCells) {
                if (cell.getNumAct() === 0) {
                    dyingCells.add(cell);
                }
            }
            for (const cell of this.liveCells) {
                if (cell.parentCell !== null && dyingCells.has(cell.parentCell)) {
                    cell.parentCell = null;
                    cell.parentRot.identity();
                }
            }
            for (const cell of dyingCells) {
                this.liveCells.delete(cell);
            }
            
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
            for (const cell of this.liveCells) {
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
            }
            Ammo.destroy(cellBoxSize);

            // Add/Update constraints. (assumes each cell has exactly 0 or 1 constraint)
            const tfCell = new Ammo.btTransform();
            const tfParent = new Ammo.btTransform();
            for (const cell of this.liveCells) {
                const cellIndex = this.cellToIndex.get(cell);
                const constraint = this.indexToConstraint.get(cellIndex);

                tfCell.setIdentity();
                tfCell.getOrigin().setValue(0, 0, -cell.sz / 2); // innode

                if (constraint === undefined) {
                    if (cell.rooted || cell.parentCell !== null) {
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
                        // translation
                        [0, 1, 2].forEach(ix => {
                            constraint.enableSpring(ix, true);
                            constraint.setStiffness(ix, 100);
                            constraint.setDamping(ix, 0.03);
                        });
                        // rotation
                        [3, 4, 5].forEach(ix => {
                            constraint.enableSpring(ix, true);
                            constraint.setStiffness(ix, 100);
                            constraint.setDamping(ix, 0.2);
                        });
                        constraint.setBreakingImpulseThreshold(100);
    
                        this.rigidWorld.addConstraint(constraint, true); // true: disable collision between neighbors
                        this.indexToConstraint.set(cellIndex, constraint);
                    }
                } else {
                    // Update constraint.
                    const constraint = this.indexToConstraint.get(cellIndex);

                    if (cell.rooted) {
                        // cell-soil link
                        const fb = constraint.getFrameOffsetB();
                        constraint.setFrames(tfCell, fb);
                        Ammo.destroy(fb);
                    } else if (cell.parentCell !== null) {
                        // cell-parent cell link
                        tfParent.setIdentity();
                        tfParent.getOrigin().setValue(0, 0, cell.parentCell.sz / 2);
                        const q = new Ammo.btQuaternion(cell.parentRot.x, cell.parentRot.y, cell.parentRot.z, cell.parentRot.w);
                        tfParent.setRotation(q);
                        Ammo.destroy(q);
                        constraint.setFrames(tfCell, tfParent);
                    } else {
                        this.removeConstraint(cellIndex);
                    }
                }
            }
            Ammo.destroy(tfCell);
            Ammo.destroy(tfParent);

            // Remove cells & constraints.
            for (const cell of this.cellToIndex.keys()) {
                if (!this.liveCells.has(cell)) {
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
                    const seedCell = this.indexToCell.get(cellIx);
                    if (seedCell.parentCell !== null || seedCell.rooted) {
                        continue;
                    }

                    const q = new THREE.Quaternion();
                    seedCell.cellToWorld.decompose(new THREE.Vector3(), q, new THREE.Vector3());
                    seedCell.parentRot = q;
                    seedCell.rooted = true;

                    this.cellIndexToSoilIndex.set(cellIx, soilIx);
                }
            }
        }

        _randomGenomeTransfer() {
            const cs = Array.from(this.liveCells);
            const c0 = cs[Math.floor(Math.random() * cs.length)];
            const c1 = cs[Math.floor(Math.random() * cs.length)];
            c0.genome = Genome.crossover(c0.genome, c1.genome);
        }

        _despawnPlants() {
            const despawnHeight = -50;
            const p = new THREE.Vector3();

            const rootsToDestroy = new Set();
            for (const cell of this.cellToIndex.keys()) {
                p.set(0, 0, 0);
                p.applyMatrix4(cell.cellToWorld);
                if (p.z < despawnHeight) {
                    rootsToDestroy.add(cell.getRootCell());
                }               
            }
            this._removeRootCells(rootsToDestroy);
        }

        _removeRootCells(rootsToDestroy) {
            for (const cell of this.liveCells) {
                if (rootsToDestroy.has(cell.getRootCell())) {
                    this.liveCells.delete(cell);
                }
            }
        }

        serialize() {
            const ser = {};

            const plants = new Map();
            for (const [c, _] of this.cellToIndex) {
                const rc = c.getRootCell();
                if (plants.has(rc)) {
                    plants.get(rc.id).push(c);
                } else {
                    plants.set(c.id, [c]);
                }
            }
            const plantsArr = [];
            for (const [plantId, cells] of plants) {
                plantsArr.push({
                    'id': plantId,
                    'genome': cells[0].genome.encode(),
                    'cells': serializeCells(cells),
                });
            }
            ser['plants'] = plantsArr;

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
            let numPlants = 0;
            let numCells = 0;
            let storedEnergy = 0;

            for (const cell of this.liveCells) {
                numCells++;
                if (cell.parentCell === null) {
                    numPlants++;
                }
                storedEnergy += cell.getNumAct();
            }

            return {
                'age': this.age,
                '#plant': numPlants,
                '#cell': numCells,
                'energy:stored': storedEnergy,
            };
        }

        /**
         * @param {number} plantId 
         */
        removePlantById(plantId) {
            const roots = new Set();
            for (const cell of this.liveCells) {
                if (cell.id === plantId) {
                    roots.add(cell);
                }
            }
            this._removeRootCells(roots);
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

    this.setChunkAmmo = (ammo) => Ammo = ammo;
    this.Chunk = Chunk;

})(this);
