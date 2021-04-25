(function () {

    // protein: carrier of information and matter.
    // Codon, amino acids: Roman character
    const Signal = {
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
        DIFF: 'd', // compound: d12 (1:initial signal 2:locator)
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

    function parseIntrinsicSignal(sig) {
        let inv_table = {};
        for (const [name, signal] of Object.entries(Signal)) {
            inv_table[signal] = name;
        }

        let signals_simple = [
            Signal.GROWTH,
            Signal.HALF, Signal.CHLOROPLAST,
            Signal.G_DX, Signal.G_DY, Signal.G_DZ];

        let signals_standard = [
            Signal.LEAF,
            Signal.SHOOT, Signal.SHOOT_END, Signal.FLOWER];

        if (signals_simple.includes(sig)) {
            return {
                long: inv_table[sig],
                raw: sig,
                type: 'intrinsic'
            };
        } else if (signals_standard.includes(sig)) {
            return {
                long: inv_table[sig],
                raw: sig,
                type: 'standard'
            };
        } else if (sig[0] === Signal.DIFF) {
            if (sig.length === 3) {
                return {
                    long: 'DIFF(' + sig[1] + ',' + sig[2] + ')',
                    raw: sig,
                    type: 'compound'
                };
            } else {
                return {
                    long: 'DIFF(?)',
                    raw: sig,
                    type: 'unknown'
                };
            }
        } else if (sig[0] === Signal.INVERT) {
            if (sig.length >= 2) {
                return {
                    long: '!' + sig.substr(1),
                    raw: sig,
                    type: 'compound'
                };
            } else {
                return {
                    long: '!',
                    raw: sig,
                    type: 'unknown'
                };
            }
        } else if (sig[0] === Signal.REMOVER) {
            if (sig.length >= 2) {
                return {
                    long: 'DEL(' + sig.substr(1) + ')',
                    raw: sig,
                    type: 'compound'
                };
            } else {
                return {
                    long: 'DEL',
                    raw: sig,
                    type: 'unknown'
                };
            }
        } else {
            return {
                long: '',
                raw: sig,
                type: 'unknown'
            };
        }
    }

    class Genome {
        constructor(genes) {
            this.genes = genes;
        }

        encode() {
            return this.genes.map(gene => gene.when.join(',') + '>' + gene.emit.join(',')).join('|');
        }

        static decode(e) {
            if (typeof e !== 'string') {
                throw 'GenomeFormatError:' + e;
            }
            const geneListE = e.split('|');
            if (e.length === 0) {
                throw 'GenomeFormatError: no gene: ' + e;
            }
            return new Genome(geneListE.map(geneEnc => {
                const geneElemList = geneEnc.split('>');
                const [whenEnc, emitEnc] = geneElemList;
                return {
                    'when': whenEnc.split(','),
                    'emit': emitEnc.split(','),
                };
            }));
        }

        // Clone "naturally" with mutations.
        // Since real bio is too complex, use a simple rule that can
        // diffuse into all states.
        // return :: Genome
        naturalClone() {
            let _this = this;

            let genome = new Genome();
            genome.genes = this._shuffle(this.genes,
                function (gene) {
                    return _this._naturalCloneGene(gene, '');
                },
                function (gene) {
                    return _this._naturalCloneGene(gene, '/Duplicated/');
                });

            return genome;
        }

        // flag :: A text to attach to description tracer.
        // return :: Genome.gene
        _naturalCloneGene(gene_old, flag) {
            let _this = this;

            let gene = {};

            gene["when"] = this._shuffle(gene_old["when"],
                function (sig) { return _this._naturalCloneSignal(sig); },
                function (sig) { return _this._naturalCloneSignal(sig); });
            gene["emit"] = this._shuffle(gene_old["emit"],
                function (sig) { return _this._naturalCloneSignal(sig); },
                function (sig) { return _this._naturalCloneSignal(sig); });

            gene["tracer_desc"] = flag + gene_old["tracer_desc"];
            return gene;
        }

        _naturalCloneSignal(sig) {
            function random_sig1() {
                let set = 'abcdefghijklmnopqrstuvwxyz';
                return set[Math.floor(Math.random() * set.length)];
            }

            let new_sig = '';
            for (let i = 0; i < sig.length; i++) {
                if (Math.random() > 0.01) {
                    new_sig += sig[i];
                }
                if (Math.random() < 0.01) {
                    new_sig += random_sig1();
                }
            }
            return new_sig;
        }

        _shuffle(array, modifier_normal, modifier_dup) {
            let result = [];

            // 1st pass: Copy with occasional misses.
            array.forEach(elem => {
                if (Math.random() > 0.01) {
                    result.push(modifier_normal(elem));
                }
            });

            // 2nd pass: Occasional duplications.
            array.forEach(elem => {
                if (Math.random() < 0.01) {
                    result.push(modifier_dup(elem));
                }
            });

            return result;
        }
    }

    this.Genome = Genome;
    this.parseIntrinsicSignal = parseIntrinsicSignal;
    this.Signal = Signal;

})(this);
