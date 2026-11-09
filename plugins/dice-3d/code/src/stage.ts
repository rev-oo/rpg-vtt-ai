import { Quaternion as PhysicsQuaternion } from 'cannon-es';
import {
  AmbientLight,
  BufferGeometry,
  CanvasTexture,
  DirectionalLight,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  ShadowMaterial,
  SRGBColorSpace,
  WebGLRenderer,
} from 'three';

import type { Die } from './dice.js';
import { labelsFor, shownOnTop } from './labels.js';
import {
  at,
  cross,
  dot,
  faceCentre,
  length,
  polyhedron,
  scale,
  sub,
  type Shape,
  type Vec,
} from './polyhedra.js';
import { simulate, STEP, STRIDE, topOf, type Arena, type Simulation } from './simulate.js';

// Draws throws over the table page with three.js. The frame is the size of the page; the
// camera looks straight down on a floor that fills it, so dice land anywhere on screen.

export const COLOURS = {
  ivory: { body: '#f4efe1', ink: '#2b2118' },
  crimson: { body: '#9b1c24', ink: '#fbeee0' },
  sapphire: { body: '#1f3f8f', ink: '#f2f2f2' },
  emerald: { body: '#1d6b45', ink: '#f5f0dc' },
  onyx: { body: '#1d1d22', ink: '#e9c46a' },
} as const;
export type Colour = keyof typeof COLOURS;

export type ThrowState = 'idle' | 'rolling' | 'resting';
export interface Report {
  state: ThrowState;
  /** What each die shows on top once landed; empty while idle. */
  shown: readonly string[];
  /** Whether WebGL is drawing: without it, throws still run, unseen. */
  drawing: boolean;
}

const CAMERA_HEIGHT = 40;
const FOV = 30;
const FADE_SECONDS = 0.4;
const TEXTURE = 128;
/** A face's number, as a share of its texture; faces fill less of it on the rounder dice. */
const TEXT_SIZE: Readonly<Record<Shape, number>> = {
  d4: 0.2,
  d6: 0.5,
  d8: 0.46,
  d10: 0.4,
  d12: 0.44,
  d20: 0.4,
};

/** The floor the camera sees from its height, less a margin, for a page of this shape. */
export function arenaFor(width: number, height: number): Arena {
  const aspect = Math.min(3, Math.max(0.5, width / Math.max(1, height)));
  const halfDepth = CAMERA_HEIGHT * Math.tan(((FOV / 2) * Math.PI) / 180) * 0.92;
  return { halfDepth, halfWidth: halfDepth * aspect };
}

interface FaceFrame {
  /** Unit vectors spanning the face's plane, and its centre. */
  u: Vec;
  w: Vec;
  centre: Vec;
  /** Half the size of the square its texture covers. */
  reach: number;
}

function faceFrame(shape: Shape, face: number): FaceFrame {
  const solid = polyhedron(shape);
  const corners = at(solid.faces, face).map((index) => at(solid.vertices, index));
  const centre = faceCentre(solid, face);
  const first = sub(at(corners, 0), centre);
  const u = scale(first, 1 / length(first));
  const w = cross(at(solid.normals, face), u);
  const reach = Math.max(...corners.map((c) => length(sub(c, centre)))) * 1.02;
  return { u, w, centre, reach };
}

/** A face's point in its texture, from 0 to 1 on both axes. */
function uvOf(frame: FaceFrame, point: Vec): [number, number] {
  const d = sub(point, frame.centre);
  return [0.5 + dot(d, frame.u) / (2 * frame.reach), 0.5 + dot(d, frame.w) / (2 * frame.reach)];
}

const geometries = new Map<Shape, BufferGeometry>();

/** A die's mesh geometry: flat faces, each its own group (and material) with its own texture. */
function geometryOf(shape: Shape): BufferGeometry {
  const known = geometries.get(shape);
  if (known) return known;
  const solid = polyhedron(shape);
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const geometry = new BufferGeometry();
  solid.faces.forEach((face, index) => {
    const frame = faceFrame(shape, index);
    const normal = at(solid.normals, index);
    const start = positions.length / 3;
    for (let k = 1; k + 1 < face.length; k++) {
      for (const corner of [face[0], face[k], face[k + 1]]) {
        const point = at(solid.vertices, corner ?? 0);
        positions.push(...point);
        normals.push(...normal);
        uvs.push(...uvOf(frame, point));
      }
    }
    geometry.addGroup(start, positions.length / 3 - start, index);
  });
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometries.set(shape, geometry);
  return geometry;
}

/** Whether a number would read upside down as another: 6 and 9 get a bar under them. */
const AMBIGUOUS = new Set(['6', '9', '66', '99', '16', '19', '61', '91', '68', '89', '86', '98']);

function drawText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  angle: number,
): void {
  context.save();
  context.translate(x, y);
  context.rotate(angle);
  context.font = `bold ${String(Math.round(size))}px Georgia, "Times New Roman", serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(text, 0, 0);
  if (AMBIGUOUS.has(text)) {
    const width = context.measureText(text).width;
    context.fillRect(-width / 2, size * 0.45, width, Math.max(2, size * 0.07));
  }
  context.restore();
}

/** The texture of one face: the die's colour and its number, or its corner numbers for a d4. */
function faceTexture(shape: Shape, face: number, labels: readonly string[], colour: Colour) {
  const canvas = document.createElement('canvas');
  canvas.width = TEXTURE;
  canvas.height = TEXTURE;
  const context = canvas.getContext('2d');
  if (context) {
    const { body, ink } = COLOURS[colour];
    context.fillStyle = body;
    context.fillRect(0, 0, TEXTURE, TEXTURE);
    context.fillStyle = ink;
    const solid = polyhedron(shape);
    const frame = faceFrame(shape, face);
    const toCanvas = ([u, v]: [number, number]): [number, number] => [
      u * TEXTURE,
      (1 - v) * TEXTURE,
    ];
    if (shape === 'd4') {
      for (const corner of solid.faces[face] ?? []) {
        const [cx, cy] = toCanvas(uvOf(frame, at(solid.vertices, corner)));
        const mid = TEXTURE / 2;
        const x = mid + (cx - mid) * 0.55;
        const y = mid + (cy - mid) * 0.55;
        // The number's top points at its corner.
        const angle = Math.atan2(cy - mid, cx - mid) + Math.PI / 2;
        drawText(context, labels[corner] ?? '', x, y, TEXTURE * TEXT_SIZE.d4, angle);
      }
    } else {
      const text = labels[face] ?? '';
      const size = TEXTURE * TEXT_SIZE[shape];
      const [x, y] = toCanvas([0.5, 0.5]);
      drawText(context, text, x, y, size / Math.max(1, text.length * 0.6), 0);
    }
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

function dieMesh(die: Die, labels: readonly string[], colour: Colour): Mesh {
  const solid = polyhedron(die.shape);
  const materials = solid.faces.map(
    (_, face) =>
      new MeshStandardMaterial({
        map: faceTexture(die.shape, face, labels, colour),
        roughness: 0.45,
        metalness: 0.05,
        transparent: true,
        opacity: die.active ? 1 : 0.4,
      }),
  );
  const mesh = new Mesh(geometryOf(die.shape), materials);
  mesh.castShadow = true;
  mesh.userData.opacity = die.active ? 1 : 0.4;
  return mesh;
}

interface Throw {
  dice: readonly Die[];
  simulation: Simulation;
  labels: string[][];
  group: Group | null;
  start: number;
  seconds: number;
  landed: boolean;
}

/** Sets each mesh to the recorded step. */
function pose(current: Throw, step: number): void {
  const group = current.group;
  if (!group) return;
  const count = current.dice.length;
  group.children.forEach((mesh, index) => {
    const at = (step * count + index) * STRIDE;
    const f = current.simulation.frames;
    mesh.position.set(f[at] ?? 0, f[at + 1] ?? 0, f[at + 2] ?? 0);
    mesh.quaternion.set(f[at + 3] ?? 0, f[at + 4] ?? 0, f[at + 5] ?? 0, f[at + 6] ?? 1);
  });
}

/** What each die shows on top at its last recorded step, read back from its pose. */
function shown(current: Throw): string[] {
  const { frames, steps } = current.simulation;
  const count = current.dice.length;
  return current.dice.map((die, index) => {
    const at = ((steps - 1) * count + index) * STRIDE;
    const turn = new PhysicsQuaternion(
      frames[at + 3] ?? 0,
      frames[at + 4] ?? 0,
      frames[at + 5] ?? 0,
      frames[at + 6] ?? 1,
    );
    return shownOnTop(current.labels[index] ?? [], topOf(die.shape, turn).index);
  });
}

function dispose(group: Group): void {
  for (const mesh of group.children) {
    if (!(mesh instanceof Mesh)) continue;
    for (const material of mesh.material as MeshStandardMaterial[]) {
      material.map?.dispose();
      material.dispose();
    }
  }
}

export class DiceTable {
  private readonly renderer: WebGLRenderer | null;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(FOV, 1, 1, 100);
  private current: Throw | null = null;
  private frame = 0;
  private readonly reducedMotion: boolean;

  constructor(
    private readonly host: HTMLElement,
    private readonly report: (report: Report) => void,
  ) {
    this.renderer = DiceTable.makeRenderer();
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.camera.position.set(0, CAMERA_HEIGHT, 0);
    this.camera.up.set(0, 0, -1);
    this.camera.lookAt(0, 0, 0);
    this.scene.add(new AmbientLight(0xffffff, 1.6));
    const sun = new DirectionalLight(0xffffff, 2.2);
    sun.position.set(-8, 30, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    const reach = 40;
    Object.assign(sun.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach });
    this.scene.add(sun);
    const floor = new Mesh(new PlaneGeometry(200, 200), new ShadowMaterial({ opacity: 0.22 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
    if (this.renderer) {
      host.appendChild(this.renderer.domElement);
      Object.assign(this.renderer.domElement.style, { display: 'block' });
    }
    this.resize();
    window.addEventListener('resize', this.resize);
    this.report({ state: 'idle', shown: [], drawing: this.renderer !== null });
  }

  private static makeRenderer(): WebGLRenderer | null {
    try {
      const renderer = new WebGLRenderer({ alpha: true, antialias: true });
      renderer.setClearColor(0x000000, 0);
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
      renderer.shadowMap.enabled = true;
      return renderer;
    } catch {
      // No WebGL in this browser: throws still run, so the state and results stay right.
      return null;
    }
  }

  private readonly resize = (): void => {
    const width = this.host.clientWidth || window.innerWidth;
    const height = this.host.clientHeight || window.innerHeight;
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    this.renderer?.setSize(width, height);
    this.draw();
  };

  private draw(): void {
    this.renderer?.render(this.scene, this.camera);
  }

  /** Throws the dice, replacing any throw still on the table. */
  throw(dice: readonly Die[], look: { colour: Colour; seconds: number }): void {
    if (dice.length === 0) return;
    this.clear();
    const arena = arenaFor(
      this.host.clientWidth || window.innerWidth,
      this.host.clientHeight || window.innerHeight,
    );
    const simulation = simulate(
      dice.map((die) => die.shape),
      arena,
    );
    const labels = dice.map((die, index) => labelsFor(die, simulation.tops[index] ?? 0));
    let group: Group | null = null;
    if (this.renderer) {
      group = new Group();
      dice.forEach((die, index) => {
        group?.add(dieMesh(die, labels[index] ?? [], look.colour));
      });
      this.scene.add(group);
    }
    const start = performance.now() - (this.reducedMotion ? simulation.steps * STEP * 1000 : 0);
    this.current = { dice, simulation, labels, group, start, seconds: look.seconds, landed: false };
    this.report({ state: 'rolling', shown: [], drawing: this.renderer !== null });
    this.tick();
  }

  private readonly tick = (): void => {
    cancelAnimationFrame(this.frame);
    const current = this.current;
    if (!current) return;
    const elapsed = (performance.now() - current.start) / 1000;
    const rolling = current.simulation.steps * STEP;
    const step = Math.min(current.simulation.steps - 1, Math.floor(elapsed / STEP));
    pose(current, step);
    if (!current.landed && elapsed >= rolling) {
      current.landed = true;
      this.report({ state: 'resting', shown: shown(current), drawing: this.renderer !== null });
    }
    const fading = elapsed - rolling - current.seconds;
    if (fading >= FADE_SECONDS) {
      this.clear();
      this.report({ state: 'idle', shown: [], drawing: this.renderer !== null });
      return;
    }
    if (fading > 0 && current.group) {
      for (const mesh of current.group.children) {
        if (!(mesh instanceof Mesh)) continue;
        const full = mesh.userData.opacity as number;
        for (const material of mesh.material as MeshStandardMaterial[]) {
          material.opacity = full * (1 - fading / FADE_SECONDS);
        }
      }
    }
    this.draw();
    this.frame = requestAnimationFrame(this.tick);
  };

  private clear(): void {
    cancelAnimationFrame(this.frame);
    const group = this.current?.group;
    if (group) {
      this.scene.remove(group);
      dispose(group);
    }
    this.current = null;
    this.draw();
  }

  dispose(): void {
    this.clear();
    window.removeEventListener('resize', this.resize);
    for (const geometry of geometries.values()) geometry.dispose();
    geometries.clear();
    this.renderer?.dispose();
    this.renderer?.domElement.remove();
  }
}
