(function() {

if(console.assert === undefined) {
  console.assert = function(cond) {
    if(!cond) {
      throw "assertion failed";
    }
  };
}

let now = function() {
  if(typeof performance !== 'undefined') {
    return performance.now();
  } else {
    return new Date().getTime();
  }
};


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
    this.seed = new Cell(this, Signal.SHOOT_END);  // being deprecated
    this.cells = [this.seed];  // flat cells in world coords

    // genetics
    this.genome = genome;
  }

  step() {
    // Step cells (w/o collecting/stepping separation, infinite growth will occur)
    this.age += 1;
    this.cells.forEach(cell => cell.step());
    console.assert(this.seed.age === this.age);

    let mech_valid = this.seed.checkMechanics();
    this.seed.updatePose(this.seed_innode_to_world);

    // Consume/store in-Plant energy.
    this.energy += this._powerForPlant() * 1;

    if(this.energy <= 0 || !mech_valid) {
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

  // return :: THREE.Object3D<world>
  materialize(merge) {
    let proxies = _.map(this.cells, cell => {
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

    if(merge) {
      let merged_geom = new THREE.Geometry();
      _.each(proxies, function(proxy) {
        merged_geom.mergeMesh(proxy);
      });

      let merged_plant = new THREE.Mesh(
        merged_geom,
        new THREE.MeshLambertMaterial({vertexColors: THREE.VertexColors}));

      return merged_plant;
    } else {
      let three_plant = new THREE.Object3D();
      _.each(proxies, function(proxy) {
        three_plant.add(proxy);
      });
      return three_plant;
    }
  }

  get_stat() {
    let stat_cells = _.map(this.cells, cell => cell.signals);

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
    let sum_power_cell_recursive = function(cell) {
      return cell.powerForPlant() +
        sum(_.map(cell.children, sum_power_cell_recursive));
    };
    return sum_power_cell_recursive(this.seed);
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
  constructor(plant, initial_signal) {
    // tracer
    this.age = 0;

    // in-sim (light)
    this.photons = 0;

    // in-sim (phys + bio)
    this.loc_to_parent = new THREE.Quaternion();
    this.sx = 1e-3;
    this.sy = 1e-3;
    this.sz = 1e-3;
    this.loc_to_world = new THREE.Matrix4();

    // in-sim (bio)
    this.plant = plant;
    this.children = [];  // out_conn
    this.power = 0;

    // in-sim (genetics)
    this.signals = [initial_signal];
  }

  // Run pseudo-mechanical stability test based solely
  // on mass and cross-section.
  // return :: valid :: bool
  checkMechanics() {
    return this._checkMass().valid;
  }

  // return: {valid: bool, total_mass: num}
  _checkMass() {
    let mass = 1e3 * this.sx * this.sy * this.sz;  // kg

    let total_mass = mass;
    let valid = true;
    _.each(this.children, function(cell) {
      let child_result = cell._checkMass();
      total_mass += child_result.total_mass;
      valid &= child_result.valid;
    });

    // 4mm:30g max
    // mass[kg] / cross_section[m^2] = 7500.
    if(total_mass / (this.sx * this.sy) > 7500 * 5) {
      valid = false;
    }

    // 4mm:30g * 1cm max
    // mass[kg]*length[m] / cross_section[m^2] = 75
    if(total_mass * this.sz / (this.sx * this.sy) > 75 * 5) {
      valid = false;
    }

    return {
      valid: valid,
      total_mass: total_mass
    };
  }

  // sub_cell :: Cell
  // return :: ()
  add(sub_cell) {
    if(this === sub_cell) {
      throw new Error("Tried to add itself as child.", sub_cell);
    } else {
      this.children.push(sub_cell);
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
    if(this.plant.energy > amount) {
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
    delta_static -= 10 * 1e-9;

    // -: linear-volume consumption (stands for cell substrate maintainance)
    let volume_consumption = 1.0;
    delta_static -= this.sx * this.sy * this.sz * volume_consumption;

    this.photons = 0;

    if(this.plant.energy < delta_static) {
      this.plant.energy = -1e-3;  // set death flag (TODO: implicit value encoding is bad idea)
    } else {
      this.power += delta_static;
      this.plant.energy += delta_static;
    }
  };

  _getPhotoSynthesisEfficiency() {
    // 1:1/2, 2:3/4, etc...
    let num_chl = sum(_.map(this.signals, function(sig) {
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
      if(signal === Signal.HALF) {
        return 0.5;
      } else if(signal === Signal.GROWTH) {
        return _this.plant.growth_factor();
      } else if(signal.length >= 2 && signal[0] === Signal.INVERT) {
        return 1 - unity_calc_prob_term(signal.substr(1));
      } else if(_.contains(_this.signals, signal)) {
        return 1;
      } else {
        return 0.001;
      }
    }

    function unity_calc_prob(when) {
      return product(_.map(when, unity_calc_prob_term));
    }

    // Gene expression and transcription.
    _.each(this.plant.genome.unity, function(gene) {
      if(unity_calc_prob(gene['when']) > Math.random()) {
        let num_codon = sum(_.map(gene['emit'], function(sig) {
          return sig.length
        }));

        if(_this._withdrawEnergy(num_codon * 1e-10)) {
          _this.signals = _this.signals.concat(gene['emit']);
        }
      }
    });

    // Bio-physics.
    // TODO: define remover semantics.
    let removers = {};
    _.each(this.signals, function(signal) {
      if(signal.length >= 2 && signal[0] === Signal.REMOVER) {
        let rm = signal.substr(1);
        if(removers[rm] !== undefined) {
          removers[rm] += 1;
        } else {
          removers[rm] = 1;
        }
      }
    });

    let new_signals = [];
    _.each(this.signals, function(signal) {
      if(signal.length === 3 && signal[0] === Signal.DIFF) {
        _this.add_cont(signal[1], signal[2]);
      } else if(signal === Signal.G_DX) {
        _this.sx += 1e-3;
      } else if(signal === Signal.G_DY) {
        _this.sy += 1e-3;
      } else if(signal === Signal.G_DZ) {
        _this.sz += 1e-3;
      } else if(removers[signal] !== undefined && removers[signal] > 0) {
        removers[signal] -= 1;
      } else {
        new_signals.push(signal);
      }
    });
    this.signals = new_signals;

    // Physics
    if(_.contains(this.signals, Signal.FLOWER)) {
      // Disperse seed once in a while.
      // TODO: this should be handled by physics, not biology.
      // Maybe dead cells with stored energy survives when fallen off.
      if(Math.random() < 0.01) {
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

  updatePose(innode_to_world) {
    // Update this.
    let parent_to_loc = this.loc_to_parent.clone().inverse();

    let innode_to_center = new THREE.Matrix4().compose(
      new THREE.Vector3(0, 0, -this.sz / 2),
      parent_to_loc,
      new THREE.Vector3(1, 1, 1));
    let center_to_innode = new THREE.Matrix4().getInverse(innode_to_center);
    this.loc_to_world = innode_to_world.clone().multiply(
      center_to_innode);

    let innode_to_outnode = new THREE.Matrix4().compose(
      new THREE.Vector3(0, 0, -this.sz),
      parent_to_loc,
      new THREE.Vector3(1, 1, 1));

    let outnode_to_innode = new THREE.Matrix4().getInverse(innode_to_outnode);
    let outnode_to_world = innode_to_world.clone().multiply(
      outnode_to_innode);

    _.each(this.children, function(child) {
      child.updatePose(outnode_to_world);
    });
  };

  // Create origin-centered, colored AABB for this Cell.
  // return :: THREE.Mesh
  materializeSingle() {
    // Create cell object [-sx/2,sx/2] * [-sy/2,sy/2] * [0, sz]
    let flr_ratio = (_.contains(this.signals, Signal.FLOWER)) ? 0.5 : 1;
    let chl_ratio = 1 - this._getPhotoSynthesisEfficiency();

    let color_diffuse = new THREE.Color();
    color_diffuse.setRGB(
      chl_ratio,
      flr_ratio,
      flr_ratio * chl_ratio);

    if(this.photons === 0) {
      color_diffuse.offsetHSL(0, 0, -0.2);
    }
    if(this.plant.energy < 1e-4) {
      let t = 1 - this.plant.energy * 1e4;
      color_diffuse.offsetHSL(0, -t, 0);
    }

    let geom_cube = new THREE.CubeGeometry(this.sx, this.sy, this.sz);
    for(let i = 0; i < geom_cube.faces.length; i++) {
      for(let j = 0; j < 3; j++) {
        geom_cube.faces[i].vertexColors[j] = color_diffuse;
      }
    }

    return new THREE.Mesh(
      geom_cube,
      new THREE.MeshLambertMaterial({
        vertexColors: THREE.VertexColors}));
  };

  givePhoton() {
    this.photons += 1;
  };

  // Get Cell age in ticks.
  // return :: int (tick)
  get_age() {
    return this.age;
  };

  // counter :: dict(string, int)
  // return :: dict(string, int)
  count_type(counter) {
    let key = this.signals[0];

    counter[key] = 1 + (_.has(counter, key) ? counter[key] : 0);

    _.each(this.children, function(child) {
      child.count_type(counter);
    }, this);

    return counter;
  };

  // initial :: Signal
  // locator :: LocatorSignal
  // return :: ()
  add_cont(initial, locator) {
    function calc_rot(desc) {
      if(desc === Signal.CONICAL) {
        return new THREE.Quaternion().setFromEuler(new THREE.Euler(
          Math.random() - 0.5,
          Math.random() - 0.5,
          0));
      } else if(desc === Signal.HALF_CONICAL) {
        return new THREE.Quaternion().setFromEuler(new THREE.Euler(
          (Math.random() - 0.5) * 0.5,
          (Math.random() - 0.5) * 0.5,
          0));
      } else if(desc === Signal.FLIP) {
        return new THREE.Quaternion().setFromEuler(new THREE.Euler(
          -Math.PI / 2,
          0,
          0));
      } else if(desc === Signal.TWIST) {
        return new THREE.Quaternion().setFromEuler(new THREE.Euler(
          0,
          0,
          (Math.random() - 0.5) * 1));
      } else {
        return new THREE.Quaternion();
      }
    }


    let new_cell = new Cell(this.plant, initial);
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

  // return :: THREE.Object3D
  materialize() {
    // Create texture.
    let canvas = this._generateTexture();

    // Attach tiles to the base.
    let tex = new THREE.Texture(canvas);
    tex.needsUpdate = true;

    let soil_plate = new THREE.Mesh(
      new THREE.CubeGeometry(this.size, this.size, 1e-3),
      new THREE.MeshBasicMaterial({
        map: tex
      }));
    return soil_plate;
  }

  serialize() {
    let array = [];
    _.each(_.range(this.n), function(y) {
      _.each(_.range(this.n), function(x) {
        let v = this.parent.light.shadow_map[x + y * this.n] > 1e-3 ? 0.1 : 0.5;
        array.push(v);
      }, this);
    }, this);
    return {
      luminance: array,
      n: this.n,
      size: this.size
    };
  }

  // return :: Canvas
  _generateTexture() {
    let canvas = document.createElement('canvas');
    canvas.width = this.n;
    canvas.height = this.n;
    let context = canvas.getContext('2d');
    _.each(_.range(this.n), function(y) {
      _.each(_.range(this.n), function(x) {
        let v = this.parent.light.shadow_map[x + y * this.n] > 1e-3 ? 0.1 : 0.5;
        let lighting = new THREE.Color().setRGB(v, v, v);

        context.fillStyle = lighting.getStyle();
        context.fillRect(x, this.n - y, 1, 1);
      }, this);
    }, this);
    return canvas;
  }
}

// Downward directional light.
class Light {
  constructor(chunk, size) {
    this.chunk = chunk;

    this.n = 35;
    this.size = size;

    this.shadow_map = new Float32Array(this.n * this.n);
  }

  step() {
    this.updateShadowMapHierarchical();
  }

  updateShadowMapHierarchical() {
    let _this = this;

    // Put Plants to all overlapping 2D uniform grid cells.
    let ng = 15;
    let grid = _.map(_.range(0, ng), function(ix) {
      return _.map(_.range(0, ng), function(iy) {
        return [];
      });
    });

    _.each(this.chunk.plants, function(plant) {
      let object = plant.materialize(false);
      object.updateMatrixWorld();

      let v_min = new THREE.Vector3();
      let v_max = new THREE.Vector3();
      let v_temp = new THREE.Vector3();
      _.each(object.children, function(child) {
        // Calculate AABB.
        v_min.set(1e3, 1e3, 1e3);
        v_max.set(-1e3, -1e3, -1e3);
        _.each(child.geometry.vertices, function(vertex) {
          v_temp.set(vertex.x, vertex.y, vertex.z);
          child.localToWorld(v_temp);
          v_min.min(v_temp);
          v_max.max(v_temp);
        });

        // Store to uniform grid.
        let vi0 = toIxV_unsafe(v_min);
        let vi1 = toIxV_unsafe(v_max);

        let ix0 = Math.max(0, Math.floor(vi0.x));
        let iy0 = Math.max(0, Math.floor(vi0.y));
        let ix1 = Math.min(ng, Math.ceil(vi1.x));
        let iy1 = Math.min(ng, Math.ceil(vi1.y));

        for(let ix = ix0; ix < ix1; ix++) {
          for(let iy = iy0; iy < iy1; iy++) {
            grid[ix][iy].push(child);
          }
        }
      });
    });

    function toIxV_unsafe(v3) {
      v3.multiplyScalar(ng / _this.size);
      v3.x += ng * 0.5;
      v3.y += ng * 0.5;
      return v3;
    }

    // Accelerated ray tracing w/ the uniform grid.
    function intersectDown(origin, near, far) {
      let i = toIxV_unsafe(origin.clone());
      let ix = Math.floor(i.x);
      let iy = Math.floor(i.y);

      if(ix < 0 || iy < 0 || ix >= ng || iy >= ng) {
        return [];
      }

      return new THREE.Raycaster(origin, new THREE.Vector3(0, 0, -1), near, far)
        .intersectObjects(grid[ix][iy], true);
    }

    for(let i = 0; i < this.n; i++) {
      for(let j = 0; j < this.n; j++) {
        let isect = intersectDown(
          new THREE.Vector3(
            ((i + Math.random()) / this.n - 0.5) * this.size,
            ((j + Math.random()) / this.n - 0.5) * this.size,
            10),
          0.1,
          1e2);

        if(isect.length > 0) {
          isect[0].object.cell.givePhoton();
          this.shadow_map[i + j * this.n] = isect[0].point.z;
        } else {
          this.shadow_map[i + j * this.n] = 0;
        }
      }
    }
  }
}


// A chunk is non-singleton, finite patch of space containing bunch of plants, soil,
// and light field.
// Chunk have no coupling with DOM or external state. Main methods are
// step & serialize. Other methods are mostly for statistics.
class Chunk {
  constructor() {
    // Chunk spatial constants.
    this.size = 0.5;

    // tracer
    this.age = 0;
    this.new_plant_id = 0;

    // Entities.
    this.plants = [];  // w/ internal "bio" aspect
    this.soil = new Soil(this, this.size);
    this.seeds = [];

    // Physical aspects.
    this.light = new Light(this, this.size);
    this.rigid_world = this._create_rigid_world();
  }

　_create_rigid_world() {
    let collision_configuration = new Ammo.btDefaultCollisionConfiguration();
    let dispatcher = new Ammo.btCollisionDispatcher(collision_configuration);
    let overlappingPairCache = new Ammo.btDbvtBroadphase();
    let solver = new Ammo.btSequentialImpulseConstraintSolver();
    let rigid_world = new Ammo.btDiscreteDynamicsWorld(dispatcher, overlappingPairCache, solver, collision_configuration);
    rigid_world.setGravity(new Ammo.btVector3(0, -10, 0));

    // add ground box
    let groundShape     = new Ammo.btBoxShape(new Ammo.btVector3(50, 50, 50));
    let bodies          = [];
    let groundTransform = new Ammo.btTransform();
    groundTransform.setIdentity();
    groundTransform.setOrigin(new Ammo.btVector3(0, -56, 0));

    let localInertia  = new Ammo.btVector3(0, 0, 0);
    let myMotionState = new Ammo.btDefaultMotionState(groundTransform);
    let rbInfo        = new Ammo.btRigidBodyConstructionInfo(0 /* mass */, myMotionState, groundShape, localInertia);
    let body          = new Ammo.btRigidBody(rbInfo);

    rigid_world.addRigidBody(body);
    bodies.push(body);

    {
      let colShape        = new Ammo.btSphereShape(1);
      let startTransform  = new Ammo.btTransform();

      startTransform.setIdentity();

      let mass          = 1;
      let localInertia  = new Ammo.btVector3(0, 0, 0);
      colShape.calculateLocalInertia(mass,localInertia);

      startTransform.setOrigin(new Ammo.btVector3(2, 10, 0));

      let myMotionState = new Ammo.btDefaultMotionState(startTransform);
      let rbInfo        = new Ammo.btRigidBodyConstructionInfo(mass, myMotionState, colShape, localInertia);
      let body          = new Ammo.btRigidBody(rbInfo);

      rigid_world.addRigidBody(body);
      bodies.push(body);
    }

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
    if(pos.z < 0.01) {
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
    this.plants = _.without(this.plants, plant);
  }

  // return :: dict
  get_stat() {
    let stored_energy = sum(_.map(this.plants, function(plant) {
      return plant.energy;
    }));

    return {
      'age/T': this.age,
      'plant': this.plants.length,
      'stored/E': stored_energy
    };
  }

  // Retrieve current statistics about specified plant id.
  // id :: int (plant id)
  // return :: dict | null
  get_plant_stat(id) {
    let stat = null;
    _.each(this.plants, function(plant) {
      if(plant.id === id) {
        stat = plant.get_stat();
      }
    });
    return stat;
  }

  // return :: array | null
  get_plant_genome(id) {
    let genome = null;
    _.each(this.plants, function(plant) {
      if(plant.id === id) {
        genome = plant.get_genome();
      }
    });
    return genome;
  }

  // return :: object (stats)
  step() {
    this.age += 1;

    let t0 = 0;
    let sim_stats = {};

    t0 = now();
    _.each(this.plants, function(plant) {
      plant.step();
    }, this);

    _.each(this.seeds, function(seed) {
      this.add_plant(seed.pos, seed.energy, seed.genome);
    }, this);
    this.seeds = [];
    sim_stats['bio/ms'] = now() - t0;

    t0 = now();
    this.light.step();
    sim_stats['light/ms'] = now() - t0;

    t0 = now();
    this.rigid_world.stepSimulation(1/60);  // 1 tick = 1/60 sec. Soooo fake phnysics...
    sim_stats['rigid/ms'] = now() - t0;

    return sim_stats;
  }

  serialize() {
    let ser = {};
    ser['plants'] = _.map(this.plants, function(plant) {
      let mesh = plant.materialize(true);

      return {
        'id': plant.id,
        'vertices': mesh.geometry.vertices,
        'faces': mesh.geometry.faces
      };
    }, this);
    ser['soil'] = this.soil.serialize();

    return ser;
  }

  // Kill plant with specified id.
  kill(id) {
    this.plants = _.filter(this.plants, function(plant) {
      return (plant.id !== id);
    });
  }
}

// xs :: [num]
// return :: num
function sum(xs) {
  return _.reduce(xs, function(x, y) {
    return x + y;
  }, 0);
}

// xs :: [num]
// return :: num
function product(xs) {
  return _.reduce(xs, function(x, y) {
    return x * y;
  }, 1);
}

this.Chunk = Chunk;

})(this);
