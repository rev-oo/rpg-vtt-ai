// Throws dice in a cannon-es world ahead of time and records every step, so the renderer can play
// the throw back after the labels were changed to land on the server's results. The same seed and
// bounds give the same throw.

import {
  Body,
  ContactMaterial,
  ConvexPolyhedron,
  Material,
  Plane,
  Quaternion,
  Vec3 as CannonVec3,
  World,
} from 'cannon-es';

import { shapeOf, type Sides } from './shapes.js';

export const STEP = 1 / 60;
/** A throw that has not settled after this many steps stops where it is. */
export const MAX_STEPS = 60 * 6;
/** How far (in radii, and in quaternion terms) a die may drift over QUIET_STEPS and count as still. */
const QUIET_DRIFT = 0.02;
const QUIET_STEPS = 15;

export interface Bounds {
  /** Half the width (x) and depth (z) of the floor the dice stay on, in die radii. */
  halfWidth: number;
  halfDepth: number;
}

export type Quat = [number, number, number, number];
export type Position = [number, number, number];

export interface Throw {
  /** frames[step][die] */
  frames: { position: Position; quaternion: Quat }[][];
  settled: boolean;
}

/** A small seeded random source (mulberry32) from a string such as a message id. */
export function random(seed: string): () => number {
  let state = 2166136261;
  for (let i = 0; i < seed.length; i += 1) state = Math.imul(state ^ seed.charCodeAt(i), 16777619);
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const shapes = new Map<Sides, ConvexPolyhedron>();
function collider(sides: Sides): ConvexPolyhedron {
  let shape = shapes.get(sides);
  if (!shape) {
    const solid = shapeOf(sides);
    shape = new ConvexPolyhedron({
      vertices: solid.vertices.map(([x, y, z]) => new CannonVec3(x, y, z)),
      faces: solid.faces.map((face) => face.vertices),
    });
    shapes.set(sides, shape);
  }
  return shape;
}

function wall(world: World, material: Material, position: Position, axis: Position, angle: number) {
  const body = new Body({ mass: 0, material, shape: new Plane() });
  body.position.set(...position);
  body.quaternion.setFromAxisAngle(new CannonVec3(...axis), angle);
  world.addBody(body);
}

/**
 * Throws the dice from the edge of the floor toward its middle, as a hand would, and records
 * each step until every die sleeps.
 */
export function simulate(sides: readonly Sides[], seed: string, bounds: Bounds): Throw {
  const next = random(seed);
  const between = (low: number, high: number) => low + next() * (high - low);
  const world = new World({ gravity: new CannonVec3(0, -60, 0), allowSleep: true });
  world.defaultContactMaterial.friction = 0.3;
  const dieMaterial = new Material('die');
  const tableMaterial = new Material('table');
  world.addContactMaterial(
    new ContactMaterial(dieMaterial, tableMaterial, { friction: 0.35, restitution: 0.45 }),
  );
  world.addContactMaterial(
    new ContactMaterial(dieMaterial, dieMaterial, { friction: 0.1, restitution: 0.5 }),
  );

  const { halfWidth: w, halfDepth: d } = bounds;
  wall(world, tableMaterial, [0, 0, 0], [1, 0, 0], -Math.PI / 2);
  wall(world, tableMaterial, [-w, 0, 0], [0, 1, 0], Math.PI / 2);
  wall(world, tableMaterial, [w, 0, 0], [0, 1, 0], -Math.PI / 2);
  wall(world, tableMaterial, [0, 0, -d], [0, 1, 0], 0);
  wall(world, tableMaterial, [0, 0, d], [0, 1, 0], Math.PI);

  // From one of the four sides, toward a point near the middle.
  const side = Math.floor(next() * 4);
  const bodies = sides.map((s, i) => {
    const along = between(-0.5, 0.5);
    const start: Position =
      side === 0
        ? [-w + 1.2, 0, along * d]
        : side === 1
          ? [w - 1.2, 0, along * d]
          : side === 2
            ? [along * w, 0, -d + 1.2]
            : [along * w, 0, d - 1.2];
    const body = new Body({
      mass: 1,
      material: dieMaterial,
      shape: collider(s),
      linearDamping: 0.1,
      angularDamping: 0.2,
      sleepSpeedLimit: 0.3,
      sleepTimeLimit: 0.2,
    });
    body.position.set(start[0], 2.5 + Math.floor(i / 4) * 2.2, start[2]);
    body.quaternion.setFromEuler(
      between(0, 2 * Math.PI),
      between(0, 2 * Math.PI),
      between(0, 2 * Math.PI),
    );
    const target = [between(-0.3, 0.3) * w, between(-0.3, 0.3) * d];
    const toward = new CannonVec3((target[0] ?? 0) - start[0], 0, (target[1] ?? 0) - start[2]);
    toward.normalize();
    const speed = between(14, 22);
    body.velocity.set(toward.x * speed, between(-2, 4), toward.z * speed);
    body.angularVelocity.set(between(-20, 20), between(-20, 20), between(-20, 20));
    world.addBody(body);
    return body;
  });

  const frames: Throw['frames'] = [];
  const record = () =>
    frames.push(
      bodies.map((body) => ({
        position: [body.position.x, body.position.y, body.position.z],
        quaternion: quat(body.quaternion),
      })),
    );
  record();
  // Settled once no die has moved by more than a hair over a quarter second: a die rocking on
  // an edge by a hair may never fall asleep.
  let settled = false;
  for (let step = 0; step < MAX_STEPS && !settled; step += 1) {
    world.step(STEP);
    record();
    settled = still(frames);
  }
  return { frames, settled };
}

const quat = (q: Quaternion): Quat => [q.x, q.y, q.z, q.w];

const distance = (a: readonly number[], b: readonly number[]) =>
  Math.hypot(...a.map((value, k) => value - (b[k] ?? 0)));

/** Whether every die stayed put over the last QUIET_STEPS frames. */
function still(frames: Throw['frames']): boolean {
  const now = frames.at(-1);
  const then = frames.at(-1 - QUIET_STEPS);
  if (!now || !then) return false;
  return now.every((die, i) => {
    const before = then[i];
    return (
      before !== undefined &&
      distance(die.position, before.position) < QUIET_DRIFT &&
      // q and −q are the same turn.
      Math.min(
        distance(die.quaternion, before.quaternion),
        distance(
          die.quaternion,
          before.quaternion.map((c) => -c),
        ),
      ) < QUIET_DRIFT
    );
  });
}
