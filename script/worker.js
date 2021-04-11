importScripts('./three.js');
importScripts('./ammo.wasm.js');
importScripts('./worker_chunk.js');
importScripts('./genome.js');

function startChunkWorker(Ammo) {
    setChunkAmmo(Ammo);
    const chunk = new Chunk();

    // Should be moved to bonsai.js
    let stressTest = false;
    if (!stressTest) {
        for (let iy = -2; iy <= 2; iy ++) {
            for (let ix = -2; ix <= 2; ix ++) {
                this.current_plant = chunk.add_default_plant(
                    new THREE.Vector3(ix * 7, iy * 7, 0));
            }
        }
    } else {
        for (let iy = -10; iy <= 10; iy ++) {
            for (let ix = -10; ix <= 10; ix ++) {
                this.current_plant = chunk.add_default_plant(
                    new THREE.Vector3(ix * 3, iy * 3, 0));
            }
        }
    }

    self.addEventListener('message', ev => {
        const msgType = ev.data.type;
        const payload = ev.data.data;

        try {
            if (msgType === 'step') {
                let sim_stat = chunk.step();
                self.postMessage({
                    type: 'step-complete',
                    data: sim_stat
                });
            } else if (msgType === 'kill') {
                chunk.kill(payload.id);
            } else if (msgType === 'serialize') {
                self.postMessage({
                    type: 'serialize',
                    data: chunk.serialize()
                });
            } else if (msgType === 'stat') {
                self.postMessage({
                    type: 'stat-chunk',
                    data: chunk.get_stat()
                });
            } else if (msgType === 'stat-plant') {
                self.postMessage({
                    type: 'stat-plant',
                    data: {
                        id: payload.id,
                        stat: chunk.get_plant_stat(payload.id)
                    }
                });
            } else if (msgType === 'genome-plant') {
                self.postMessage({
                    type: 'genome-plant',
                    data: {
                        id: payload.id,
                        genome: chunk.get_plant_genome(payload.id)
                    }
                });
            }
        } catch (e) {
            console.trace(e);
        }
    });

    self.postMessage({type: 'init-complete'});
};

Ammo().then(Ammo => {
    startChunkWorker(Ammo);
});