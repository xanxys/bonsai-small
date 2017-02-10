use std::fmt::{self, Formatter, Display};

#[derive(Debug)]
struct V3{x:f64, y:f64, z:f64}

fn main() {
    let mut v : V3 = V3{x:0.0,y:0.0,z:0.0};
    for i in 0i64..1000*1000*1000 {
        let k : f64 = 1.0 / (1.0 + i as f64);
        v.x += k;
        v.y += 2.0;
        v.z += k;
        v.x *= k;
        v.y *= k;
        v.z *= k;
    }
    println!("{:?}", v);
}
