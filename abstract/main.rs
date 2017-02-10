use std::collections::HashMap;

#[derive(Debug, Copy, Clone)]
struct V3{x:f64, y:f64, z:f64}

#[derive(Debug, Hash, Eq, PartialEq, Copy, Clone)]
struct I3{x:i16, y:i16, z:i16}

#[inline]
fn floor(v : &V3) -> I3 {
    I3{x:v.x.floor() as i16, y:v.y.floor() as i16, z:v.z.floor() as i16}
}

struct Cell{
    p: V3,
    pi: I3,
    dp: V3,

    prog: [u8; 256],
    regs: [u8; 4],
}

struct World{
    cells: Vec<Cell>,
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
        cell.p.x += cell.dp.x;
        cell.p.y += cell.dp.y;
        cell.p.z += cell.dp.z;

        // Exclusivity.
        let pi_next = floor(&cell.p);
        if occupation.contains_key(&pi_next) {
            // Need to stay inside pi, instead of going to pi_next.

        } else {
            cell.pi = pi_next;
        }
        occupation.insert(cell.pi, true);
    }

    // Light transport.

}



fn main() {
    let mut w = World{cells:vec![]};
    for i in 0..1000*1000 {
        w.cells.push(Cell{
            p: V3{x:12.3, y: 3.4, z: -232.3},
            pi: I3{x:12, y: 3, z: -233},
            dp: V3{x:0.0, y:0.0, z:0.0},
            prog: [0; 256],
            regs: [0; 4],
        });
    }

    for _ in 0i64..10 {
        step(&mut w);
    }
}
