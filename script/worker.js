importScripts('./three.js');
importScripts('./ammo.wasm.js');
importScripts('./worker_chunk.js');
importScripts('./genome.js');

function startChunkWorker(Ammo) {
    setChunkAmmo(Ammo);
    const chunk = new Chunk();

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
            } else if (msgType === 'add-plant-req') {
                chunk.addPlant(
                    new THREE.Vector3(payload.position.x, payload.position.y, payload.position.z),
                    Genome.decode(payload.encodedGenome));
            } else if (msgType === 'kill-plant-req') {
                chunk.removePlantById(payload.id);
            } else if (msgType === 'set-env-req') {
                chunk.setEnvironment(payload.light);
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
