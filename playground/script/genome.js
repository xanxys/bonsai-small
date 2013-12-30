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
	this.continuous = [
		{
			when: CellType.FLOWER,
			mx: 100,
			my: 100,
			mz: 50,
			dx: 1,
			dy: 1,
			dz: 1
		},
		{
			when: CellType.LEAF,
			mx: 150,
			my: 20,
			mz: 400,
			dx: 5,
			dy: 1,
			dz: 20
		},
		{
			when: CellType.SHOOT,
			mx: 50,
			my: 50,
			mz: 500,
			dx: "Gr",
			dy: "Gr",
			dz: "Gr30",
		},
		{
			when: CellType.SHOOT_END,
			mx: 50,
			my: 50,
			mz: 500,
			dx: "Gr",
			dy: "Gr",
			dz: "Gr30",
		}
	];

	this.positional = [
		{
			tracer_desc: "Branch tilting.",
			when: Differentiation.SHOOT_MAIN,
			produce: CellType.SHOOT_END,
			rot: Rotation.CONICAL
		},
		{
			tracer_desc: "Main shoot.",
			when: Differentiation.SHOOT_SUB,
			produce: CellType.SHOOT_END,
			rot: Rotation.HALF_CONICAL
		},
		{
			tracer_desc: "Leaf direction.",
			when: Differentiation.LEAF,
			produce: CellType.LEAF,
			rot: Rotation.FLIP
		}
	];

	
	this.discrete = [
		{
			"tracer_desc": "Produce leaf.",
			"when": [
				CellType.SHOOT_END, CellType.GROWTH_FACTOR, CellType.HALF, CellType.HALF, CellType.HALF],
			"become": CellType.SHOOT,
			"produce": [
				Differentiation.SHOOT_MAIN,
				Differentiation.LEAF,
			]
		},
		{
			"tracer_desc": "Produce branch.",
			"when": [
				CellType.SHOOT_END, CellType.GROWTH_FACTOR, CellType.HALF, CellType.HALF],
			"become": CellType.SHOOT,
			"produce": [
				Differentiation.SHOOT_MAIN,
				Differentiation.SHOOT_SUB,
			],
		},
		{
			"tracer_desc": "Stop growing and change to flower.",
			"become": CellType.FLOWER,
			"when": [
				CellType.SHOOT_END, CellType.ANTI_GROWTH_FACTOR, CellType.HALF, CellType.HALF],
			"produce": [],
		},
	];
};

// return :: int
Genome.prototype.getComplexity = function() {
	return sum(_.map(this.discrete, function(gene) {
		return 2 +  // "TATA box"
			gene["when"].length +
			1 +  // become
			gene["produce"].length;
	}));
};

// Clone "naturally" with mutations.
// Since real bio is too complex, use a simple rule that can
// diffuse into all states.
// return :: Genome
Genome.prototype.naturalClone = function() {
	var _this = this;

	var genome = new Genome();

	// TODO: mutate them
	genome.continuous = this.continuous;
	genome.positional = this._shuffle(this.positional,
		function(gene) {
			return _this._naturalClonePositionalGene(gene, '');
		},
		function(gene) {
			return _this._naturalClonePositionalGene(gene, '/Duplicated/');
		});

	genome.discrete = this._shuffle(this.discrete,
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
		function(ix) { return _this._naturalCloneId(ix); },
		function(ix) { return _this._naturalCloneId(ix); });
	gene["become"] = this._naturalCloneId(gene_old["become"]);
	gene["produce"] = this._shuffle(gene_old["produce"],
		function(ix_to) { return _this._naturalCloneId(ix_to); },
		function(ix_to) { return _this._naturalCloneId(ix_to); });

	gene["tracer_desc"] = flag + gene_old["tracer_desc"];
	return gene;
};

Genome.prototype._naturalClonePositionalGene = function(gene_old, flag) {
	var gene = {};

	gene["tracer_desc"] = flag + gene_old["tracer_desc"];
	gene["when"] = this._naturalCloneId(gene_old["when"]);
	gene["produce"] = this._naturalCloneId(gene_old["produce"]);
	gene["rot"] = this._naturalCloneId(gene_old["rot"]);

	return gene;	
};

Genome.prototype._naturalCloneId = function(id) {
	if(Math.random() > 0.01) {
		return id;
	} else {
		return Math.floor(Math.random() * 10);
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

})(this);