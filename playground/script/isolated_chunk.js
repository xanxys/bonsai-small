importScripts('./underscore.js');
importScripts('./three.js');
importScripts('./chunk.js');

var ChunkServer = function() {
	var scene = new THREE.Scene();
	this.chunk = new Chunk(scene);

	this.current_plant = this.chunk.add_plant(
		new THREE.Vector3(0, 0, 0),
		Math.pow(20e-3, 3) * 100 // allow 2cm cube for 100T
	);

	var _this = this;
	self.addEventListener('message', function(ev) {
		if(ev.data.type === 'step') {
			_this.chunk.step();
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
		}
	});
};

new ChunkServer();
