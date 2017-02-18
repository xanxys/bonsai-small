#[macro_use]
extern crate glium;
extern crate time;
extern crate nalgebra;
extern crate ncurses;
extern crate rand;

mod physics;
mod initializer;

use initializer::{WorldSpec};
use nalgebra::{BaseFloat, Vector3, Point3, Matrix4, Isometry3, ToHomogeneous, Transpose, Perspective3};
use ncurses::*;
use std::thread;
use std::f64::consts;
use std::sync::mpsc::{Receiver, Sender, channel, sync_channel};
use physics::V3;

#[derive(Copy, Clone)]
struct Vertex {
    position: [f32; 3],
}

implement_vertex!(Vertex, position);

struct CellView {
    p: physics::V3,
}

// Subset of World + animtation information to visualize World.
struct WorldView(Option<Vec<physics::Block>>, Vec<CellView>);

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

    let fragment_shader_blocks_src = r#"
        #version 140
        out vec4 color;
        varying float height;
        void main() {
            color = vec4(0.86, 1.0, 0.52 + height, 0.1);
        }
    "#;

    use glium::{DisplayBuild, Surface};
    let display = glium::glutin::WindowBuilder::new().build_glium().unwrap();
    let program = glium::Program::from_source(&display, vertex_shader_src, fragment_shader_src, None).unwrap();
    let program_blocks = glium::Program::from_source(&display, vertex_shader_src, fragment_shader_blocks_src, None).unwrap();

    let mut sv = SceneView{cam_rot_theta: 0.0};
    let mut wv = rx.recv().unwrap();

    loop {
        let t0 = time::precise_time_s();
        match rx.try_recv() {
            Ok(WorldView(None, cells)) => {
                let WorldView(ex, _) = wv;
                wv = WorldView(ex, cells);
            },
            Ok(new_wv) => {
                wv = new_wv;
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

        let WorldView(ref maybe_blocks, ref cells) = wv;
        // Transfer cell points to GPU & draw them.
        {
            let mut shape = vec![];
            for cell in cells {
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
        if let &Some(ref blocks) = maybe_blocks {
            // Emit mesh.
            let mut vs = vec![];
            let mut is = vec![];
            {
                let mut emit_quad = |vbase: V3, e0: V3, e1: V3| {
                    // 2 3
                    // 0 1  -> (0, 1, 2) + (2, 1, 3)
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
                        vs.push(Vertex{position: [v.x as f32, v.y as f32, v.z as f32]});
                    };
                    let ix_offset = (&mut is).len();
                    is.append(&mut vec![0, 1, 2, 2, 1, 3].iter().map(|dix| (ix_offset + dix) as u16).collect::<Vec<_>>());
                };
                for z in 0..physics::VSIZE-1 {
                    for y in 0..physics::HSIZE-1 {
                        for x in 0..physics::HSIZE-1 {
                            let base = blocks[x + y * physics::HSIZE + z * physics::HSIZE * physics::HSIZE];
                            let xp = blocks[(x + 1) + y * physics::HSIZE + z * physics::HSIZE * physics::HSIZE];
                            let yp = blocks[x + (y + 1) * physics::HSIZE + z * physics::HSIZE * physics::HSIZE];
                            let zp = blocks[x + y * physics::HSIZE + (z + 1) * physics::HSIZE * physics::HSIZE];

                            if base != xp {
                                emit_quad(V3{x:(x + 1) as f64, y:y as f64, z:z as f64}, V3{x:0.0, y:1.0, z: 0.0}, V3{x:0.0, y:0.0, z: 1.0});
                            }
                            if base != yp {
                                emit_quad(V3{x: x as f64, y:(y + 1) as f64, z:z as f64}, V3{x:0.0, y:0.0, z: 1.0}, V3{x:1.0, y:0.0, z: 0.0});
                            }
                            if base != zp {
                                emit_quad(V3{x: x as f64, y:y as f64, z:(z + 1 ) as f64}, V3{x:1.0, y:0.0, z: 0.0}, V3{x:0.0, y:1.0, z: 0.0});
                            }
                        }
                    }
                }
            }

            let vertex_buffer = glium::VertexBuffer::new(&display, &vs).unwrap();
            let index_buffer = glium::IndexBuffer::new(&display, glium::index::PrimitiveType::TrianglesList, &is).unwrap();

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
            target.draw(&vertex_buffer, &index_buffer, &program_blocks, &uniform!{ matrix: convert_matrix(matrix) }, &params).unwrap();
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
        stat_tx.send(dt_sec);
        let rot_speed = 0.1;  // rot/sec
        sv.cam_rot_theta += (dt_sec * rot_speed * (2.0 * consts::PI)) as f32;
    }
}


fn main() {
    let dt_switch = 5.0;
    let specs = vec![WorldSpec::TestFlatBedrock, WorldSpec::Valley, WorldSpec::TestCellLoad(1000*1000)];

    let mut current_ix = 0;
    let mut last_switch_time = time::precise_time_s();
    let mut w = initializer::create_world(specs[current_ix]);

    let (tx, rx) = sync_channel::<WorldView>(1);
    let (stat_tx, stat_rx) = channel::<f64>();

    initscr();
    thread::spawn(move || {
        loop {
            if time::precise_time_s() > last_switch_time + dt_switch {
                current_ix = (current_ix + 1) % specs.len();
                w = initializer::create_world(specs[current_ix]);
                last_switch_time = time::precise_time_s();

                let mut cvs = vec![];
                for cell in &w.cells {
                    cvs.push(CellView{p:cell.p});
                }
                tx.send(WorldView(Some(w.blocks.clone()), cvs)).unwrap();
            }
            let t0 = time::precise_time_s();
            w.step();
            let dt_step = time::precise_time_s() - t0;

            let mut cvs = vec![];
            for cell in &w.cells {
                cvs.push(CellView{p:cell.p});
            }
            tx.send(WorldView(None, cvs)).unwrap();

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
