use physics;

use std::ops;
use std::fmt;
use rand;
use rand::Rng;
use rand::distributions::{IndependentSample, Range};
use physics::Block;

#[derive(Clone, Copy, Debug)]
pub enum WorldSpec {
    TestCellLoad(i32),
    TestFlatBedrock,
    // No-water
    Valley,
    FloatingIslands,
    // Waterful
    Creek,
}

struct Arr2<T>{n0: usize, n1: usize, data: Vec<T>}

impl<T> ops::Index<(usize, usize)> for Arr2<T> {
    type Output = T;
    fn index(&self, (i0, i1): (usize, usize)) -> &T {
        return &self.data[i0 + self.n0 * i1];
    }
}

impl<T> ops::IndexMut<(usize, usize)> for Arr2<T> {
    fn index_mut(&mut self, (i0, i1): (usize, usize)) -> &mut T {
        return &mut self.data[i0 + self.n0 * i1];
    }
}

fn fill<T: Clone>(c: T, n0: usize, n1: usize) -> Arr2<T> {
    return Arr2{n0: n0, n1: n1, data: vec![c; n0 * n1]};
}

// returns [s*s] array of
// Expected value of each cell is 0.
fn land_base<R: Rng>(rng: &mut R) -> Arr2<f32> {
    let mut arr = fill(0.0, physics::HSIZE, physics::HSIZE);
    let vr = Range::new(-1.0, 1.0 as f32);
    for y in 0..physics::HSIZE {
        for x in 0..physics::HSIZE {
            arr[(x, y)] = vr.ind_sample(rng);
        }
    }
    return arr;
}

pub fn create_world(spec: WorldSpec) -> physics::World {
    let mut rng = rand::thread_rng();
    let mut w = physics::empty_world();

    match spec {
        WorldSpec::Valley => {
            // TODO: // Coarse "mountain" mask
            let land_base = land_base(&mut rng);

            // convert to soil
            for y in 0..physics::HSIZE as i16 {
                for x in 0..physics::HSIZE as i16 {
                    let h = land_base[(x as usize, y as usize)] * 100.0 + 100.0;
                    for z in 0..physics::VSIZE as i16 {
                        let i = physics::I3{x:x,y:y,z:z};
                        if z == 0 {
                            w.set_block(i, Block::Bedrock);
                        } else if (z as f32) < h {
                            w.set_block(i, Block::Soil);
                        } else {
                            w.set_block(i, Block::Air);
                        }
                    }
                }
            }

            // TODO:
            // Put random big rocks near surface.
            // Put small rocks under surface.
        },
        WorldSpec::TestCellLoad(num_cells) => {
            for _ in 0..num_cells {
                let hrange = Range::new(0.0, physics::HSIZE as f64);
                let vrange = Range::new(0.0, physics::VSIZE as f64);
                let p = physics::V3{x:hrange.ind_sample(&mut rng), y: hrange.ind_sample(&mut rng), z: vrange.ind_sample(&mut rng)};
                let inst_range = Range::new(0, 255);

                let mut prog = [0; 256];
                for i in 0..128 {
                    prog[i] = inst_range.ind_sample(&mut rng);
                }

                let id = w.issue_id();
                w.cells.push(physics::Cell{
                    id: id,
                    p: p,
                    pi: physics::floor(&p),
                    dp: physics::V3{x:0.0, y:0.0, z:0.0},
                    ip: 0,
                    ext: false,
                    result: false,
                    epsilon: 0xff,
                    decay: 0,
                    prog: prog,
                    regs: [0; 4],
                });
            }
        },
        _ => {
            for z in 0..physics::VSIZE as i16 {
                for y in 0..physics::HSIZE as i16 {
                    for x in 0..physics::HSIZE as i16 {
                        let b = if z == 0 {
                            Block::Bedrock
                        } else {
                            Block::Air
                        };
                        w.set_block(physics::I3{x:x,y:y,z:z}, b);
                    }
                }
            }

            for _ in 0..100*1000 {
                let hrange = Range::new(0.0, physics::HSIZE as f64);
                let vrange = Range::new(1.0, physics::VSIZE as f64);
                let p = physics::V3{x:hrange.ind_sample(&mut rng), y: hrange.ind_sample(&mut rng), z: vrange.ind_sample(&mut rng)};
                let inst_range = Range::new(0, 255);

                let mut prog = [0; 256];
                for i in 0..128 {
                    prog[i] = inst_range.ind_sample(&mut rng);
                }

                let id = w.issue_id();
                w.cells.push(physics::Cell{
                    id: id,
                    p: p,
                    pi: physics::floor(&p),
                    dp: physics::V3{x:0.0, y:0.0, z:0.0},
                    ip: 0,
                    ext: false,
                    result: false,
                    epsilon: 0xff,
                    decay: 0,
                    prog: prog,
                    regs: [0; 4],
                });
            }
        },
    }
    return w;
}
