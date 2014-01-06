(function() {

var Rotation = {
	CONICAL: 1,
	HALF_CONICAL: 2,
	FLIP : 3,
	TWIST: 4
};

Rotation.convertToSignalName = function(type) {
	if(type === Rotation.CONICAL) {
		return {long: "Conical", short: "Con"};
	} else if(type === Rotation.HALF_CONICAL) {
		return {long: "Conical/2", short: "Con/"};
	} else if(type === Rotation.FLIP) {
		return {long: "Flip", short: "Flp"};
	} else if(type === Rotation.TWIST) {
		return {long: "Twist", short: "Tw"};
	} else {
		return {long: "?", short: "?"};
	}
}

// protein: carrier of information and matter.
// Codon, amino acids: Roman character
var Signal = {
	// Intrinsic signals.
	GROWTH: 'g',

	// Transcription modifiers.
	HALF: 'p',
	INVERT: 'i',

	// Intrisinc functionals.
	CHLOROPLAST: 'chlr',
	G_DX: 'x',
	G_DY: 'y',
	G_DZ: 'z',
	DIFF: 'd', // comound: d12 (1:initial signal 2:locator)
	REMOVER: 'r',  // compound: r[1] ([1]: signal to be removed)

	// Positional modifiers.
	CONICAL: 'c',
	HALF_CONICAL: 'h',
	FLIP: 'f',
	TWIST: 't',

	// Cell types.
	LEAF: 'l',
	SHOOT: 's',
	SHOOT_END: 'a',
	FLOWER: 'w',

	// Compounds
	DIFF_SHM: 'dac',
	DIFF_SHS: 'dah',
	DIFF_LF: 'dlf',
};


var Differentiation = {
	SHOOT_MAIN: 1,
	SHOOT_SUB: 2,
	LEAF: 3,
};

Differentiation.convertToSignalName = function(type) {
	if(type === Differentiation.SHOOT_MAIN) {
		return {long: "DShootMain", short: "DShM"};
	} else if(type === Differentiation.SHOOT_SUB) {
		return {long: "DShootSub", short: "DShS"};
	} else if(type === Differentiation.LEAF) {
		return {long: "DLeaf", short: "DLf"};
	} else {
		return {long: "?", short: "?"};
	}
}

// This is an instance, not a class.
var CellType = {
	LEAF: 1,
	SHOOT: 2,
	SHOOT_END: 3,  // Corresponds to shoot apical meristem
	FLOWER: 4,  // self-pollinating, seed-dispersing

	// This is not cell type
	GROWTH_FACTOR: 5,
	ANTI_GROWTH_FACTOR: 6,
	HALF: 7
};

// return :: {long :: str, short :: str}
CellType.convertToSignalName = function(type) {
	var RvCT = {
		1: "Leaf",
		2: "Shoot",
		3: "ShootApex",
		4: "Flower",
		5: "Growth",
		6: "!Growth",
		7: "1/2",
	};

	var RvCTShort = {
		1: "Lf",
		2: "Sh",
		3: "ShAx",
		4: "Flr",
		5: "Gr",
		6: "!Gr",
		7: "/",
	};

	if(RvCT[type]) {
		return {
			long: RvCT[type],
			short: RvCTShort[type]
		};
	} else {
		return {
			long: "?",
			short: "?"
		};
	}
};

CellType.convertToKey = function(type) {
	if(type === CellType.LEAF) {
		return 'leaf';
	} else if(type === CellType.SHOOT) {
		return 'shoot';
	} else if(type === CellType.SHOOT_END) {
		return 'shoot_apex';
	} else if(type === CellType.FLOWER) {
		return 'flower';
	} else {
		return 'unknown';
	}
};

CellType.convertToColor = function(type) {
	if(type === CellType.LEAF) {
		return 'green';
	} else if(type === CellType.SHOOT) {
		return 'brown';
	} else if(type === CellType.SHOOT_END) {
		return 'brown';
	} else if(type === CellType.FLOWER) {
		return 'red';
	} else {
		return 'white';
	}
};

var Genome = function() {
	this.unity = [
		// Topological
		{
			"tracer_desc": "Diff: Produce leaf.",
			"when": [
				Signal.SHOOT_END, Signal.GROWTH, Signal.HALF, Signal.HALF, Signal.HALF
				],
			"emit": [
				Signal.SHOOT, Signal.DIFF_SHM, Signal.DIFF_LF,
				Signal.REMOVER + Signal.SHOOT_END
				]
		},
		{
			"tracer_desc": "Diff: Produce branch.",
			"when": [
				Signal.SHOOT_END, Signal.GROWTH, Signal.HALF, Signal.HALF],
			"emit": [
				Signal.SHOOT, Signal.DIFF_SHM, Signal.DIFF_SHS,
				Signal.REMOVER + Signal.SHOOT_END
				]
		},
		{
			"tracer_desc": "Diff: Produce flower.",
			"when": [
				Signal.SHOOT_END, Signal.INVERT + Signal.GROWTH, Signal.HALF, Signal.HALF],
			"emit": [
				Signal.FLOWER,
				Signal.REMOVER + Signal.SHOOT_END]
		},
		// Growth
		{
			"tracer_desc": "Flower growth.",
			"when": [
				Signal.FLOWER, Signal.HALF, Signal.HALF],
			"emit": [
				Signal.G_DX, Signal.G_DY, Signal.G_DZ]
		},
		{
			"tracer_desc": "Leaf elongation.",
			"when": [
				Signal.LEAF],
			"emit": [
				Signal.G_DZ],
		},
		{
			"tracer_desc": "Leaf shape adjustment.",
			"when": [
				Signal.LEAF, Signal.HALF, Signal.HALF, Signal.HALF, Signal.HALF],
			"emit": [
				Signal.G_DX, Signal.G_DX, Signal.G_DX, Signal.G_DX, Signal.G_DX, Signal.G_DX, Signal.G_DY]
		},
		{
			"tracer_desc": "Shoot (end) elongation.",
			"when": [
				Signal.SHOOT],
			"emit": [Signal.G_DZ]
		},
		{
			"tracer_desc": "Shoot thickening.",
			"when": [
				Signal.SHOOT_END, Signal.HALF, Signal.HALF, Signal.HALF],
			"emit": [Signal.G_DX, Signal.G_DY]
		},
		{
			"tracer_desc": "Chloroplast generation.",
			"when": [
				Signal.LEAF, Signal.HALF, Signal.HALF, Signal.HALF],
			"emit": [
				Signal.CHLOROPLAST]
		}
	];
};

// Clone "naturally" with mutations.
// Since real bio is too complex, use a simple rule that can
// diffuse into all states.
// return :: Genome
Genome.prototype.naturalClone = function() {
	var _this = this;

	var genome = new Genome();
	genome.unity = this._shuffle(this.unity,
		function(gene) {
			return _this._naturalCloneGene(gene, '');
		},
		function(gene) {
			return _this._naturalCloneGene(gene, '/Duplicated/');
		});

	return genome;
};

// flag :: A text to attach to description tracer.
// return :: Genome.gene
Genome.prototype._naturalCloneGene = function(gene_old, flag) {
	var _this = this;

	var gene = {};
	
	gene["when"] = this._shuffle(gene_old["when"],
		function(sig) { return _this._naturalCloneSignal(sig); },
		function(sig) { return _this._naturalCloneSignal(sig); });
	gene["emit"] = this._shuffle(gene_old["emit"],
		function(sig) { return _this._naturalCloneSignal(sig); },
		function(sig) { return _this._naturalCloneSignal(sig); });

	gene["tracer_desc"] = flag + gene_old["tracer_desc"];
	return gene;
};


Genome.prototype._naturalCloneSignal = function(sig) {
	function random_sig1() {
		var set = 'abcdefghijklmnopqrstuvwxyz';
		return set[Math.floor(Math.random() * set.length)];
	}

	if(Math.random() > 0.01) {
		return sig;
	} else {
		var sig = '';
		do {
			sig += random_sig1();
		} while(Math.random() < 0.1);

		return sig;
	}
};

Genome.prototype._shuffle = function(array, modifier_normal, modifier_dup) {
	var result = [];

	// 1st pass: Copy with occasional misses.
	_.each(array, function(elem) {
		if(Math.random() > 0.01) {
			result.push(modifier_normal(elem));
		}
	});

	// 2nd pass: Occasional duplications.
	_.each(array, function(elem) {
		if(Math.random() < 0.01) {
			result.push(modifier_dup(elem));
		}
	});

	return result;
};

// xs :: [num]
// return :: num
function sum(xs) {
	return _.reduce(xs, function(x, y) {
		return x + y;
	}, 0);
}

this.CellType = CellType;
this.Rotation = Rotation;
this.Differentiation = Differentiation;
this.Genome = Genome;
this.Signal = Signal;

})(this);