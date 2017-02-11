#!/bin/bash

rustc -C opt-level=3 -o bonsai main.rs;
time ./bonsai
