import {
  Body,
  ContactMaterial,
  ConvexPolyhedron,
  Material,
  Plane,
  Vec3,
  World,
  type Quaternion,
} from 'cannon-es';

import { at, polyhedron, type Shape, type Vec } from './polyhedra.js';

// A throw is simulated to its end before anything is drawn, at a fixed step. Then the module
// knows which face of each die lands on top and writes the server's result there (labels.ts);
// the recorded steps are played back as the animation.

/** The floor's half extents, in world units; walls stand at its edges. */
export interface Arena {
  halfWidth: number;
  halfDepth: number;
}

export interface Simulation {
  /** Recorded steps. */
  steps: number;
  /** Per step and die: position x, y, z and quaternion x, y, z, w. */
  frames: Float32Array;
  /** Per die: the face on top, or for a d4 the corner on top. */
  tops: number[];
  /** Whether every die came to rest flat; false after the last attempt failed. */
  settled: boolean;
}

export const STEP = 1 / 60;
const MAX_STEPS = 6 * 60;
const ATTEMPTS = 4;
/** How flat a die must lie: the top face's normal against straight up. */
const FLAT = 0.97;
/** A die this slow (units and radians per second) counts as still. */
const STILL_SPEED = 0.25;
const STILL_SPIN = 0.6;
/** Steps every die must stay still before the throw ends. */
const STILL_STEPS = 15;
export const STRIDE = 7;

const UP = new Vec3(0, 1, 0);

function makeWorld(arena: Arena): { world: World; dice: Material } {
  const world = new World({ gravity: new Vec3(0, -40, 0), allowSleep: true });
  const floor = new Material('floor');
  const wall = new Material('wall');
  const dice = new Material('dice');
  world.addContactMaterial(new ContactMaterial(floor, dice, { friction: 0.35, restitution: 0.35 }));
  world.addContactMaterial(new ContactMaterial(wall, dice, { friction: 0.1, restitution: 0.6 }));
  world.addContactMaterial(new ContactMaterial(dice, dice, { friction: 0.2, restitution: 0.4 }));
  const plane = (material: Material, position: Vec3, axis: Vec3, angle: number): void => {
    const body = new Body({ mass: 0, material, shape: new Plane(), position });
    body.quaternion.setFromAxisAngle(axis, angle);
    world.addBody(body);
  };
  // A plane faces +z; turn each so it faces into the arena.
  plane(floor, new Vec3(0, 0, 0), new Vec3(1, 0, 0), -Math.PI / 2);
  plane(wall, new Vec3(-arena.halfWidth, 0, 0), new Vec3(0, 1, 0), Math.PI / 2);
  plane(wall, new Vec3(arena.halfWidth, 0, 0), new Vec3(0, 1, 0), -Math.PI / 2);
  plane(wall, new Vec3(0, 0, -arena.halfDepth), new Vec3(0, 1, 0), 0);
  plane(wall, new Vec3(0, 0, arena.halfDepth), new Vec3(0, 1, 0), Math.PI);
  return { world, dice };
}

function bodyFor(shape: Shape, material: Material): Body {
  const solid = polyhedron(shape);
  const body = new Body({
    mass: 1,
    material,
    shape: new ConvexPolyhedron({
      vertices: solid.vertices.map(([x, y, z]) => new Vec3(x, y, z)),
      faces: solid.faces.map((face) => [...face]),
    }),
    linearDamping: 0.1,
    angularDamping: 0.25,
  });
  body.sleepSpeedLimit = STILL_SPEED;
  body.sleepTimeLimit = 0.2;
  return body;
}

/** Puts the dice in a block near one edge, thrown towards the middle of the table. */
function launch(bodies: Body[], arena: Arena, random: () => number): void {
  const side = Math.floor(random() * 4);
  const along = side < 2 ? arena.halfDepth : arena.halfWidth;
  const perRow = Math.max(1, Math.floor((along * 1.2) / 2.4));
  bodies.forEach((body, index) => {
    const row = Math.floor(index / perRow);
    const slot = (index % perRow) - (Math.min(bodies.length, perRow) - 1) / 2;
    const inset = 1.6 + (row % 2) * 2.4;
    const lateral = slot * 2.4 + (random() - 0.5);
    const height = 2.5 + Math.floor(row / 2) * 2.4 + random();
    const speed = 14 + random() * 10;
    const spread = (random() - 0.5) * 0.5;
    // Along the x axis for sides 0 and 1, the z axis for 2 and 3.
    const sign = side % 2 === 0 ? 1 : -1;
    const [edge, cross] = side < 2 ? [arena.halfWidth, lateral] : [arena.halfDepth, lateral];
    const from = -sign * (edge - inset);
    const towards = sign * speed;
    if (side < 2) {
      body.position.set(from, height, cross);
      body.velocity.set(towards, -2, towards * spread);
    } else {
      body.position.set(cross, height, from);
      body.velocity.set(towards * spread, -2, towards);
    }
    body.quaternion.setFromEuler(
      random() * Math.PI * 2,
      random() * Math.PI * 2,
      random() * Math.PI * 2,
    );
    body.angularVelocity.set((random() - 0.5) * 30, (random() - 0.5) * 30, (random() - 0.5) * 30);
  });
}

/** The face whose normal points most nearly up, or for a d4 the highest corner. */
export function topOf(shape: Shape, quaternion: Quaternion): { index: number; flat: boolean } {
  const solid = polyhedron(shape);
  const turn = (v: Vec): Vec3 => quaternion.vmult(new Vec3(v[0], v[1], v[2]));
  if (shape === 'd4') {
    const heights = solid.vertices.map((v) => turn(v).y);
    const index = heights.indexOf(Math.max(...heights));
    // It lies flat when the face opposite the top corner points straight down.
    const downs = solid.normals.map((n) => -turn(n).dot(UP));
    return { index, flat: Math.max(...downs) > FLAT };
  }
  const ups = solid.normals.map((n) => turn(n).dot(UP));
  const best = Math.max(...ups);
  return { index: ups.indexOf(best), flat: best > FLAT };
}

function attempt(shapes: readonly Shape[], arena: Arena, random: () => number): Simulation {
  const { world, dice } = makeWorld(arena);
  const bodies = shapes.map((shape) => bodyFor(shape, dice));
  for (const body of bodies) world.addBody(body);
  launch(bodies, arena, random);
  const recorded: number[] = [];
  let steps = 0;
  let still = 0;
  while (steps < MAX_STEPS && still < STILL_STEPS) {
    world.step(STEP);
    steps++;
    for (const { position: p, quaternion: q } of bodies) {
      recorded.push(p.x, p.y, p.z, q.x, q.y, q.z, q.w);
    }
    // Cannon puts a body to sleep late, and a d20 can creep on for seconds: still is enough.
    const stopped = bodies.every(
      (body) =>
        body.sleepState === Body.SLEEPING ||
        (body.velocity.length() < STILL_SPEED && body.angularVelocity.length() < STILL_SPIN),
    );
    still = stopped ? still + 1 : 0;
  }
  const tops = bodies.map((body, index) => topOf(at(shapes, index), body.quaternion));
  return {
    steps,
    frames: Float32Array.from(recorded),
    tops: tops.map((top) => top.index),
    settled: still >= STILL_STEPS && tops.every((top) => top.flat),
  };
}

/**
 * Throws the dice until they all come to rest flat, a few times at most. `random` is
 * `Math.random` in the browser; tests pass a seeded one.
 */
export function simulate(
  shapes: readonly Shape[],
  arena: Arena,
  random: () => number = Math.random,
): Simulation {
  let result = attempt(shapes, arena, random);
  for (let tries = 1; tries < ATTEMPTS && !result.settled; tries++) {
    result = attempt(shapes, arena, random);
  }
  return result;
}
