#[macro_use]
extern crate glium;
extern crate rand;

use std::thread;
use std::collections::HashMap;
use std::sync::mpsc::sync_channel;
use rand::Rng;
use rand::distributions::{IndependentSample, Range};

#[derive(Debug, Copy, Clone)]
struct V3{x:f64, y:f64, z:f64}

#[derive(Debug, Hash, Eq, PartialEq, Copy, Clone)]
struct I3{x:i16, y:i16, z:i16}

#[inline]
fn floor(v : &V3) -> I3 {
    I3{x:v.x.floor() as i16, y:v.y.floor() as i16, z:v.z.floor() as i16}
}

#[derive(Copy, Clone)]
struct Vertex {
    position: [f32; 3],
}

implement_vertex!(Vertex, position);


struct Cell {
    id: u64,

    p: V3,
    pi: I3,
    dp: V3,

    prog: [u8; 256],
    regs: [u8; 4],
}

struct World {
    cells: Vec<Cell>,
    next_id: u64,
    steps: u64,
}

struct CellView {
    p: V3,
}

// Subset of World + animtation information to visualize World.
struct WorldView {
    cells: Vec<CellView>,
}


fn step_code(c: &mut Cell){
    let inst = c.prog[c.regs[3] as usize];
    c.regs[3] += 1;

    if (inst == 0xff) {
        // Die.
    } else if(inst == 0x11) {

    }

}


fn step(w: &mut World) {
    let gravity = -0.01;
    let dissipation = 0.9;

    let mut occupation = HashMap::new();
    // Biochem & Kinetic.
    for cell in &mut w.cells {
        step_code(cell);

        cell.dp.z -= gravity;

        // dissipation
        cell.dp.x *= dissipation;
        cell.dp.y *= dissipation;
        cell.dp.z *= dissipation;

        // Inertia.
        // TODO: Experiment w/ explicit stopoed-moving st. mgmt.
        cell.p.x += cell.dp.x;
        cell.p.y += cell.dp.y;
        cell.p.z += cell.dp.z;

        // Exclusivity.
        let pi_next = floor(&cell.p);
        // M(pi_next - pi) = {0, 1, 2, 3}
        // When empty: ok
        // Otherwise, try decending order: 2, 1, 0.
        if occupation.contains_key(&pi_next) {
        } else {
            cell.pi = pi_next;
        }
        occupation.insert(cell.pi, true);
    }

    // Light transport.

    w.steps += 1;
}


fn create_world() -> World {
    let mut rng = rand::thread_rng();
    let mut w = World{cells:vec![], next_id:0, steps:0};
    for _ in 0..1000*1000 {
        let hrange = Range::new(-100.0, 100.0);
        let vrange = Range::new(0.0, 200.0);
        let p = V3{x:hrange.ind_sample(&mut rng), y: hrange.ind_sample(&mut rng), z: vrange.ind_sample(&mut rng)};

        w.cells.push(Cell{
            id: w.next_id,
            p: p,
            pi: floor(&p),
            dp: V3{x:0.0, y:0.0, z:0.0},
            prog: [0; 256],
            regs: [0; 4],
        });
        w.next_id += 1;
    }
    return w;
}

fn main() {
    let mut w = create_world();
    let (tx, rx) = sync_channel::<WorldView>(1);

    thread::spawn(move || {
        loop {
            step(&mut w);
            let mut wv = WorldView{cells:vec![]};
            for cell in &w.cells {
                wv.cells.push(CellView{p:cell.p});
            }
            tx.send(wv).unwrap();
            println!("{}", w.steps);
            thread::sleep_ms(250);
        }
    });

    let vertex_shader_src = r#"
        #version 140

        in vec3 position;

        void main() {
            gl_Position = vec4(position * 0.1, 1.0);
        }
    "#;

    let fragment_shader_src = r#"
        #version 140
        out vec4 color;
        void main() {
            color = vec4(1.0, 0.0, 0.0, 1.0);
        }
    "#;

    use glium::{DisplayBuild, Surface};
    let display = glium::glutin::WindowBuilder::new().build_glium().unwrap();
    let program = glium::Program::from_source(&display, vertex_shader_src, fragment_shader_src, None).unwrap();

    loop {
        let wv = rx.recv().unwrap();

        let mut target = display.draw();
        target.clear_color(0.01, 0.01, 0.01, 1.0);
        let params = glium::DrawParameters{
            point_size: Some(4.0),
            ..Default::default()
        };

        let mut shape = vec![];
        for cell in wv.cells {
            shape.push(Vertex { position: [cell.p.x as f32, cell.p.y as f32, cell.p.z as f32] });
        }

        let vertex_buffer = glium::VertexBuffer::new(&display, &shape).unwrap();
        let indices = glium::index::NoIndices(glium::index::PrimitiveType::Points);

        target.draw(&vertex_buffer, &indices, &program, &glium::uniforms::EmptyUniforms, &params).unwrap();
        target.finish().unwrap();

        // listing the events produced by the window and waiting to be received
        for ev in display.poll_events() {
            match ev {
                glium::glutin::Event::Closed => return,   // the window has been closed by the user
                _ => ()
            }
        }
    }
}
