(function () {

    // protein: carrier of information and matter.
    // Codon, amino acids: Roman character
    const Signal = {
        // b + photon -(c)-> a
        M_ACTIVE: 'a', // active material, red
        M_BASE: 'b', // base material (water), blue
        CHLOROPLAST: 'c', // photon receiver, green

        // Transcription modifiers
        // starts in lookup mode
        // l: switch mode := lookup
        // p: switch mode := produce
        // i: v := 1 - v
        //
        // others(x):
        //  lookup mode: v *= conc(x)
        //  produce mode: emit(x) with probability v
        INVERT: 'i',
        REMOVER: 'r',  // remove a signal
        MODE_LOOKUP: 'l',
        MODE_PRODUCE: 'p',

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
        constructor(genome) {
            this.genome = genome;
        }

        encode() {
            return this.genome;
        }

        static decode(e) {
            if (typeof e !== 'string') {
                throw 'GenomeFormatError:' + e;
            }
            return new Genome(e);
        }

        // Clone "naturally" with mutations.
        // Since real bio is too complex, use a simple rule that can
        // diffuse into all states.
        // return :: Genome
        naturalClone() {
            const genome = this._shuffle(
                Array.from(this.genome),
                sig => this._naturalCloneSignal(sig),
                sig => this._naturalCloneSignal(sig),
                () => this._randomSig());
            return new Genome(genome.join(''));
        }

        _naturalCloneSignal(sig) {
            if (Math.random() < 0.01) {
                return this._randomSig();
            } else {
                return sig;
            }
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
