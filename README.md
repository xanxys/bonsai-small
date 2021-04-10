# bonsai-small
![logo](/favicon.png)

Try at https://xanxys.github.io/bonsai-small.

## Model Overview
![Screenvideo](/summary.gif)

In bonsai world, plants are composed of "cells". A plant consists of interconnected "cells", where each cell is a cuboid.
Bonsai tries to differ from existing evolution simulator in two main points: genotype-phenotype distinction & rich environment.

First, in bonsai, cell growth & division & differentiation are dictated by "genome", which means it has
genotype-phenotype distinction, and simulates embryogenesis.
In a sense, it can be thought of extension of L-system, dynamically controlled by environment & internal biochemstry,
albeit simplified one.

The other point, richer environment, is pretty straightforward but somehow lacking in lots of existing systems.
I know even two-type predator-prey ecosystem can show chaotic behavior, but they're too artificial.
What I want to see is, different niches emerging from mutation of single genome, and eventually co-existing.
I firmly believe complex enough physics is necessary, but I want to verify it with this simulator.


Currently simulated aspects are:

* Rigid-body based "cell" simulation (using ammo.js)
* Light (simplified ray tracing)
* Fake biochemistry based on "signals"
* Fake genetics ("promoter" - "signal generation")

What I want to confirm / expect to see with this project:
* Formation of ecological niches
* Emergence of creative usage of physics


TODO: Write more details before I forget


## Plans
* Fix ammo.js integration
* More complex light pattern
* More complex landscape
* Soil physics (root strength? & water?)
* Automatically share mutated genome to appengine (or something)


## References

Not so massive vegetation evolution simulator in browser. (cf. discontinued "massive" version at https://github.com/xanxys/bonsai).
