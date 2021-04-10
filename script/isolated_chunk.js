importScripts('./three.js');
importScripts('./ammo.js');
importScripts('./chunk.js');
importScripts('./genome.js');

function startChunkServer(Ammo) {
    let _this = this;

    setChunkAmmo(Ammo);
    this.chunk = new Chunk();

    // Should be moved to bonsai.js
    let stressTest = false;
    if (!stressTest) {
        for (let iy = -2; iy <= 2; iy ++) {
            for (let ix = -2; ix <= 2; ix ++) {
                this.current_plant = _this.chunk.add_default_plant(
                    new THREE.Vector3(ix * 7, iy * 7, 0));
            }
        }
    } else {
        for (let iy = -10; iy <= 10; iy ++) {
            for (let ix = -10; ix <= 10; ix ++) {
                this.current_plant = _this.chunk.add_default_plant(
                    new THREE.Vector3(ix * 3, iy * 3, 0));
            }
        }
    }

    self.addEventListener('message', function (ev) {
        try {
            if (ev.data.type === 'step') {
                let sim_stat = _this.chunk.step();
                self.postMessage({
                    type: 'stat-sim',
                    data: sim_stat
                });
            } else if (ev.data.type === 'kill') {
                _this.chunk.kill(ev.data.data.id);
            } else if (ev.data.type === 'serialize') {
                self.postMessage({
                    type: 'serialize',
                    data: _this.chunk.serialize()
                });
            } else if (ev.data.type === 'stat') {
                self.postMessage({
                    type: 'stat-chunk',
                    data: _this.chunk.get_stat()
                });
            } else if (ev.data.type === 'stat-plant') {
                self.postMessage({
                    type: 'stat-plant',
                    data: {
                        id: ev.data.data.id,
                        stat: _this.chunk.get_plant_stat(ev.data.data.id)
                    }
                });
            } else if (ev.data.type === 'genome-plant') {
                self.postMessage({
                    type: 'genome-plant',
                    data: {
                        id: ev.data.data.id,
                        genome: _this.chunk.get_plant_genome(ev.data.data.id)
                    }
                });
            }
        } catch (e) {
            console.trace(e);
        }
    });
};

Ammo().then(function (Ammo) {
    startChunkServer(Ammo);
});
