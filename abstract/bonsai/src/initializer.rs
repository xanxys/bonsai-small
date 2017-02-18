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
        let rs = resample(Array::from_shape_fn((physics::HSIZE / scale + 2, physics::HSIZE / scale + 2), |_| vr.ind_sample(rng)));
        for y in 0..physics::HSIZE {
            for x in 0..physics::HSIZE {
                arr[(x, y)] += rs[(x, y)];
            }
        }
    }
    return arr;
}

fn resample(a: Array2<f32>) -> Array2<f32> {
    let sx = (a.shape()[0] - 2) as f32 / (physics::HSIZE as f32);
    let sy = (a.shape()[1] - 2) as f32 / (physics::HSIZE as f32);

    return Array::from_shape_fn((physics::HSIZE, physics::HSIZE), |(x, y)| {
        let ox = (x as f32) * sx;
        let oy = (y as f32) * sy;
        let oix = ox.floor() as usize;
        let oiy = oy.floor() as usize;
        let xt = ox.fract();
        let yt = oy.fract();

        let v_y0 = interp(a[(oix, oiy)], a[(oix + 1, oiy)], xt);
        let v_y1 = interp(a[(oix, oiy + 1)], a[(oix + 1, oiy + 1)], xt);
        return interp(v_y0, v_y1, yt);
    });
}


// Create a smooth "valley" that connects X=0 to X=H.
// X=0 is lower.
// Calculate on 10x10 grid.
// Returns smooth [0, 1.0].
fn valley_base<R: Rng>(rng: &mut R) -> Array2<f32> {
    const RES: usize = 10;
    // Create squiggly path.
    let mut ys = vec![];
    let mut curr_y = rng.gen_range(2, RES as i32 - 2);
    for _ in 0..RES {
        ys.push(curr_y);
        curr_y += rng.gen_range(-1, 2);
        if curr_y < 0 {
            curr_y = 0;
        } else if curr_y >= RES as i32 {
            curr_y = (RES - 1) as i32;
        }
    }
    // Create valley by modulating distance from the path.
    return resample(Array::from_shape_fn((RES, RES), |(x, y)| {
        let dist = ((ys[x] - y as i32).abs() as f32) / (RES as f32);
        return interp((dist * 3.0).min(1.0), (x as f32) / (RES as f32), 0.1);
    }));
}

pub fn create_world(spec: WorldSpec) -> physics::World {
    let mut rng = rand::thread_rng();
    let mut w = physics::empty_world();

    match spec {
        WorldSpec::Valley => {
            let avg_ground_z = (physics::VSIZE as f32) * 0.4;
            let valley = valley_base(&mut rng);
            // Reduce randomness in valley to make them look like a dried up river.
            let height_soil = (&valley * 50.0 + land_base(&mut rng) * (&valley * 0.5 + 0.5) * 0.5 + avg_ground_z).mapv(|v| v.min((physics::VSIZE - 1) as f32));
            let height_br = land_base(&mut rng) * 0.01 + 1.0;

            w.blocks = Array::from_shape_fn(physics::BLOCKS_SHAPE, |(x, y, z)| {
                if (z as f32) < height_br[(x, y)] {
                    return Block::Bedrock;
                } else if (z as f32) < height_soil[(x, y)] {
                    if rng.gen_weighted_bool(2000) {
                        return Block::Water(physics::V3{x:1.0, y: 0.0, z:0.0});
                    } else {
                        return Block::Soil;
                    }
                } else {
                    return Block::Air;
                }
            });

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
            w.blocks = Array::from_shape_fn(physics::BLOCKS_SHAPE, |(_, _, z)| if z == 0 {Block::Bedrock} else {Block::Air});

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
