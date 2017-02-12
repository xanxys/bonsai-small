#[macro_use]
extern crate glium;
extern crate rand;
extern crate time;
extern crate nalgebra;
extern crate ncurses;

use nalgebra::{BaseFloat, Vector3, Point3, Matrix4, Isometry3, ToHomogeneous, Transpose, Perspective3};
use ncurses::*;
use std::thread;
use std::f64::consts;
use std::collections::HashMap;
use std::sync::mpsc::{Receiver, Sender, channel, sync_channel};
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

    epsilon: u8,
    decay: u8,

    prog: [u8; 256],
    regs: [u8; 4],
    ip: u8,
    ext: bool,
    result: bool,
}

struct World {
    cells: Vec<Cell>,
    next_id: u64,
    steps: u64,
    // environment:
    // pos -> {W, S, R, A}
    // W(p): flow, alpha-source, spatial changing, temporally constant
    // A: weak flow: spatially constant, temporally changing
    // S: sticking force
    // R: exclusion
    // flow
}

struct CellView {
    p: V3,
}

// Subset of World + animtation information to visualize World.
struct WorldView {
    cells: Vec<CellView>,
}

// Outside World.
struct SceneView {
    cam_rot_theta: f32,
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

fn step_code(c: &mut Cell){
    if c.epsilon == 0 {
        c.decay += 1;
        if c.decay == 0xff {
            // Delete cell.
        }
        return;
    }
    // Execute the instruction.
    c.decay = 0;
    c.epsilon -= if c.ext {2} else {1};

    let inst = c.prog[c.ip as usize];
    let dst = (inst & 3) as usize;
    let src = ((inst >> 2) & 3) as usize;

    if inst < 0x04 {
        // divide
    } else if inst < 0x08 {
        // check
    } else if inst < 0x0c {
        // share * 2
    } else if inst < 0x14 {
        // force * 2
    } else if inst < 0x1c {
        // fuse
        c.ext = true;
    } else if inst < 0x20 {
        // RESERVED.
    } else if inst < 0x21 {
        c.epsilon = 0;
    } else if inst < 0x22 {
        for i in 0..128 {
            c.prog[i+128] = c.prog[i];
        }
        c.ext = true;
    } else if inst < 0x23 {
        for i in 128..256 {
            c.prog[i] = 0;
        }
        c.ext = false;
    } else if inst < 0x24 {
        c.result = !c.result;
    } else if inst < 0x25 {
        // get-alpha
    } else if inst < 0x26 {
        // get-phi
    } else if inst < 0x20 {
        // RESERVED
    } else if inst < 0x30 {
        if src & 1 == 0 || c.result {
            c.ip = c.regs[dst];
            return;
        }
    } else if inst < 0x3f {
        if src & 1 == 0 || c.result {
            c.ip += c.regs[dst];
            return;
        }
    } else if inst < 0x40 {
        if src & 1 == 0 || c.result {
            for i in 1..128 {
                let addr = (c.ip + i) & 0x7f;
                if c.prog[addr as usize] == c.regs[dst] {
                    c.ip = addr;
                    c.result = true;
                    return;
                }
            }
            c.result = false;
            return;
        }
    } else if inst < 0x80 {
        c.regs[dst] = (inst >> 2) & 0xf;
    // Upper half: [0x80, 0xff]
    } else if inst < 0x84 {
        c.regs[dst] = c.epsilon;
    } else if inst < 0x88 {
        c.regs[dst] = !c.regs[dst];
    } else if inst < 0x8c {
        let v = c.regs[dst];
        c.regs[dst] = (v << 4) | (v >> 4);
    } else if inst < 0x90 {
        // RESERVED.
    } else if inst < 0xa0 {
        c.regs[dst] &= c.regs[src];
    } else if inst < 0xb0 {
        c.regs[dst] |= c.regs[src];
    } else if inst < 0xc0 {
        let sum = (c.regs[dst] as u16) + (c.regs[src] as u16);
        c.regs[dst] = (sum & 0xff) as u8;
        c.result = sum & 0x100 > 0;
    } else if inst < 0xd0 {
        c.regs[dst] = c.regs[src];
    } else if inst < 0xe0 {
        let addr = if c.ext {c.regs[dst]} else {c.regs[dst] & 0x7f};
        c.prog[addr as usize] = c.regs[src];
    } else if inst < 0xf0 {
        let addr = if c.ext {c.regs[src]} else {c.regs[src] & 0x7f};
        c.regs[dst] = c.prog[addr as usize];
    } else {
        // Nearby
    }
    c.ip += 1;
    c.ip &= 0x7f;
}


fn step(w: &mut World) {
    let gravity = 0.01;
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

        // Exclusion.
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
        let vrange = Range::new(0.0, 100.0);
        let p = V3{x:hrange.ind_sample(&mut rng), y: hrange.ind_sample(&mut rng), z: vrange.ind_sample(&mut rng)};
        let inst_range = Range::new(0, 255);

        let mut prog = [0; 256];
        for i in 0..128 {
            prog[i] = inst_range.ind_sample(&mut rng);
        }

        w.cells.push(Cell{
            id: w.next_id,
            p: p,
            pi: floor(&p),
            dp: V3{x:0.0, y:0.0, z:0.0},
            ip: 0,
            ext: false,
            result: false,
            epsilon: 0xff,
            decay: 0,
            prog: prog,
            regs: [0; 4],
        });
        w.next_id += 1;
    }
    return w;
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

        let radius = 200.0;
        let camera_pose = look_at(
            &Point3::new(radius * sv.cam_rot_theta.cos(), radius * sv.cam_rot_theta.sin(), 40.0),
            &Point3::new(0.0, 0.0, 30.0),
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
    let mut w = create_world();
    let (tx, rx) = sync_channel::<WorldView>(1);
    let (stat_tx, stat_rx) = channel::<f64>();

    initscr();
    thread::spawn(move || {
        loop {
            let t0 = time::precise_time_s();
            step(&mut w);
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
            refresh();
        }
    });
    draw_world_forever(rx, stat_tx);
}
