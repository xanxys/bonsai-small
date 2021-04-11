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
        constructor(position, unsafe_chunk, energy, genome, plant_id) {
            this.unsafe_chunk = unsafe_chunk;

            // tracer
            this.age = 0;
            this.id = plant_id;

            // physics
            this.seed_innode_to_world = new THREE.Matrix4().compose(
                position,
                new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.random() * 2 * Math.PI),
                new THREE.Vector3(1, 1, 1));
            this.position = position;

            // biophysics
            this.energy = energy;
            this.seed = new Cell(this, Signal.SHOOT_END, null);  // being deprecated
            this.seed.initPose(this.seed_innode_to_world);
            this.cells = [this.seed];  // flat cells in world coords

            // genetics
            this.genome = genome;
        }

        step() {
            // Step cells (w/o collecting/stepping separation, infinite growth will occur)
            this.age += 1;
            this.cells.forEach(cell => cell.step());
            console.assert(this.seed.age === this.age);

            let mech_valid = true;


            // Consume/store in-Plant energy.
            this.energy += this._powerForPlant() * 1;

            if (this.energy <= 0 || !mech_valid) {
                // die
                this.unsafe_chunk.remove_plant(this);
            }
        }

        // Approximates lifetime of the plant.
        // Max growth=1, zero growth=0.
        // return :: [0,1]
        growth_factor() {
            return Math.exp(-this.age / 20);
        }

        /**
         * 
         * @returns {THREE.Geometry}
         */
        materialize() {
            let proxies = this.cells.map(cell => {
                let m = cell.materializeSingle();

                let trans = new THREE.Vector3();
                let q = new THREE.Quaternion();
                let s = new THREE.Vector3();
                cell.loc_to_world.decompose(trans, q, s);

                m.cell = cell;
                m.position.copy(trans);
                m.quaternion.copy(q);
                return m;
            });

            const mergedGeom = new THREE.Geometry();
            proxies.forEach(proxy => mergedGeom.mergeMesh(proxy));
            return mergedGeom;
        }

        get_stat() {
            let stat_cells = this.cells.map(cell => cell.signals);

            let stat = {};
            stat["#cells"] = stat_cells.length;
            stat['cells'] = stat_cells;
            stat['age/T'] = this.age;
            stat['stored/E'] = this.energy;
            stat['delta/(E/T)'] = this._powerForPlant();
            return stat;
        }

        get_genome() {
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
        constructor(plant, initial_signal, parent_cell) {
            // tracer
            this.age = 0;

            // in-sim (light)
            this.photons = 0;

            // in-sim (phys + bio)
            this.loc_to_parent = new THREE.Quaternion();
            this.sx = 0.5;
            this.sy = 0.5;
            this.sz = 0.5;
            this.loc_to_world = new THREE.Matrix4();

            // in-sim (bio)
            this.plant = plant;
            this.parent_cell = parent_cell;
            this.power = 0;

            // in-sim (genetics)
            this.signals = [initial_signal];
        }

        getMass() {
            return 1e-3 * this.sx * this.sy * this.sz;  // kg
        }

        // sub_cell :: Cell
        // return :: ()
        add(sub_cell) {
            if (this === sub_cell) {
                throw new Error("Tried to add itself as child.", sub_cell);
            } else {
                sub_cell.initPose(this.getOutNodeToWorld());
                this.plant.cells.push(sub_cell);
            }
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
                    return _this.plant.growth_factor();
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
                    _this.add_cont(signal[1], signal[2]);
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
                    let seed_energy = _this._withdrawVariableEnergy(Math.pow(20e-3, 3) * 10);

                    // Get world coordinates.
                    let trans = new THREE.Vector3();
                    let _rot = new THREE.Quaternion();
                    let _scale = new THREE.Vector3();
                    this.loc_to_world.decompose(trans, _rot, _scale);

                    // TODO: should be world coodinate of the flower
                    this.plant.unsafe_chunk.disperse_seed_from(
                        trans, seed_energy, this.plant.genome.naturalClone());
                }
            }
        };

        initPose(innode_to_world) {
            // Update this.
            let parent_to_loc = this.loc_to_parent.clone().inverse();

            let innode_to_center = new THREE.Matrix4().compose(
                new THREE.Vector3(0, 0, -this.sz / 2),
                parent_to_loc,
                new THREE.Vector3(1, 1, 1));
            let center_to_innode = new THREE.Matrix4().getInverse(innode_to_center);
            this.loc_to_world =
                innode_to_world.clone().multiply(center_to_innode);
        }

        getOutNodeToWorld() {
            let parent_to_loc = this.loc_to_parent.clone().inverse();
            let loc_to_outnode = new THREE.Matrix4().compose(
                new THREE.Vector3(0, 0, -this.sz / 2),
                parent_to_loc,
                new THREE.Vector3(1, 1, 1));

            let outnode_to_loc = new THREE.Matrix4().getInverse(loc_to_outnode);
            return this.loc_to_world.clone().multiply(outnode_to_loc);
        }

        getBtTransform() {
            let trans = new THREE.Vector3();
            let quat = new THREE.Quaternion();
            let unused_scale = new THREE.Vector3();
            this.loc_to_world.decompose(trans, quat, unused_scale);

            let tf = new Ammo.btTransform();
            tf.setIdentity();
            tf.setOrigin(new Ammo.btVector3(trans.x, trans.y, trans.z));
            tf.setRotation(new Ammo.btQuaternion(quat.x, quat.y, quat.z, quat.w));
            return tf;
        }

        setBtTransform(tf) {
            let t = tf.getOrigin();
            let r = tf.getRotation();
            this.loc_to_world.compose(
                new THREE.Vector3(t.x(), t.y(), t.z()),
                new THREE.Quaternion(r.x(), r.y(), r.z(), r.w()),
                new THREE.Vector3(1, 1, 1));
        }

        // Create origin-centered, colored AABB for this Cell.
        // return :: THREE.Mesh
        materializeSingle() {
            // Create cell object [-sx/2,sx/2] * [-sy/2,sy/2] * [0, sz]
            let flr_ratio = (this.signals.includes(Signal.FLOWER)) ? 0.5 : 1;
            let chl_ratio = 1 - this._getPhotoSynthesisEfficiency();

            let color_diffuse = new THREE.Color();
            color_diffuse.setRGB(
                chl_ratio,
                flr_ratio,
                flr_ratio * chl_ratio);

            if (this.photons === 0) {
                color_diffuse.offsetHSL(0, 0, -0.2);
            }
            if (this.plant.energy < 1e-4) {
                let t = 1 - this.plant.energy * 1e4;
                color_diffuse.offsetHSL(0, -t, 0);
            }

            let geom_cube = new THREE.CubeGeometry(this.sx, this.sy, this.sz);
            for (let i = 0; i < geom_cube.faces.length; i++) {
                for (let j = 0; j < 3; j++) {
                    geom_cube.faces[i].vertexColors[j] = color_diffuse;
                }
            }

            return new THREE.Mesh(
                geom_cube,
                new THREE.MeshLambertMaterial({
                    vertexColors: THREE.VertexColors
                }));
        };

        give_photon() {
            this.photons += 1;
        }

        // initial :: Signal
        // locator :: LocatorSignal
        // return :: ()
        add_cont(initial, locator) {
            function calc_rot(desc) {
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


            let new_cell = new Cell(this.plant, initial, this);
            new_cell.loc_to_parent = calc_rot(locator);
            this.add(new_cell);
        }
    }

    // Represents soil surface state by a grid.
    // parent :: Chunk
    // size :: float > 0
    class Soil {
        constructor(parent, size) {
            this.parent = parent;

            this.n = 35;
            this.size = size;
        }

        serialize() {
            let array = [];
            for (let y = 0; y < this.n; y++) {
                for (let x = 0; x < this.n; x++) {
                    let v = Math.min(1, this.parent.light.shadow_map[x + y * this.n] / 2 + 0.1);
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

            this.n = 35;
            this.size = size;

            // number of photos that hit ground.
            this.shadow_map = new Float32Array(this.n * this.n);
        }

        step() {
            this._updateShadowMap(this.chunk.rigid_world, this.chunk.cellMapping);
        }

        _updateShadowMap(rigidWorld, cellMapping) {
            for (let i = 0; i < this.n; i++) {
                for (let j = 0; j < this.n; j++) {
                    this.shadow_map[i + j * this.n] = 0;

                    // 50% light in smaller i region
                    if (i < this.n / 2 && Math.random() < 0.5) {
                        continue;
                    }

                    const cb = new Ammo.ClosestRayResultCallback();
                    const x = ((i + Math.random()) / this.n - 0.5) * this.size;
                    const y = ((j + Math.random()) / this.n - 0.5) * this.size;
                    const org = new Ammo.btVector3(x, y, 100);
                    rigidWorld.rayTest(org, new Ammo.btVector3(x, y, -1), cb);

                    if (cb.hasHit()) {
                        const uIndex = cb.m_collisionObject.getUserIndex();
                        const cell = cellMapping.get(uIndex);
                        if (cell !== undefined) {
                            cell.give_photon();
                        } else {
                            // hit ground
                            this.shadow_map[i + j * this.n] += 1.0;    
                        }
                    } else {
                        // hit nothing (shouldn't happen)
                    }
                }
            }
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
            this.size = 50;

            // tracer
            this.age = 0;
            this.new_plant_id = 0;

            // Entities.
            this.plants = [];  // w/ internal "bio" aspect
            this.soil = new Soil(this, this.size);
            this.seeds = [];

            // Temporary hacks.
            this.cell_to_rigid_body = new Map();
            this.cell_to_parent_joint = new Map();

            this.userIndex = 1;
            this.cellMapping = new Map();

            // Physical aspects.
            this.light = new Light(this, this.size);
            this.rigid_world = this._createRigidWorld();
            this.light.step(); // update shadow map
        }

        _createRigidWorld() {
            let collision_configuration = new Ammo.btDefaultCollisionConfiguration();
            let dispatcher = new Ammo.btCollisionDispatcher(collision_configuration);
            let overlappingPairCache = new Ammo.btDbvtBroadphase();
            let solver = new Ammo.btSequentialImpulseConstraintSolver();
            let rigid_world = new Ammo.btDiscreteDynamicsWorld(dispatcher, overlappingPairCache, solver, collision_configuration);
            rigid_world.setGravity(new Ammo.btVector3(0, 0, -100));

            // Add ground.
            let ground_shape = new Ammo.btStaticPlaneShape(new Ammo.btVector3(0, 0, 1), 0);
            let trans = new Ammo.btTransform();
            trans.setIdentity();

            let motion = new Ammo.btDefaultMotionState(trans);
            let rb_info = new Ammo.btRigidBodyConstructionInfo(
                0 /* mass */, motion, ground_shape, new Ammo.btVector3(0, 0, 0) /* inertia */);
            let ground = new Ammo.btRigidBody(rb_info);
            ground.setUserIndex(0);
            rigid_world.addRigidBody(ground);
            this.ground_rb = ground;

            return rigid_world;
        }

        // Add standard plant seed.
        add_default_plant(pos) {
            return this.add_plant(
                pos,
                Math.pow(20e-3, 3) * 100, // allow 2cm cube for 100T)
                new Genome());
        }

        // pos :: THREE.Vector3 (z must be 0)
        // energy :: Total starting energy for the new plant.
        // genome :: genome for new plant
        // return :: Plant
        add_plant(pos, energy, genome) {
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
        disperse_seed_from(pos, energy, genome) {
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
        remove_plant(plant) {
            this.plants = this.plants.filter(p => p !== plant);
        }

        // return :: dict
        get_stat() {
            let stored_energy = sum(this.plants.map(plant => {
                return plant.energy;
            }));

            return {
                'age/T': this.age,
                'plant': this.plants.length,
                'stored/E': stored_energy
            };
        }

        /**
         * Retrieve current statistics about specified plant id.
         * @param {number} plant id 
         * @returns {Object | null}
         */
        get_plant_stat(id) {
            let stat = null;
            this.plants.forEach(plant => {
                if (plant.id === id) {
                    stat = plant.get_stat();
                }
            });
            return stat;
        }

        /**
         * 
         * @param {*} id 
         * @returns {Array | null}
         */
        get_plant_genome(id) {
            let genome = null;
            this.plants.forEach(plant =>{
                if (plant.id === id) {
                    genome = plant.get_genome();
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
                this.add_plant(seed.pos, seed.energy, seed.genome);
            });
            this.seeds = [];
            sim_stats['bio/ms'] = performance.now() - t0;

            t0 = performance.now();
            this._export_plants_to_rigid();
            sim_stats['bio->rigid/ms'] = performance.now() - t0;

            t0 = performance.now();
            this.light.step(this.rigid_world, this.cellMapping);
            sim_stats['light/ms'] = performance.now() - t0;

            t0 = performance.now();
            this.rigid_world.stepSimulation(0.04, 2);
            this._update_plants_from_rigid();
            sim_stats['rigid/ms'] = performance.now() - t0;

            return sim_stats;
        }

        _export_plants_to_rigid() {
            // There are three types of changes: add / modify / delete
            let live_cells = new Set();
            for (let plant of this.plants) {
                for (let cell of plant.cells) {
                    let rb = this.cell_to_rigid_body.get(cell);

                    // Also add contraint.
                    let tf_cell = new Ammo.btTransform();
                    tf_cell.setIdentity();
                    tf_cell.setOrigin(new Ammo.btVector3(0, 0, -cell.sz / 2)); // innode
                    let tf_parent = new Ammo.btTransform();
                    tf_parent.setIdentity();
                    if (cell.parent_cell === null) {
                        // point on ground
                        tf_parent.setOrigin(new Ammo.btVector3(cell.plant.position.x, cell.plant.position.y, 0));
                    } else {
                        // outnode of parent
                        tf_parent.setOrigin(new Ammo.btVector3(0, 0, cell.parent_cell.sz / 2));
                    }

                    if (rb === undefined) {
                        // New cell added.
                        let cell_shape = new Ammo.btBoxShape(new Ammo.btVector3(0.5, 0.5, 0.5));  // (1m)^3 cube
                        cell_shape.setLocalScaling(new Ammo.btVector3(cell.sx, cell.sy, cell.sz));

                        let local_inertia = new Ammo.btVector3(0, 0, 0);
                        cell_shape.calculateLocalInertia(cell.getMass(), local_inertia);
                        // TODO: Is it correct to use total mass, after LocalScaling??

                        let motion_st = new Ammo.btDefaultMotionState(cell.getBtTransform());
                        let rb_info = new Ammo.btRigidBodyConstructionInfo(cell.getMass(), motion_st, cell_shape, local_inertia);
                        let rb = new Ammo.btRigidBody(rb_info);
                        this.associateCell(rb, cell);
                        rb.setFriction(0.8);

                        this.rigid_world.addRigidBody(rb);
                        this.cell_to_rigid_body.set(cell, rb);

                        // Add a joint to the parent (another Cell or Soil).
                        let parent_rb = cell.parent_cell === null ? this.ground_rb : this.cell_to_rigid_body.get(cell.parent_cell);
                        let joint = new Ammo.btGeneric6DofSpringConstraint(rb, parent_rb, tf_cell, tf_parent, true);
                        joint.setAngularLowerLimit(new Ammo.btVector3(0.01, 0.01, 0.01));
                        joint.setAngularUpperLimit(new Ammo.btVector3(-0.01, -0.01, -0.01));
                        joint.setLinearLowerLimit(new Ammo.btVector3(0.01, 0.01, 0.01));
                        joint.setLinearUpperLimit(new Ammo.btVector3(-0.01, -0.01, -0.01));
                        [0, 1, 2, 3, 4, 5].forEach(ix => {
                            joint.enableSpring(ix, true);
                            joint.setStiffness(ix, 100);
                            joint.setDamping(ix, 0.1);
                        });
                        joint.setBreakingImpulseThreshold(100);
                        this.rigid_world.addConstraint(joint, true /* no collision between neighbors */);
                        this.cell_to_parent_joint.set(cell, joint);
                    } else {
                        // Apply modification.
                        rb.getCollisionShape().setLocalScaling(new Ammo.btVector3(cell.sx, cell.sy, cell.sz));
                        let local_inertia = new Ammo.btVector3(0, 0, 0);
                        rb.getCollisionShape().calculateLocalInertia(cell.getMass(), local_inertia);
                        rb.setMassProps(cell.getMass(), local_inertia);
                        rb.updateInertiaTensor();
                        // TODO: maybe need to call some other updates?

                        // Update joint between current cell and its parent.
                        let joint = this.cell_to_parent_joint.get(cell);
                        
                        joint.setFrames(tf_cell, tf_parent);
                    }
                    live_cells.add(cell);
                }
            }
            // Apply removal.
            if (this.cell_to_rigid_body.size > live_cells.size) {
                for (let [cell, rb] of this.cell_to_rigid_body) {
                    if (!live_cells.has(cell)) {
                        this.rigid_world.removeRigidBody(rb);
                        this.cell_to_rigid_body.delete(cell);
                        this.cell_to_parent_joint.delete(cell);
                    }
                }
            }
        }
        
        associateCell(rb, cell) {
            rb.setUserIndex(this.userIndex);
            this.cellMapping.set(this.userIndex, cell);

            this.userIndex++;
            if (this.userIndex >= 2**31) {
                console.warn('userIndex overflown; simulation might break');
                this.userIndex = 1; // restart from 1 (this will break if cell id 1 still retamins in the scene)
            }
        }

        _update_plants_from_rigid() {
            for (let [cell, rb] of this.cell_to_rigid_body) {
                cell.setBtTransform(rb.getCenterOfMassTransform());
            }
        }

        serialize() {
            let ser = {};
            ser['plants'] = this.plants.map(plant => {
                let geom = plant.materialize(true);

                return {
                    'id': plant.id,
                    'vertices': geom.vertices,
                    'faces': geom.faces
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
