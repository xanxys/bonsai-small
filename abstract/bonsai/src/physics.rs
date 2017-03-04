use std::collections::HashSet;
use std::collections::HashMap;
use ndarray::prelude::*;
use std::cmp;

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

    pub wind: V3,
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

enum StateDelta {
    NoChange,
    KillSelf,
    AddCell(Cell),
    Assimilate(u64),
    Repul(u64, bool), // false: attract, true: push
    SendEps(u64, bool), // false: recv, true: send
    BlockLight,
}

fn scan_neighbor<R>(center: I3, pred: &Fn(I3, (usize, usize, usize)) -> Option<R>) -> Option<R> {
    let I3(ix, iy, iz) = center;
    'nsearch: for x in cmp::max(ix-1, 0)..cmp::min(ix+2, HSIZE as i16) {
        for y in cmp::max(iy-1, 0)..cmp::min(iy+2, HSIZE as i16) {
            for z in cmp::max(iz-1, 0)..cmp::min(iz+2, VSIZE as i16) {
                let i = I3(x, y, z);
                if i != center {
                    match pred(i, (x as usize, y as usize, z as usize)) {
                        Some(res) => {return Some(res)},
                        None => {},
                    }
                }
            }
        }
    }
    return None;
}

fn step_code(c: &mut Cell, occupation: &HashSet<I3>, blocks: &Array3<Block>, cell_tags: &HashMap<I3, (u8, u64)>) -> StateDelta {
    if c.epsilon == 0 {
        c.decay += 1;
        if c.decay == 0xff {
            return StateDelta::KillSelf;
        }
        return StateDelta::NoChange;
    }
    // Execute the instruction.
    c.decay = 0;
    c.epsilon -= if c.ext {2} else {1};

    let inst = c.prog[c.ip as usize];
    let dst = (inst & 3) as usize;
    let src = ((inst >> 2) & 3) as usize;

    let btypes = [Block::Bedrock, Block::Soil, Block::Water, Block::Air];

    let cpi = c.pi.clone();
    let scan_by_tag = |target_tag: u8| {
        scan_neighbor(cpi, &|i3, _| {
            match cell_tags.get(&i3) {
                Some(&(tag, id)) => {
                    if target_tag == tag {
                        return Some(id);
                    }
                }
                None => {},
            }
            return None;
        })
    };

    let mut st_delta = StateDelta::NoChange;
    if inst < 0x04 { // divide
        let btarget = btypes[dst];

        let mut target = None;
        if c.ext && btarget != Block::Bedrock {
            target = scan_neighbor(c.pi, &|i3, ius| {
                if blocks[ius] == btarget && !occupation.contains(&i3) {
                    return Some(i3);
                } else {
                    return None;
                }
            });
        }

        match target {
            Some(i) => {
                let I3(x,y,z) = i;
                let p = V3(x as f64 + 0.5, y as f64 + 0.5, z as f64 + 0.5);
                let eps_remain = c.epsilon / 2;
                let eps_new_cell = c.epsilon - eps_remain;

                let mut new_cell = Cell{
                    id: 0,

                    p: p,
                    pi: i,
                    dp: c.dp,

                    epsilon: eps_new_cell,
                    decay:0,
                    prog: [0; 256],
                    regs: [0; 4],

                    ip: 0,
                    ext: false,
                    result: false,
                };
                new_cell.prog[..128].copy_from_slice(&c.prog[128..]);
                for i in 128..256 {
                    c.prog[i] = 0;
                }
                st_delta = StateDelta::AddCell(new_cell);
                c.result = true;
            },
            None => {
                c.result = false;
            }
        }
        c.ext = false;
    } else if inst < 0x08 { // check
        // check environment of the block containing this cell.
        let I3(x, y, z) = c.pi;
        c.result = btypes[dst] == blocks[(x as usize, y as usize, z as usize)];
    } else if inst < 0x0c { // share * 2
        c.result = false;
        match scan_by_tag(c.regs[dst]) {
            Some(id) => {
                st_delta = StateDelta::SendEps(id, src & 1 == 0);
                c.result = true;
            },
            None => {},
        }
    } else if inst < 0x14 { // force * 2
        c.result = false;
        match scan_by_tag(c.regs[dst]) {
            Some(id) => {
                st_delta = StateDelta::Repul(id, src & 1 == 0);
                c.result = true;
            },
            None => {},
        }
    } else if inst < 0x1c { // fuse
        // Find nearby cell with specified tag & assimilate its energy and prog.
        match scan_by_tag(c.regs[dst]) {
            Some(id) => {
                st_delta = StateDelta::Assimilate(id);
                c.ext = true;
                c.result = true;
            },
            None => {
                c.result = false;
            }
        }
    } else if inst < 0x20 { // RESERVED.
    } else if inst < 0x21 { // drain
        c.epsilon = 0;
    } else if inst < 0x22 { // clone
        for i in 0..128 {
            c.prog[i+128] = c.prog[i];
        }
        c.ext = true;
    } else if inst < 0x23 { // reduce
        for i in 128..256 {
            c.prog[i] = 0;
        }
        c.ext = false;
    } else if inst < 0x24 { // flip
        c.result = !c.result;
    } else if inst < 0x25 { // get-alpha
        let I3(x, y, z) = c.pi;
        if blocks[(x as usize, y as usize, z as usize)] == Block::Water {
            c.epsilon = c.epsilon.saturating_add(16);
            c.result = true;
        } else {
            c.result = false;
        }
    } else if inst < 0x26 { // get-phi
        st_delta = StateDelta::BlockLight; // Get epsilon by converting env's phi.
    } else if inst < 0x20 { // RESERVED
    } else if inst < 0x30 { // jmpa
        if src & 1 == 0 || c.result {
            c.ip = c.regs[dst];
            return StateDelta::NoChange;
        }
    } else if inst < 0x3f { // jmpr
        if src & 1 == 0 || c.result {
            c.ip += c.regs[dst];
            return StateDelta::NoChange;
        }
    } else if inst < 0x40 { // jmpc
        if src & 1 == 0 || c.result {
            for i in 1..128 {
                let addr = (c.ip + i) & 0x7f;
                if c.prog[addr as usize] == c.regs[dst] {
                    c.ip = addr;
                    c.result = true;
                    return StateDelta::NoChange;
                }
            }
            c.result = false;
            return StateDelta::NoChange;
        }
    } else if inst < 0x80 { // movi
        c.regs[dst] = (inst >> 2) & 0xf;
    } else if inst < 0x84 { // inspect
        c.regs[dst] = c.epsilon;
    } else if inst < 0x88 { // not
        c.regs[dst] = !c.regs[dst];
    } else if inst < 0x8c { // swap
        let v = c.regs[dst];
        c.regs[dst] = (v << 4) | (v >> 4);
    } else if inst < 0x90 { // RESERVED.
    } else if inst < 0xa0 { // and
        c.regs[dst] &= c.regs[src];
    } else if inst < 0xb0 { // or
        c.regs[dst] |= c.regs[src];
    } else if inst < 0xc0 { // add
        let sum = (c.regs[dst] as u16) + (c.regs[src] as u16);
        c.regs[dst] = (sum & 0xff) as u8;
        c.result = sum & 0x100 > 0;
    } else if inst < 0xd0 { // mov
        c.regs[dst] = c.regs[src];
    } else if inst < 0xe0 { // st
        let addr = if c.ext {c.regs[dst]} else {c.regs[dst] & 0x7f};
        c.prog[addr as usize] = c.regs[src];
    } else if inst < 0xf0 { // ld
        let addr = if c.ext {c.regs[src]} else {c.regs[src] & 0x7f};
        c.regs[dst] = c.prog[addr as usize];
    } else { // nearby
        let target_env = btypes[src];
        let result_tag = scan_neighbor(c.pi, &|i3, ius| {
            if blocks[ius] == target_env {
                return None;
            }
            match cell_tags.get(&i3) {
                Some(&(tag, _)) => {return Some(tag);},
                None => {return None},
            }
        });
        match result_tag {
            Some(tag) => {
                c.regs[dst] = tag;
                c.result = true;
            },
            None => {
                c.result = false;
            }
        }
    }
    c.ip += 1;
    c.ip &= 0x7f;
    return st_delta;
}

pub fn empty_world() -> World {
    return World {
        steps: 0,

        next_id: 0,
        cells: vec![],

        blocks: Array::from_elem(BLOCKS_SHAPE, Block::Air),
        bedrocks: HashSet::new(),

        wind: V3(0.0, 0.0, 0.0),
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
        let stick = 0.02; // Stronger than gravity.

        let mut occupation = self.bedrocks.clone();

        // Biochem & Kinetic.
        for cell in &self.cells {
            occupation.insert(cell.pi.clone());
        }
        let mut new_cells = vec![];
        let mut del_cells = HashSet::new();
        let mut cells_tag = HashMap::new();
        for cell in &mut self.cells {
            let st_delta = step_code(cell, &occupation, &self.blocks, &cells_tag);
            match st_delta {
                StateDelta::NoChange => {},
                StateDelta::AddCell(mut cell) => {
                    new_cells.push(cell);
                },
                StateDelta::KillSelf => {
                    occupation.remove(&cell.pi);
                    cells_tag.remove(&cell.pi);
                    del_cells.insert(cell.id);
                    continue;
                },
                StateDelta::Assimilate(id) => {},
                StateDelta::BlockLight => {},
                StateDelta::Repul(id, dir) => {},
                StateDelta::SendEps(id, dir) => {},
            }

            cell.dp.2 -= gravity;

            let block = self.blocks[(cell.pi.0 as usize, cell.pi.1 as usize, cell.pi.2 as usize)];
            if block == Block::Soil {
                if cell.p.0.fract() < 0.5 {
                    cell.dp.0 += stick;
                } else {
                    cell.dp.0 -= stick;
                }
                if cell.p.1.fract() < 0.5 {
                    cell.dp.1 += stick;
                } else {
                    cell.dp.1 -= stick;
                }
                if cell.p.2.fract() < 0.5 {
                    cell.dp.2 += stick;
                } else {
                    cell.dp.2 -= stick;
                }
            }

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
        self.cells.retain(|cell| cell.p.2 >= 0.0 && !del_cells.contains(&cell.id));
        for mut cell in new_cells {
            cell.id = self.issue_id();
            // self.cells.push(cell);
        }

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
