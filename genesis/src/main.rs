extern crate time;
extern crate http;
extern crate serialize;

use serialize::json;
use std::io::net::ip::{SocketAddr, Ipv4Addr};
use std::io::Writer;

use http::server::{Config, Server, Request, ResponseWriter};
use http::headers::content_type::MediaType;

struct Quaternion<T> {
    x: T,
    y: T,
    z: T,
    w: T
}

#[deriving(Decodable, Encodable)]
pub struct PlantStat {
    num_plant: u32
}


struct Genome {
    gene: String
}

// Not real cell, but a bunch of cells that form a nearly rigid uniform body
// Cell changes by gene expression
struct Cell {
    genome: Genome,
    signals: Vec<Signal>
}

// A single, atomic, "molecule".
// May work as trigger for gene expression,
// or work as functional parts itself.
// Similar to RNAs in RNA-world.
struct Signal(String);





#[deriving(Clone)]
struct GenesisServer;

impl Server for GenesisServer {
    fn get_config(&self) -> Config {
        Config { bind_address: SocketAddr { ip: Ipv4Addr(127, 0, 0, 1), port: 8001 } }
    }

    fn handle_request(&self, r: Request, w: &mut ResponseWriter) {
        println!("{}", r.request_uri);
        let stat = PlantStat {
            num_plant: 123
        };
        let json_content = json::encode(&stat).into_bytes();
        let content = json_content.as_slice();

        w.headers.date = Some(time::now_utc());
        w.headers.content_length = Some(content.len());
        w.headers.content_type = Some(MediaType {
            type_: String::from_str("application"),
            subtype: String::from_str("json"),
            parameters: vec!((String::from_str("charset"), String::from_str("UTF-8")))
        });

        w.write(content).unwrap();
    }
}

fn main() {
    GenesisServer.serve_forever();
}
