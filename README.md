# bonsai-small
![logo](/favicon.png)

Try at https://xanxys.github.io/bonsai-small.

## Overview
![Screenvideo](/summary.gif)

Bonsai world consits of cells and genomes that controls internal signals, growth, self-reproduction.
Light is the sole energy for cells, and they compete for the resource in a randomly generated terrain.

The project's ultimate goal is to achieve open-ended life simulation.

We're trying gradual approach.

1. Create an initial system with very structure/complex physics, in which plants are guaranteed to evolve with simple human-desgined genome.
2. Repeat these until satisfied:
    1. Replace a part of physicsl rule with genome data. Hand-design and give extra energy source.
    2. Evolve the genome to fit the new physics by gradually reducing energy.
3. Very simple physics & initial genome (too intricate to human-design), open-ended evolution potential.


See https://github.com/xanxys/bonsai-small/PHYSICS.md for physics model details.

## Compilation

### ammo.js
git clone https://github.com/kripken/ammo.js/

Add following line and re-compile ammo.js using docker.
```
interface btTransform {
  ...
  [Value] btVector3 invXform([Const, Ref] btVector3 inVec);
  ...
}
interface btGeneric6DofConstraint {
  ...
  void setFrames([Const, Ref] btTransform frameA, [Const, Ref] btTransform frameB);
  [Const, Ref] btTransform getFrameOffsetB();
  ...
}
```


## References

* Discontinued "massive" version at https://github.com/xanxys/bonsai-massive

