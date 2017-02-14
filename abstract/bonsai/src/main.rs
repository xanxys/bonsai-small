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

#[derive(Copy, Clone)]
struct Vertex {
    position: [f32; 3],
}

implement_vertex!(Vertex, position);


struct CellView {
    p: physics::V3,
}

// Subset of World + animtation information to visualize World.
struct WorldView {
    cells: Vec<CellView>,
}

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

    use glium::{DisplayBuild, Surface};
    let display = glium::glutin::WindowBuilder::new().build_glium().unwrap();
    let program = glium::Program::from_source(&display, vertex_shader_src, fragment_shader_src, None).unwrap();

    let mut sv = SceneView{cam_rot_theta: 0.0};
    let mut wv = rx.recv().unwrap();
    loop {
        let t0 = time::precise_time_s();
        match rx.try_recv() {
            Ok(new_wv) => wv = new_wv,
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
        let matrix_raw = [
            [matrix.m11, matrix.m12, matrix.m13, matrix.m14],
            [matrix.m21, matrix.m22, matrix.m23, matrix.m24],
            [matrix.m31, matrix.m32, matrix.m33, matrix.m34],
            [matrix.m41, matrix.m42, matrix.m43, matrix.m44],
        ];

        target.clear_color(0.01, 0.01, 0.01, 1.0);
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

        let mut shape = vec![];
        for cell in &wv.cells {
            shape.push(Vertex { position: [cell.p.x as f32, cell.p.y as f32, cell.p.z as f32] });
        }

        let vertex_buffer = glium::VertexBuffer::new(&display, &shape).unwrap();
        let indices = glium::index::NoIndices(glium::index::PrimitiveType::Points);

        target.draw(&vertex_buffer, &indices, &program,  &uniform!{ matrix: matrix_raw }, &params).unwrap();
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
    let specs = vec![WorldSpec::TestFlatBedrock, WorldSpec::TestCellLoad(1000*1000)];

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
            }
            let t0 = time::precise_time_s();
            w.step();
            let dt_step = time::precise_time_s() - t0;

            let mut wv = WorldView{cells:vec![]};
            for cell in &w.cells {
                wv.cells.push(CellView{p:cell.p});
            }
            tx.send(wv).unwrap();

            let mut draw_dt = 0.0;
            loop {
                match stat_rx.try_recv() {
                    Ok(dt) => draw_dt = dt,
                    _ => break,
                }
            }
            mv(0, 0);
            printw(&format!("SIM step={} dt={:.1}ms", w.steps, dt_step * 1e3));
            mv(1, 0);
            printw(&format!("{} {} {}", w.cells[0].id, w.cells[0].ip, w.cells[0].epsilon));
            mv(2, 0);
            printw(&format!("DRAW dt={:.1}ms", draw_dt * 1e3));
            mv(3, 0);
            printw(&format!("Spec={:?}", specs[current_ix]));
            refresh();
        }
    });
    draw_world_forever(rx, stat_tx);
}
