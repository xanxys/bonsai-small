use physics;

use std::fmt;
use rand;
use rand::distributions::{IndependentSample, Range};
use physics::Block;

#[derive(Clone, Copy, Debug)]
pub enum WorldSpec {
    TestCellLoad(i32),
    TestFlatBedrock,
}

pub fn create_world(spec: WorldSpec) -> physics::World {
    let mut rng = rand::thread_rng();
    let mut w = physics::empty_world();

    match spec {
        WorldSpec::TestFlatBedrock => {
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
    }
    return w;
}
