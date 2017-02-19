use physics;

use rand;
use rand::Rng;
use rand::distributions::{IndependentSample, Range};
use physics::Block;
use ndarray::prelude::*;
use std::ops;
use std::cmp;

#[derive(Clone, Copy, Debug)]
pub enum WorldSpec {
    TestCellLoad(i32),
    TestFlatBedrock,
    // Complex envs (natural, artificial)
    Creek,
    CubeFarm,
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
        let mut dist = ((ys[x] - y as i32).abs() as f32) / (RES as f32);
        dist = (dist - 0.1).max(0.0);
        return interp((dist * 3.0).min(1.0), (x as f32) / (RES as f32), 0.3);
    }));
}

fn overlap1(a: ops::Range<usize>, b: ops::Range<usize>) -> bool {
    cmp::max(a.start, b.start) < cmp::min(a.end, b.end)
}


type Area = (ops::Range<usize>, ops::Range<usize>);

fn overlap((ax, ay): Area, (bx, by): Area) -> bool {
    overlap1(ax, bx) && overlap1(ay, by)
}

// [prev_z, curr_z]: fill by prev.
fn fill_nested_cubes<R: Rng>(rng: &mut R, blocks: &mut Array3<Block>, level: usize, prev: Block, area: Area, prev_z: usize, curr_z: usize) {
    let (xr, yr) = area;
    for y in yr.clone() {
        for x in xr.clone() {
            let edist = cmp::min(cmp::min(x-xr.start, xr.end-1-x), cmp::min(y-yr.start, yr.end-1-y));

            let remove_t = rng.gen_range(0.0, 1.0 / (1.0 + edist as f32));

            let curr_imcomplete_z = if level == 0 {curr_z} else {(curr_z as f32 - (remove_t * (curr_z as f32 - prev_z as f32))) as usize};
            let z0 = cmp::min(prev_z, curr_imcomplete_z);
            let z1 = cmp::max(prev_z, curr_imcomplete_z);
            for z in z0..z1+1 {
                blocks[(x, y, z)] = prev;
            }
        }
    }

    let dx = xr.end - xr.start;
    let dy = yr.end - yr.start;

    // Terminate when too small, or Z too close to edge.
    let max_csize = (cmp::min(dx, dy) as f32 * 0.6) as usize;
    if max_csize < 15 || curr_z < 2 || curr_z > physics::VSIZE - 2 {
        return;
    }

    let mut prev_areas: Vec<Area> = vec![];
    for _ in 0..20 {
        let csize = rng.gen_range(10, max_csize);
        let cx0 = rng.gen_range(xr.start, xr.end - csize);
        let cy0 = rng.gen_range(yr.start, yr.end - csize);
        let carea = (ops::Range{start:cx0, end: cx0+csize}, ops::Range{start:cy0, end:cy0+csize});
        if prev_areas.iter().any(|pa| overlap(carea.clone(), pa.clone())) {
            continue;
        }

        let p = rng.gen_range(0.0, 1.0);
        let mut block = Block::Soil;
        if p < 0.1 {
            block = Block::Water;
        } else if p < 0.4 {
            block = Block::Bedrock;
        }

        let mut new_z = if block == Block::Water {curr_z - 10} else {curr_z + rng.gen_range(1, cmp::max(2, csize / 2))};
        if new_z >= physics::VSIZE - 1 {
            new_z = physics::VSIZE - 1;
        }
        if new_z <= 1 {
            new_z = 1;
        }
        if new_z > curr_z {
            prev_areas.push(carea.clone());
            fill_nested_cubes(rng, blocks, level + 1, block, carea, curr_z, new_z);
        }
    }
}

pub fn create_world(spec: WorldSpec) -> physics::World {
    let mut rng = rand::thread_rng();
    let mut w = physics::empty_world();

    match spec {
        WorldSpec::Creek => {
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
                        return Block::Water;
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
        WorldSpec::CubeFarm => {
            let z = rng.gen_range((physics::VSIZE as f32) * 0.2, (physics::VSIZE as f32) * 0.3) as usize;
            fill_nested_cubes(&mut rng, &mut w.blocks, 0, Block::Soil,
                (ops::Range{start:0, end:physics::HSIZE}, ops::Range{start:0, end:physics::HSIZE}), 0, z);

            let height_adj = land_base(&mut rng) * 0.1 + 1.0;
            for y in 0..physics::HSIZE {
                for x in 0..physics::HSIZE {
                    let mut z = physics::VSIZE - 1;
                    while z > 0 {
                        if w.blocks[(x, y, z)] != Block::Air {
                            break;
                        }
                        z -= 1;
                    }
                    let b  = w.blocks[(x, y, z)];
                    for zmod in z..cmp::min(physics::VSIZE, z+height_adj[(x, y)] as usize) {
                        w.blocks[(x, y, zmod)] = b;
                    }
                    w.blocks[(x, y, 0)] = Block::Bedrock;
                }
            }
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
