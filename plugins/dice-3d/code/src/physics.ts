// Throws the dice in a cannon-es world before showing anything, records each step, and reads
// which face landed up. The dice are then relabelled to show the server's results and the
// recording is played back: the physics only decides how they tumble, never what they show.

import { Body, ContactMaterial, ConvexPolyhedron, Material, Plane, Vec3, World } from 'cannon-es';

import { readUp, SHAPES, type ShapeName } from './shapes.js';

export const STEP = 1 / 60;
/** A throw stops after this many seconds even if a die still rocks. */
const MAX_SECONDS = 6;

export interface Recording {
  /** Per step, per die: x, y, z, then the quaternion x, y, z, w. */
  frames: Float32Array[];
  /** Per die: the face (or a d4's vertex) that landed up. */
  up: number[];
}

export interface Table {
  /** Half the visible floor along x and z, in world units. */
  halfWidth: number;
  halfDepth: number;
}

/** A small seeded generator, so tests can repeat a throw. */
export function randomFrom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const shapes = new Map<ShapeName, ConvexPolyhedron>();
function convex(name: ShapeName): ConvexPolyhedron {
  let found = shapes.get(name);
  if (!found) {
    const shape = SHAPES[name];
    found = new ConvexPolyhedron({
      vertices: shape.vertices.map(([x, y, z]) => new Vec3(x, y, z)),
      faces: shape.faces.map((face) => [...face]),
    });
    shapes.set(name, found);
  }
  return found;
}

function wall(world: World, material: Material, position: Vec3, axis: Vec3, angle: number): void {
  const body = new Body({ mass: 0, shape: new Plane(), material });
  body.position.copy(position);
  body.quaternion.setFromAxisAngle(axis, angle);
  world.addBody(body);
}

/** Throws `dice` from the near edge of `table` and records them until they rest. */
export function simulate(
  dice: readonly ShapeName[],
  table: Table,
  random: () => number = Math.random,
): Recording {
  const world = new World({ gravity: new Vec3(0, -30, 0), allowSleep: true });
  const floor = new Material('floor');
  const sides = new Material('wall');
  const die = new Material('die');
  world.addContactMaterial(new ContactMaterial(floor, die, { friction: 0.25, restitution: 0.35 }));
  world.addContactMaterial(new ContactMaterial(sides, die, { friction: 0, restitution: 0.7 }));
  world.addContactMaterial(new ContactMaterial(die, die, { friction: 0.1, restitution: 0.5 }));

  const { halfWidth: w, halfDepth: d } = table;
  wall(world, floor, new Vec3(0, 0, 0), new Vec3(1, 0, 0), -Math.PI / 2);
  wall(world, sides, new Vec3(-w, 0, 0), new Vec3(0, 1, 0), Math.PI / 2);
  wall(world, sides, new Vec3(w, 0, 0), new Vec3(0, 1, 0), -Math.PI / 2);
  wall(world, sides, new Vec3(0, 0, -d), new Vec3(0, 1, 0), 0);
  wall(world, sides, new Vec3(0, 0, d), new Vec3(0, 1, 0), Math.PI);

  // From the bottom of the screen (+z), towards the middle, with a spin.
  const bodies = dice.map((name, index) => {
    const body = new Body({
      mass: 1,
      shape: convex(name),
      material: die,
      linearDamping: 0.1,
      angularDamping: 0.1,
      sleepSpeedLimit: 0.15,
      sleepTimeLimit: 0.25,
    });
    const spread = Math.min(w * 0.8, 1.6 * dice.length);
    body.position.set(
      (random() - 0.5) * spread + (index % 2 === 0 ? -0.4 : 0.4),
      3 + random() * 3 + (index % 3),
      d * 0.75 - random() * 1.5,
    );
    body.quaternion.setFromEuler(random() * 6.3, random() * 6.3, random() * 6.3);
    body.velocity.set((random() - 0.5) * 10, random() * 3, -(7 + random() * 7));
    body.angularVelocity.set((random() - 0.5) * 25, (random() - 0.5) * 25, (random() - 0.5) * 25);
    world.addBody(body);
    return body;
  });

  const frames: Float32Array[] = [];
  const record = () => {
    const frame = new Float32Array(bodies.length * 7);
    bodies.forEach((body, index) => {
      const { position: p, quaternion: q } = body;
      frame.set([p.x, p.y, p.z, q.x, q.y, q.z, q.w], index * 7);
    });
    frames.push(frame);
  };
  record();
  const steps = Math.round(MAX_SECONDS / STEP);
  for (let step = 0; step < steps; step += 1) {
    world.step(STEP);
    record();
    if (bodies.every((body) => body.sleepState === Body.SLEEPING)) break;
  }

  const up = bodies.map((body, index) => {
    // The world's up, in the die's own frame.
    const local = body.quaternion.conjugate().vmult(new Vec3(0, 1, 0));
    const name = dice[index] ?? 'd6';
    return readUp(SHAPES[name], [local.x, local.y, local.z]);
  });
  return { frames, up };
}
