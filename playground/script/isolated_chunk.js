importScripts('./underscore.js');
importScripts('./three.js');
importScripts('./chunk.js');

var ChunkServer = function() {
	var scene = new THREE.Scene();
	this.chunk = new Chunk(scene);

	this.current_plant =
		this.chunk.add_default_plant(new THREE.Vector3(0, 0, 0));

	var _this = this;
	self.addEventListener('message', function(ev) {
		if(ev.data.type === 'step') {
			var sim_stat = _this.chunk.step();
			self.postMessage({
				type: 'stat-sim',
				data: sim_stat
			});
		} else if(ev.data.type === 'serialize') {
			self.postMessage({
				type: 'serialize',
				data: _this.chunk.serialize()
			});
		} else if(ev.data.type === 'stat') {
			self.postMessage({
				type: 'stat-chunk',
				data: _this.chunk.get_stat()
			});
		} else if(ev.data.type === 'stat-plant') {
			self.postMessage({
				type: 'stat-plant',
				data: {
					id: ev.data.data.id,
					stat: _this.chunk.get_plant_stat(ev.data.data.id)
				}
			});
		} else if(ev.data.type === 'genome-plant') {
			self.postMessage({
				type: 'genome-plant',
				data: {
					id: ev.data.data.id,
					genome: _this.chunk.get_plant_genome(ev.data.data.id)
				}
			});
		}
	});
};

new ChunkServer();
