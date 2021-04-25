(function () {

    // protein: carrier of information and matter.
    // Codon, amino acids: Roman character
    const Signal = {
        // Transcription modifiers.
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
        SHOOT_END: 'a',
        FLOWER: 'w',

        // Compounds
        DIFF_SHM: 'dac',
        DIFF_SHS: 'dah',
        DIFF_LF: 'dlf',
    };

    function parseIntrinsicSignal(sig) {
        const invTable = {};
        for (const [name, signal] of Object.entries(Signal)) {
            invTable[signal] = name;
        }

        const signalsSimple = [
            Signal.HALF, Signal.CHLOROPLAST,
            Signal.G_DX, Signal.G_DY, Signal.G_DZ];

        const signalsStandard = [
            Signal.SHOOT_END, Signal.FLOWER];

        if (signalsSimple.includes(sig)) {
            return {
                long: invTable[sig],
                raw: sig,
                type: 'intrinsic'
            };
        } else if (signalsStandard.includes(sig)) {
            return {
                long: invTable[sig],
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
            const genes = this._shuffle(
                this.genes,
                gene => this._naturalCloneGene(gene),
                gene => this._naturalCloneGene(gene));
            return new Genome(genes);
        }

        /**
         * @param {Gene} geneOld 
         * @returns {Gene}
         */
        _naturalCloneGene(geneOld) {
            const gene = {};
            gene["when"] = this._shuffle(
                geneOld["when"],
                sig => this._naturalCloneSignal(sig),
                sig => this._naturalCloneSignal(sig)).filter(s => s !== '');
            gene["emit"] = this._shuffle(
                geneOld["emit"],
                sig => this._naturalCloneSignal(sig),
                sig => this._naturalCloneSignal(sig)).filter(s => s !== '');
            return gene;
        }

        _naturalCloneSignal(sig) {
            function randomSig1() {
                let set = 'abcdefghijklmnopqrstuvwxyz';
                return set[Math.floor(Math.random() * set.length)];
            }

            let newSig = '';
            for (let i = 0; i < sig.length; i++) {
                if (Math.random() > 0.01) {
                    newSig += sig[i];
                }
                if (Math.random() < 0.01) {
                    newSig += randomSig1();
                }
            }
            return newSig;
        }

        _shuffle(array, modifierNormal, modifierDup) {
            const result = [];

            // 1st pass: Copy with occasional misses.
            array.forEach(elem => {
                if (Math.random() > 0.01) {
                    result.push(modifierNormal(elem));
                }
            });

            // 2nd pass: Occasional duplications.
            array.forEach(elem => {
                if (Math.random() < 0.01) {
                    result.push(modifierDup(elem));
                }
            });
            return result;
        }
    }

    this.Genome = Genome;
    this.parseIntrinsicSignal = parseIntrinsicSignal;
    this.Signal = Signal;

})(this);
