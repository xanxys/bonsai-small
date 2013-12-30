(function() {

var Differentiation = {
	SHOOT_MAIN: 1,
	SHOOT_SUB: 2,
	LEAF: 3,
};

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
this.Differentiation = Differentiation;
this.Genome = Genome;

})(this);