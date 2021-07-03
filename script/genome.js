(function () {

    // protein: carrier of information and matter.
    // Codon, amino acids: Roman character
    const Signal = {
        // b + photon -(c)-> a
        M_ACTIVE: 'a', // active material, red
        M_BASE: 'b', // base material (water), blue
        CHLOROPLAST: 'c', // photon receiver, green

        // Transcription modifiers
        INVERT: 'i',
        REMOVER: 'r',  // remove a signal

        // Signal transporters
        TR_A_UP: 'f',
        TR_A_DOWN: 'g',
        TR_B_DOWN: 'h',

        // Cell replication modifiers
        CR_X: 's',
        CR_Z: 't',
        DIFF: 'd', // replicate cell

        // Cell growth modifiers
        G_DX: 'x',
        G_DY: 'y',
        G_DZ: 'z',
    };

    class Genome {
        constructor(genes) {
            this.genes = genes;
        }

        encode() {
            return this.genes.map(gene => gene.when.join('') + '>' + gene.emit.join('')).join('|');
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
                    'when': new Array(...whenEnc),
                    'emit': new Array(...emitEnc),
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
                gene => this._naturalCloneGene(gene),
                () => this._randomGene());
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
                sig => this._naturalCloneSignal(sig),
                () => this._randomSig());
            gene["emit"] = this._shuffle(
                geneOld["emit"],
                sig => this._naturalCloneSignal(sig),
                sig => this._naturalCloneSignal(sig),
                () => this._randomSig());
            return gene;
        }

        _naturalCloneSignal(sig) {
            if (Math.random() < 0.01) {
                return this._randomSig();
            } else {
                return sig;
            }
        }

        _randomGene() {
            return {
                'when': [],
                'emit': [this._randomSig()],
            };
        }

        _randomSig() {
            const set = 'abcdefghijklmnopqrstuvwxyz';
            return set[Math.floor(Math.random() * set.length)];
        }

        _shuffle(array, modifierNormal, modifierDup, modifierGen) {
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

            // 3rd pass: Occasional insertions.
            if (Math.random() > 0.01) {
                result.push(modifierGen());
            }

            return result;
        }
    }

    this.Genome = Genome;
    this.Signal = Signal;

})(this);
