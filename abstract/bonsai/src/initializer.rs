use physics;

use rand;
use rand::Rng;
use rand::distributions::{IndependentSample, Range};
use physics::Block;
use ndarray::prelude::*;

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

// interp(x, y, 0)   = x
// interp(x, y, 0.5) = (x + y) / 2
// interp(x, y, 1)   = y
fn interp(x: f32, y: f32, t: f32) -> f32 {
    return x * (1.0 - t) + y * t;
}

// returns [s*s] array of
// Expected value of each cell is 0.
fn land_base<R: Rng>(rng: &mut R) -> Array2<f32> {
    let mut arr = Array::from_elem((physics::HSIZE, physics::HSIZE), 0.0);
    let vr = Range::new(-0.1, 0.1 as f32);
    for y in 0..physics::HSIZE {
        for x in 0..physics::HSIZE {
            arr[(x, y)] = vr.ind_sample(rng);
        }
    }

    for scale in [2, 4, 8, 16, 32].iter() {
        let vrs = *scale as f32;
        let vr = Range::new(-vrs, vrs);
        let rs = Array::from_shape_fn((physics::HSIZE / scale + 2, physics::HSIZE / scale + 2), |_| vr.ind_sample(rng));
        for y in 0..physics::HSIZE {
            for x in 0..physics::HSIZE {
                let rix = x / scale;
                let riy = y / scale;
                let xt = ((x % scale) as f32) / (*scale as f32);
                let yt = ((y % scale) as f32) / (*scale as f32);

                let v_y0 = interp(rs[(rix, riy)], rs[(rix + 1, riy)], xt);
                let v_y1 = interp(rs[(rix, riy + 1)], rs[(rix + 1, riy + 1)], xt);
                let v = interp(v_y0, v_y1, yt);
                arr[(x, y)] += v;
            }
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
            let avg_ground_z = (physics::VSIZE as f32) * 0.3;
            for y in 0..physics::HSIZE {
                for x in 0..physics::HSIZE {
                    let h = land_base[(x as usize, y as usize)] * 0.3 + avg_ground_z;
                    for z in 0..physics::VSIZE {
                        if z == 0 {
                            w.blocks[(x, y, z)] = Block::Bedrock;
                        } else if (z as f32) < h {
                            w.blocks[(x, y, z)] = Block::Soil;
                        } else {
                            w.blocks[(x, y, z)] = Block::Air;
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
            w.blocks = Array::from_shape_fn(
                (physics::HSIZE, physics::HSIZE, physics::VSIZE),
                |(_, _, z)| if z == 0 {Block::Bedrock} else {Block::Air});

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
