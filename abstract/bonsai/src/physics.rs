use std::collections::HashSet;
use ndarray::prelude::*;

#[derive(Debug, Copy, Clone, PartialEq)]
pub struct V3(pub f64, pub f64, pub f64);

#[derive(Debug, Hash, Eq, PartialEq, Copy, Clone)]
pub struct I3(pub i16, pub i16, pub i16);

// TODO: Hide this
#[inline]
pub fn floor(&V3(x, y, z) : &V3) -> I3 {
    I3(x.floor() as i16, y.floor() as i16, z.floor() as i16)
}
pub struct Cell {
    pub id: u64,

    pub p: V3,
    pub pi: I3,
    pub dp: V3,

    pub epsilon: u8,
    pub decay: u8,

    pub prog: [u8; 256],
    pub regs: [u8; 4],
    pub ip: u8,
    pub ext: bool,
    pub result: bool,
}

// Cell.pi in [0, HSIZE)^2 * [0, VSIZE)
// Anything that touches the boundary will be erased.

pub const HSIZE: usize = 200;
pub const VSIZE: usize = 100;

pub const BLOCKS_SHAPE: [usize; 3] = [HSIZE, HSIZE, VSIZE];

#[derive(Copy, Clone, PartialEq)]
pub enum Block {
    // Exclusion. Block light.
    Bedrock,
    // Sticking force toward block center. Block light.
    Soil,
    // Pass light.
    Water,
    // Weak global flow force.
    Air
}

pub struct World {
    pub steps: u64,

    next_id: u64,
    pub cells: Vec<Cell>,

    pub blocks: Array3<Block>,
    bedrocks: HashSet<I3>,
}


/*
Operations:
0xxx xxxx: 128
    000x xxdd: 32
        divide E
        check E
        share-ε {pull, push} Dd-t
        force {-, +} Dd-t
        fuse Dd-t
        // rsv
    001x xxxx: 32
        0010 0xxx: 8
            drain
            clone
            reduce
            flip (result = !result)
            get-α
            get-φ
            // rsv * 2
        001x xcdd: 24 (xx = 01, 10, 11)
            jmpa C, Dd (eip := Dd)
            jmpr C, Dd (eip := eip + Dd)
            jmpc C, Dd  (eip := i s.t. M[i] = Dd)
    01ii iidd: 64
        movi Dd, I
1xxx xxxx: 128
    1000 xxdd: 16
        inspect Dd
        not Dd
        swap Dd
        // rsv
    1xxx ssdd: 112 (xxx = 001, 010, 011, 100, 101, 110, 111)
        and Ds, Dd  (Dd &=Ds)
        or Ds, Dd (Dd |= Ds)
        add Ds, Dd (Dd += Ds)
        mov Ds, Dd (Dd = Ds)

        st Ds, Dd-a
        ld Ds-a, Dd

        nearby E, Dd
*/

fn step_code(c: &mut Cell){
    if c.epsilon == 0 {
        c.decay += 1;
        if c.decay == 0xff {
            // Delete cell.
        }
        return;
    }
    // Execute the instruction.
    c.decay = 0;
    c.epsilon -= if c.ext {2} else {1};

    let inst = c.prog[c.ip as usize];
    let dst = (inst & 3) as usize;
    let src = ((inst >> 2) & 3) as usize;

    if inst < 0x04 {
        // divide
    } else if inst < 0x08 {
        // check
    } else if inst < 0x0c {
        // share * 2
    } else if inst < 0x14 {
        // force * 2
    } else if inst < 0x1c {
        // fuse
        c.ext = true;
    } else if inst < 0x20 {
        // RESERVED.
    } else if inst < 0x21 {
        c.epsilon = 0;
    } else if inst < 0x22 {
        for i in 0..128 {
            c.prog[i+128] = c.prog[i];
        }
        c.ext = true;
    } else if inst < 0x23 {
        for i in 128..256 {
            c.prog[i] = 0;
        }
        c.ext = false;
    } else if inst < 0x24 {
        c.result = !c.result;
    } else if inst < 0x25 {
        // get-alpha
    } else if inst < 0x26 {
        // get-phi
    } else if inst < 0x20 {
        // RESERVED
    } else if inst < 0x30 {
        if src & 1 == 0 || c.result {
            c.ip = c.regs[dst];
            return;
        }
    } else if inst < 0x3f {
        if src & 1 == 0 || c.result {
            c.ip += c.regs[dst];
            return;
        }
    } else if inst < 0x40 {
        if src & 1 == 0 || c.result {
            for i in 1..128 {
                let addr = (c.ip + i) & 0x7f;
                if c.prog[addr as usize] == c.regs[dst] {
                    c.ip = addr;
                    c.result = true;
                    return;
                }
            }
            c.result = false;
            return;
        }
    } else if inst < 0x80 {
        c.regs[dst] = (inst >> 2) & 0xf;
    // Upper half: [0x80, 0xff]
    } else if inst < 0x84 {
        c.regs[dst] = c.epsilon;
    } else if inst < 0x88 {
        c.regs[dst] = !c.regs[dst];
    } else if inst < 0x8c {
        let v = c.regs[dst];
        c.regs[dst] = (v << 4) | (v >> 4);
    } else if inst < 0x90 {
        // RESERVED.
    } else if inst < 0xa0 {
        c.regs[dst] &= c.regs[src];
    } else if inst < 0xb0 {
        c.regs[dst] |= c.regs[src];
    } else if inst < 0xc0 {
        let sum = (c.regs[dst] as u16) + (c.regs[src] as u16);
        c.regs[dst] = (sum & 0xff) as u8;
        c.result = sum & 0x100 > 0;
    } else if inst < 0xd0 {
        c.regs[dst] = c.regs[src];
    } else if inst < 0xe0 {
        let addr = if c.ext {c.regs[dst]} else {c.regs[dst] & 0x7f};
        c.prog[addr as usize] = c.regs[src];
    } else if inst < 0xf0 {
        let addr = if c.ext {c.regs[src]} else {c.regs[src] & 0x7f};
        c.regs[dst] = c.prog[addr as usize];
    } else {
        // Nearby
    }
    c.ip += 1;
    c.ip &= 0x7f;
}

pub fn empty_world() -> World {
    return World {
        steps: 0,

        next_id: 0,
        cells: vec![],

        blocks: Array::from_elem(BLOCKS_SHAPE, Block::Air),
        bedrocks: HashSet::new(),
    };
}

impl World {
    pub fn init(&mut self) {
        for ((x, y, z), b) in self.blocks.indexed_iter() {
            match b.clone() {
                Block::Bedrock => {
                    self.bedrocks.insert(I3(x as i16, y as i16, z as i16));
                },
                _ => {},
            }
        }
    }

    pub fn step(&mut self) {
        let gravity = 0.01;
        let dissipation = 0.9;

        let mut occupation = self.bedrocks.clone();

        // Biochem & Kinetic.
        for cell in &self.cells {
            occupation.insert(cell.pi.clone());
        }
        for cell in &mut self.cells {
            step_code(cell);

            cell.dp.2 -= gravity;

            // dissipation
            cell.dp.0 *= dissipation;
            cell.dp.1 *= dissipation;
            cell.dp.2 *= dissipation;

            // Inertia.
            // TODO: Experiment w/ explicit stopoed-moving st. mgmt.
            cell.p.0 += cell.dp.0;
            cell.p.1 += cell.dp.1;
            cell.p.2 += cell.dp.2;

            // Exclusion.
            let edge = 0.999;
            let pi_curr = cell.pi;
            let pi_next = floor(&cell.p);
            if occupation.contains(&pi_next) {
                if pi_next.0 != cell.pi.0 {
                    let pi_candidate = I3(pi_next.0, cell.pi.1, cell.pi.2);
                    if occupation.contains(&pi_candidate) {
                        if pi_next.0 < cell.pi.0 {
                            cell.p.0 = cell.pi.0 as f64 + 0.0;
                        } else {
                            cell.p.0 = cell.pi.0 as f64 + edge;
                        }
                        cell.dp.0 = 0.0;
                    } else {
                        cell.pi.0 = pi_next.0;
                    }
                }
                if pi_next.1 != cell.pi.1 {
                    let pi_candidate = I3(cell.pi.0, pi_next.1, cell.pi.2);
                    if occupation.contains(&pi_candidate) {
                        if pi_next.1 < cell.pi.1 {
                            cell.p.1 = cell.pi.1 as f64 + 0.0;
                        } else {
                            cell.p.1 = cell.pi.1 as f64 + edge;
                        }
                        cell.dp.1 = 0.0;
                    } else {
                        cell.pi.1 = pi_next.1;
                    }
                }
                if pi_next.2 != cell.pi.2 {
                    let pi_candidate = I3(cell.pi.0, cell.pi.1, pi_next.2);
                    if occupation.contains(&pi_candidate) {
                        if pi_next.2 < cell.pi.2 {
                            cell.p.2 = cell.pi.2 as f64 + 0.0;
                        } else {
                            cell.p.2 = cell.pi.2 as f64 + edge;
                        }
                        cell.dp.2 = 0.0;
                    } else {
                        cell.pi.2 = pi_next.2;
                    }
                }
            } else {
                cell.pi = pi_next;
            }
            if cell.pi != pi_curr {
                occupation.insert(cell.pi);
                occupation.remove(&pi_curr);
            }
        }
        self.cells.retain(|cell| cell.p.2 >= 0.0);

        // Light transport.

        self.steps += 1;
    }

    pub fn issue_id(&mut self) -> u64 {
        let id = self.next_id;
        self.next_id += 1;
        return id;
    }

    pub fn validate(&self) {
        // World size.
        assert_eq!(self.blocks.shape(), BLOCKS_SHAPE);

        // Id check.
        let mut ids = HashSet::new();
        for cell in &self.cells {
            assert!(cell.id < self.next_id); // Id issuing uniqueness.
            assert!(!ids.contains(&cell.id)); // No dupe.
            ids.insert(cell.id);
        }

        // Cell internal consistency & finiteness.
        for cell in &self.cells {
            assert!(cell.p.0.is_finite());
            assert!(cell.p.1.is_finite());
            assert!(cell.p.2.is_finite());
            assert!(cell.dp.0.is_finite());
            assert!(cell.dp.1.is_finite());
            assert!(cell.dp.2.is_finite());
            assert_eq!(floor(&cell.p), cell.pi);
            assert!(cell.p.0 < 500.0);
            assert!(cell.p.1 < 500.0);
            assert!(cell.p.2 < 500.0);
        }

        // Mutual exclusion (Bedrock & cells).
        let mut occupation = HashSet::new();
        for (ix, b) in self.blocks.indexed_iter() {
            match b.clone() {
                Block::Bedrock => {occupation.insert(ix.clone());},
                _ => {},
            }
        }
        for cell in &self.cells {
            let ix = (cell.pi.0 as usize, cell.pi.1 as usize, cell.pi.2 as usize);
            assert!(!occupation.contains(&ix));
            occupation.insert(ix);
        }
    }
}
