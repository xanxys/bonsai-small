#[macro_use]
extern crate glium;

use std::collections::HashMap;

#[derive(Debug, Copy, Clone)]
struct V3{x:f64, y:f64, z:f64}

#[derive(Debug, Hash, Eq, PartialEq, Copy, Clone)]
struct I3{x:i16, y:i16, z:i16}

#[inline]
fn floor(v : &V3) -> I3 {
    I3{x:v.x.floor() as i16, y:v.y.floor() as i16, z:v.z.floor() as i16}
}

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

}



fn main() {
    let mut w = World{cells:vec![], next_id:0};
    for _ in 0..1000*1000 {
        w.cells.push(Cell{
            id: w.next_id,
            p: V3{x:12.3, y: 3.4, z: -232.3},
            pi: I3{x:12, y: 3, z: -233},
            dp: V3{x:0.0, y:0.0, z:0.0},
            prog: [0; 256],
            regs: [0; 4],
        });
        w.next_id += 1;
    }

    use glium::{DisplayBuild, Surface};
    let display = glium::glutin::WindowBuilder::new().build_glium().unwrap();
    loop {
        let mut target = display.draw();
        target.clear_color(0.0, 0.0, 1.0, 1.0);
        target.finish().unwrap();

        // listing the events produced by the window and waiting to be received
        for ev in display.poll_events() {
            match ev {
                glium::glutin::Event::Closed => return,   // the window has been closed by the user
                _ => ()
            }
        }
    }

    for _ in 0i64..10 {
        step(&mut w);
    }
}
