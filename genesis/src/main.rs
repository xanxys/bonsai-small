extern crate time;
extern crate http;
extern crate serialize;
extern crate nalgebra;
extern crate core;

use http::headers::content_type::MediaType;
use http::server::{Config, Server, Request, ResponseWriter};
use nalgebra::na::{Vec3, Rot3, Rotation};
use nalgebra::na;
use serialize::json;
use std::fmt;
use std::io::net::ip::{SocketAddr, Ipv4Addr};
use std::io::Writer;
use core::result::Result;

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

struct Chunk {
    cells: Vec<Cell>
}


struct Genome {
    gene: String
}

// Not real cell, but a bunch of cells that form a nearly rigid uniform body
// Cell changes by gene expression
struct Cell {
    genome: Genome,
    signals: Vec<Signal>,
    pos: Vec3<f32>,
    rot: Quaternion<f32>,

    // Micro-step simulation only
    // (for macrostep, these are 0)
    vel: Vec3<f32>,
    avel: Vec3<f32>
}

// A single, atomic, "molecule".
// May work as trigger for gene expression,
// or work as functional parts itself.
// Similar to RNAs in RNA-world.
struct Signal(String);





#[deriving(Clone)]
struct GenesisServer;


fn path_to_media_type(path: &String) -> MediaType {
    let param_utf8 = vec!((String::from_str("charset"), String::from_str("UTF-8")));
    match path.as_slice().split_str(".").last() {
        Some("js") => MediaType {
            type_: String::from_str("application"),
            subtype: String::from_str("javascript"),
            parameters: param_utf8
        },
        Some("css") => MediaType {
            type_: String::from_str("text"),
            subtype: String::from_str("css"),
            parameters: param_utf8
        },
        Some("png") => MediaType {
            type_: String::from_str("image"),
            subtype: String::from_str("png"),
            parameters: vec![]
        },
        _ => MediaType {
            type_: String::from_str("text"),
            subtype: String::from_str("plain"),
            parameters: param_utf8
        }
    }
}

impl Server for GenesisServer {
    fn get_config(&self) -> Config {
        Config { bind_address: SocketAddr { ip: Ipv4Addr(127, 0, 0, 1), port: 8001 } }
    }

    fn handle_request(&self, r: Request, w: &mut ResponseWriter) {
        println!("{}", r.request_uri);

        let dir_prefix = "http_static";
        let uri_path = format!("{}", r.request_uri);
        let (media_type, content) = if uri_path.as_slice().starts_with("/api/") {
            let stat = PlantStat {
                num_plant: 123
            };
            let content = json::encode(&stat).into_bytes();
            (MediaType {
                type_: String::from_str("application"),
                subtype: String::from_str("json"),
                parameters: vec!((String::from_str("charset"), String::from_str("UTF-8")))
            }, content)
        } else if uri_path.as_slice() == "/" {
            let content = match std::io::File::open(&Path::new("http_static/index.html")).read_to_end() {
                Ok(content) => content,
                _ => vec![]
            };
            (MediaType {
                type_: String::from_str("text"),
                subtype: String::from_str("html"),
                parameters: vec!((String::from_str("charset"), String::from_str("UTF-8")))
            }, content)
        } else {
            let mut file_path = String::from_str("http_static");
            file_path.push_str(uri_path.as_slice());
            let content = match std::io::File::open(&Path::new(file_path.clone())).read_to_end() {
                Ok(content) => content,
                _ => vec![]
            };
            (path_to_media_type(&file_path), content)
        };
        w.headers.date = Some(time::now_utc());
        w.headers.content_length = Some(content.len());
        w.headers.content_type = Some(media_type);
        w.write(content.as_slice()).unwrap();
    }
}

fn main() {
    GenesisServer.serve_forever();
}
