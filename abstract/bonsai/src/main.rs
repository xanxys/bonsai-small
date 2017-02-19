#[macro_use]
extern crate glium;
extern crate time;
extern crate ncurses;
extern crate nalgebra;
extern crate rand;
extern crate ndarray;

mod physics;
mod initializer;

use initializer::{WorldSpec};
use nalgebra::{BaseFloat, Vector3, Point3, Matrix4, Isometry3, ToHomogeneous, Transpose, Perspective3};
use ncurses::*;
use std::thread;
use std::cmp;
use std::f64::consts;
use std::sync::mpsc::{Receiver, Sender, channel, sync_channel};
use physics::V3;
use ndarray::prelude::*;

#[derive(Copy, Clone)]
struct Vertex {
    position: [f32; 3],
}
implement_vertex!(Vertex, position);

#[derive(Copy, Clone)]
struct BlockVertex {
    pos: [f32; 3],
    bnd_type: u32,
}
implement_vertex!(BlockVertex, pos, bnd_type);

struct CellView {
    p: physics::V3,
}

// Subset of World + animtation information to visualize World.
struct WorldView(Option<Array3<physics::Block>>, Vec<CellView>);

// Outside World.
struct SceneView {
    cam_rot_theta: f32,
}


// Create a camera matrix with specified attribs.
// when retval is m,
// m*(p,1) will be located in coords such that
// X+: right, Y+:down, Z+: far, (0, 0) will be center of camera.
fn look_at<N: BaseFloat>(pos: &Point3<N>, at: &Point3<N>, up: &Vector3<N>) -> Matrix4<N> {
    return Isometry3::look_at_rh(pos, at, up).to_homogeneous();
}

fn convert_matrix<N>(m: Matrix4<N>) -> [[N; 4]; 4] {
    return [
        [m.m11, m.m12, m.m13, m.m14],
        [m.m21, m.m22, m.m23, m.m24],
        [m.m31, m.m32, m.m33, m.m34],
        [m.m41, m.m42, m.m43, m.m44],
    ];
}

struct GlMesh<VT: Copy, IT: glium::index::Index>(glium::VertexBuffer<VT>, glium::IndexBuffer<IT>);

fn encode_boundary_type(a: physics::Block, b: physics::Block) -> u32 {
    let strength = |x| match x {
        physics::Block::Bedrock => 3,
        physics::Block::Water => 2,
        physics::Block::Soil => 1,
        physics::Block::Air => 0,
    };
    return cmp::max(strength(a), strength(b));
}

fn upload_mesh<F: glium::backend::Facade>(backend: &F, blocks: &Array3<physics::Block>) -> GlMesh<BlockVertex, u32> {
    // Emit mesh.
    let mut vs = vec![];
    let mut is = vec![];
    {
        let mut emit_quad = |vbase: V3, e0: V3, e1: V3, bt: u32| {
            // 2 3
            // 0 1  -> (0, 1, 2) + (2, 1, 3)
            let ix_offset = (&mut vs).len();
            for i in 0..4 {
                let mut v = vbase;
                if i & 1 != 0{
                    v.x += e0.x;
                    v.y += e0.y;
                    v.z += e0.z;
                }
                if i & 2 != 0 {
                    v.x += e1.x;
                    v.y += e1.y;
                    v.z += e1.z;
                }
                vs.push(BlockVertex{pos:[v.x as f32, v.y as f32, v.z as f32], bnd_type:bt});
            };
            is.append(&mut vec![0, 1, 2, 2, 1, 3].iter().map(|dix| (ix_offset + dix) as u32).collect::<Vec<_>>());
        };
        for z in 0..physics::VSIZE-1 {
            for y in 0..physics::HSIZE-1 {
                for x in 0..physics::HSIZE-1 {
                    let base = blocks[(x, y, z)];
                    let xp = blocks[(x + 1, y, z)];
                    let yp = blocks[(x, y + 1, z)];
                    let zp = blocks[(x, y, z + 1)];

                    if base != xp {
                        emit_quad(V3{x:(x + 1) as f64, y:y as f64, z:z as f64}, V3{x:0.0, y:1.0, z: 0.0}, V3{x:0.0, y:0.0, z: 1.0},
                            encode_boundary_type(base, xp));
                    }
                    if base != yp {
                        emit_quad(V3{x:x as f64, y:(y + 1) as f64, z:z as f64}, V3{x:0.0, y:0.0, z: 1.0}, V3{x:1.0, y:0.0, z: 0.0},
                            encode_boundary_type(base, yp));
                    }
                    if base != zp {
                        emit_quad(V3{x:x as f64, y:y as f64, z:(z + 1) as f64}, V3{x:1.0, y:0.0, z: 0.0}, V3{x:0.0, y:1.0, z: 0.0},
                            encode_boundary_type(base, zp));
                    }
                }
            }
        }
    }

    let vertex_buffer = glium::VertexBuffer::new(backend, &vs).unwrap();
    let index_buffer = glium::IndexBuffer::new(backend, glium::index::PrimitiveType::TrianglesList, &is).unwrap();
    return GlMesh(vertex_buffer, index_buffer);
}

fn draw_world_forever(rx: Receiver<WorldView>, stat_tx: Sender<f64>) {
    let vertex_shader_src = r#"
        #version 140

        in vec3 position;
        uniform mat4 matrix;
        varying float height;

        void main() {
            gl_Position = matrix * vec4(position, 1.0);
            height = position.z / 100;
        }
    "#;

    let fragment_shader_src = r#"
        #version 140
        out vec4 color;
        varying float height;
        void main() {
            color = vec4(0.86, 1.0, 0.52 + height, 0.1);
        }
    "#;

    let vertex_shader_blocks_src = r#"
        #version 140

        in vec3 pos;
        in uint bnd_type;

        uniform mat4 matrix;
        out vec3 w_pos;
        flat out uint bt;

        void main() {
            gl_Position = matrix * vec4(pos, 1.0);
            w_pos = pos;
            bt = bnd_type;
        }
    "#;

    let fragment_shader_blocks_src = r#"
        #version 140
        out vec4 color;
        in vec3 w_pos;
        flat in uint bt;

        void main() {
            if (bt == 3u) {
                // Violet-ish color for bedrock.
                color = vec4(0.16, 0.07, 0.22, 0.5);
            } else if(bt == 2u) {
                // Blue-ish color for water.
                color = vec4(0.22, 0.40, 1.0, 0.5);
            } else {
                // Weak red-ish color or black equi-height line for Soil.
                // nudge z a little to avoid z fighting.
                if (fract((w_pos.z + 0.1) / 10) < 0.02) {
                    color = vec4(0, 0, 0, 1);
                } else {
                    color = vec4(0.5, 0.41, 0.37, 0.2);
                }
            }
        }
    "#;

    use glium::{DisplayBuild, Surface};
    let display = glium::glutin::WindowBuilder::new().build_glium().unwrap();
    let program = glium::Program::from_source(&display, vertex_shader_src, fragment_shader_src, None).unwrap();
    let program_blocks = glium::Program::from_source(&display, vertex_shader_blocks_src, fragment_shader_blocks_src, None).unwrap();

    let mut sv = SceneView{cam_rot_theta: 0.0};

    let mut cells = vec![];
    let mut blocks_mesh = None;

    loop {
        let t0 = time::precise_time_s();
        match rx.try_recv() {
            Ok(WorldView(None, new_cells)) => {
                cells = new_cells;
            },
            Ok(WorldView(Some(blocks), new_cells)) => {
                blocks_mesh = Some(upload_mesh(&display, &blocks));
                cells = new_cells;
            },
            Err(_) => {},
        }

        let mut target = display.draw();
        let aspect = {
            let (w, h) = target.get_dimensions();
            (w as f32) / (h as f32)
        };

        let center = Point3::new(
            physics::HSIZE as f32 / 2.0,
            physics::HSIZE as f32 / 2.0,
            physics::VSIZE as f32 / 2.0);

        let radius = 200.0;
        let camera_pose = look_at(
            &(center + Vector3::new(radius * sv.cam_rot_theta.cos(), radius * sv.cam_rot_theta.sin(), 10.0)),
            &center,
            &Vector3::new(0.0, 0.0, 1.0));

        let camera_proj = Perspective3::new(aspect, consts::PI as f32/ 2.0, 0.5, 500.0).to_matrix();
        let matrix = (camera_proj * camera_pose).transpose();

        target.clear_color(0.01, 0.01, 0.01, 1.0);

        // Transfer cell points to GPU & draw them.
        {
            let mut shape = vec![];
            for cell in &cells {
                shape.push(Vertex { position: [cell.p.x as f32, cell.p.y as f32, cell.p.z as f32] });
            }
            let vertex_buffer = glium::VertexBuffer::new(&display, &shape).unwrap();
            let indices = glium::index::NoIndices(glium::index::PrimitiveType::Points);

            let params = glium::DrawParameters{
                point_size: Some(4.0),
                blend: glium::draw_parameters::Blend {
                    color: glium::BlendingFunction::Addition {
                        source: glium::LinearBlendingFactor::SourceAlpha,
                        destination: glium::LinearBlendingFactor::One,
                    },
                    alpha: glium::BlendingFunction::AlwaysReplace,
                    constant_value: (0.0, 0.0, 0.0, 0.0)
                },
                ..Default::default()
            };
            target.draw(&vertex_buffer, &indices, &program,  &uniform!{ matrix: convert_matrix(matrix) }, &params).unwrap();
        }
        // Draw landscape.
        if let Some(ref mesh) = blocks_mesh {
            let &GlMesh(ref vertex_buffer, ref index_buffer) = mesh;
            let params = glium::DrawParameters{
                blend: glium::draw_parameters::Blend {
                    color: glium::BlendingFunction::Addition {
                        source: glium::LinearBlendingFactor::SourceAlpha,
                        destination: glium::LinearBlendingFactor::One,
                    },
                    alpha: glium::BlendingFunction::AlwaysReplace,
                    constant_value: (0.0, 0.0, 0.0, 0.0)
                },
                ..Default::default()
            };
            target.draw(vertex_buffer, index_buffer, &program_blocks, &uniform!{ matrix: convert_matrix(matrix) }, &params).unwrap();
        }

        target.finish().unwrap();

        // listing the events produced by the window and waiting to be received
        for ev in display.poll_events() {
            match ev {
                glium::glutin::Event::Closed => return,   // the window has been closed by the user
                _ => ()
            }
        }

        let dt_sec = time::precise_time_s() - t0;
        stat_tx.send(dt_sec).unwrap();
        let rot_speed = 0.1;  // rot/sec
        sv.cam_rot_theta += (dt_sec * rot_speed * (2.0 * consts::PI)) as f32;
    }
}


fn main() {
    let (tx, rx) = sync_channel::<WorldView>(1);
    let (stat_tx, stat_rx) = channel::<f64>();

    initscr();
    thread::spawn(move || {
        let dt_switch = 5.0;
        //let specs = vec![WorldSpec::TestFlatBedrock, WorldSpec::Valley, WorldSpec::TestCellLoad(1000*1000)];
        let specs = vec![WorldSpec::Creek, WorldSpec::CubeFarm];

        let mut current_ix = 0;
        let mut last_switch_time = time::precise_time_s();
        let mut w = initializer::create_world(specs[current_ix]);

        let gen_full_wv = |w: &physics::World| {
            let mut cvs = vec![];
            for cell in &w.cells {
                cvs.push(CellView{p:cell.p});
            }
            return WorldView(Some(w.blocks.clone()), cvs);
        };
        let gen_cell_view = |w: &physics::World| {
            let mut cvs = vec![];
            for cell in &w.cells {
                cvs.push(CellView{p:cell.p});
            }
            return WorldView(None, cvs);
        };

        tx.send(gen_full_wv(&w)).unwrap();

        loop {
            /*
            if time::precise_time_s() > last_switch_time + dt_switch {
                current_ix = (current_ix + 1) % specs.len();
                w = initializer::create_world(specs[current_ix]);
                last_switch_time = time::precise_time_s();

                tx.send(gen_full_wv(&w)).unwrap();
            }
            */
            let t0 = time::precise_time_s();
            w.step();
            let dt_step = time::precise_time_s() - t0;
            w.validate();

            tx.send(gen_cell_view(&w)).unwrap();

            let mut draw_dt = 0.0;
            loop {
                match stat_rx.try_recv() {
                    Ok(dt) => draw_dt = dt,
                    _ => break,
                }
            }
            mv(0, 0);
            clrtoeol();
            printw(&format!("SIM step={} dt={:.1}ms", w.steps, dt_step * 1e3));
            if w.cells.len() > 0 {
                mv(1, 0);
                printw(&format!("{} {} {}", w.cells[0].id, w.cells[0].ip, w.cells[0].epsilon));
            }

            mv(2, 0);
            clrtoeol();
            printw(&format!("DRAW dt={:.1}ms", draw_dt * 1e3));

            mv(3, 0);
            clrtoeol();
            printw(&format!("Spec={:?}", specs[current_ix]));
            refresh();
        }
    });
    draw_world_forever(rx, stat_tx);
}
