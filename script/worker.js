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
                this.current_plant = chunk.addDefaultPlant(
                    new THREE.Vector3(30 + ix * 5, 30 + iy * 5, 20));
            }
        }
    } else {
        for (let iy = -10; iy <= 10; iy ++) {
            for (let ix = -10; ix <= 10; ix ++) {
                this.current_plant = chunk.addDefaultPlant(
                    new THREE.Vector3(ix * 3, iy * 3, 20));
            }
        }
    }

    self.addEventListener('message', ev => {
        const msgType = ev.data.type;
        const payload = ev.data.data;

        try {
            if (msgType === 'step-req') {
                let sim_stat = chunk.step();
                self.postMessage({
                    type: 'step-resp',
                    data: sim_stat
                });
            } else if (msgType === 'kill-plant-req') {
                chunk.killPlant(payload.id);
            } else if (msgType === 'serialize-req') {
                self.postMessage({
                    type: 'serialize-resp',
                    data: chunk.serialize()
                });
            } else if (msgType === 'inspect-plant-req') {
                self.postMessage({
                    type: 'inspect-plant-resp',
                    data: {
                        id: payload.id,
                        stat: chunk.getPlantStat(payload.id)
                    }
                });
            } else {
                console.warn('unknown message type', msgType);
            }
        } catch (e) {
            console.trace(e);
        }
    });

    self.postMessage({type: 'init-complete-event'});
};

Ammo().then(Ammo => {
    startChunkWorker(Ammo);
});
