// Draws throws with three.js over the whole overlay frame: a camera looking straight down at an
// invisible floor the size of the frame. Each throw is simulated first, its labels changed so the
// dice land on the server's results, then played back step by step.

import {
  AmbientLight,
  BufferGeometry,
  CanvasTexture,
  DirectionalLight,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  OrthographicCamera,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from 'three';

import { printLabel, type ThrownDie } from './dice.js';
import { initialLabels, relabel, upIndex, type Labels } from './labels.js';
import {
  add,
  at,
  cross,
  dot,
  normalize,
  scale,
  shapeOf,
  sub,
  type Shape,
  type Vec3,
} from './shapes.js';
import { simulate, STEP, type Throw } from './simulate.js';

export interface StageOptions {
  diceColour: string;
  numberColour: string;
  /** 0.5–2: how large dice are on screen. */
  size: number;
  /** Seconds the dice stay once they have landed. */
  stay: number;
}

export type StageState = 'idle' | 'rolling' | 'landed' | 'unsupported';

export interface StageReport {
  state: StageState;
  /** The message being shown. */
  message: string | null;
  /** What each die shows on top once it has landed, as printed. */
  shown: string[];
}

/** Pixels per die radius at size 1. */
const PIXELS = 36;
const FADE_SECONDS = 0.6;
const DEFAULT_DICE = '#8b1e2d';
const DEFAULT_NUMBER = '#f6efe3';

/** A colour the canvas accepts, else the fallback. */
function colour(value: string, fallback: string): string {
  const context = document.createElement('canvas').getContext('2d');
  if (!context) return fallback;
  context.fillStyle = fallback;
  context.fillStyle = value;
  return context.fillStyle;
}

/** A frame of reference on a face: its centre, two axes and how far its corners reach. */
function faceFrame(shape: Shape, index: number) {
  const face = at(shape.faces, index);
  const corners = face.vertices.map((i) => at(shape.vertices, i));
  // The text's up: toward the first corner, or on a d6 toward the middle of the first edge.
  const towards =
    shape.sides === 6 ? scale(add(at(corners, 0), at(corners, 1)), 0.5) : at(corners, 0);
  const up = normalize(sub(towards, face.centre));
  const right = cross(up, face.normal);
  const reach = Math.max(...corners.map((c) => Math.hypot(...sub(c, face.centre))));
  return { face, corners, up, right, reach };
}

/** Texture coordinates of a point on a face: the face's middle is (0.5, 0.5). */
function uvOf(frame: ReturnType<typeof faceFrame>, point: Vec3): [number, number] {
  const d = sub(point, frame.face.centre);
  return [
    0.5 + dot(d, frame.right) / (2 * frame.reach),
    0.5 + dot(d, frame.up) / (2 * frame.reach),
  ];
}

function faceTexture(
  shape: Shape,
  index: number,
  labels: Labels,
  die: ThrownDie,
  options: StageOptions,
): CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (context) {
    context.fillStyle = colour(options.diceColour, DEFAULT_DICE);
    context.fillRect(0, 0, size, size);
    context.fillStyle = colour(options.numberColour, DEFAULT_NUMBER);
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    const frame = faceFrame(shape, index);
    if (shape.reads === 'vertex') {
      // A d4 prints each corner's value near that corner, its top toward the corner.
      context.font = `bold ${String(size * 0.2)}px system-ui, sans-serif`;
      const centre: [number, number] = [size / 2, size / 2];
      for (const corner of frame.face.vertices) {
        const [u, v] = uvOf(frame, at(shape.vertices, corner));
        const point: [number, number] = [u * size, (1 - v) * size];
        const dx = point[0] - centre[0];
        const dy = point[1] - centre[1];
        context.save();
        context.translate(centre[0] + dx * 0.55, centre[1] + dy * 0.55);
        context.rotate(Math.atan2(dx, -dy));
        context.fillText(String(at(labels, corner)), 0, 0);
        context.restore();
      }
    } else {
      const text = printLabel(at(labels, index), die.print, shape.sides);
      const fontSize = shape.sides === 6 ? 0.5 : shape.sides === 20 ? 0.34 : 0.38;
      context.font = `bold ${String(size * fontSize * (text.length > 2 ? 0.8 : 1))}px system-ui, sans-serif`;
      // Triangles' middles sit low in their square; nudge the text toward them.
      const lift = frame.corners.length === 3 ? size * 0.08 : shape.sides === 10 ? -size * 0.06 : 0;
      context.fillText(text, size / 2, size / 2 + lift);
    }
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** One die's mesh: a group per face, each with its own texture. */
function dieMesh(die: ThrownDie, labels: Labels, options: StageOptions): Mesh {
  const shape = shapeOf(die.sides);
  const geometry = new BufferGeometry();
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const materials: MeshStandardMaterial[] = [];
  shape.faces.forEach((face, index) => {
    const frame = faceFrame(shape, index);
    const start = positions.length / 3;
    const corners = face.vertices.map((i) => at(shape.vertices, i));
    for (let k = 1; k + 1 < corners.length; k += 1) {
      for (const corner of [at(corners, 0), at(corners, k), at(corners, k + 1)]) {
        positions.push(...corner);
        normals.push(...face.normal);
        uvs.push(...uvOf(frame, corner));
      }
    }
    geometry.addGroup(start, positions.length / 3 - start, index);
    materials.push(
      new MeshStandardMaterial({
        map: faceTexture(shape, index, labels, die, options),
        roughness: 0.45,
        metalness: 0.05,
        transparent: true,
        opacity: die.dim ? 0.45 : 1,
      }),
    );
  });
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  return new Mesh(geometry, materials);
}

function dispose(mesh: Mesh) {
  mesh.geometry.dispose();
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const material of materials) {
    if (material instanceof MeshStandardMaterial) material.map?.dispose();
    material.dispose();
  }
}

interface Playing {
  message: string;
  dice: ThrownDie[];
  meshes: Mesh[];
  run: Throw;
  shown: string[];
  started: number;
  landedAt: number | null;
}

export class Stage {
  private readonly renderer: WebGLRenderer | null;
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera();
  private readonly dice = new Group();
  private playing: Playing | null = null;
  private frame = 0;
  private options: StageOptions = {
    diceColour: DEFAULT_DICE,
    numberColour: DEFAULT_NUMBER,
    size: 1,
    stay: 3,
  };

  constructor(
    private readonly host: HTMLElement,
    private readonly report: (report: StageReport) => void,
  ) {
    let renderer: WebGLRenderer | null = null;
    try {
      renderer = new WebGLRenderer({ alpha: true, antialias: true });
    } catch {
      renderer = null;
    }
    this.renderer = renderer;
    if (!renderer) {
      report({ state: 'unsupported', message: null, shown: [] });
      return;
    }
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.domElement.style.display = 'block';
    host.append(renderer.domElement);
    this.scene.add(new AmbientLight(0xffffff, 1.4));
    const light = new DirectionalLight(0xffffff, 2.2);
    light.position.set(-6, 20, -10);
    this.scene.add(light);
    this.scene.add(this.dice);
    this.camera.position.set(0, 40, 0);
    this.camera.up.set(0, 0, -1);
    this.camera.lookAt(0, 0, 0);
    this.resize();
    report({ state: 'idle', message: null, shown: [] });
  }

  setOptions(options: StageOptions) {
    this.options = options;
    this.resize();
  }

  /** The floor in die radii, from the frame's size in pixels. */
  private bounds() {
    const pixels = PIXELS * Math.min(2, Math.max(0.5, this.options.size));
    return {
      halfWidth: Math.max(3, this.host.clientWidth / 2 / pixels),
      halfDepth: Math.max(3, this.host.clientHeight / 2 / pixels),
    };
  }

  resize() {
    if (!this.renderer) return;
    this.renderer.setSize(this.host.clientWidth, this.host.clientHeight);
    const { halfWidth, halfDepth } = this.bounds();
    Object.assign(this.camera, {
      left: -halfWidth,
      right: halfWidth,
      top: halfDepth,
      bottom: -halfDepth,
      near: 1,
      far: 100,
    });
    this.camera.updateProjectionMatrix();
    this.render();
  }

  /** Throws the dice of a message, replacing any throw still shown. */
  throw(message: string, dice: ThrownDie[], still: boolean) {
    if (!this.renderer) return;
    this.clear();
    const run = simulate(
      dice.map((die) => die.sides),
      message,
      this.bounds(),
    );
    const last = at(run.frames, run.frames.length - 1);
    const shown: string[] = [];
    const meshes = dice.map((die, i) => {
      const shape = shapeOf(die.sides);
      const quaternion = at(last, i).quaternion;
      const up = upIndex(shape, quaternion);
      const labels = relabel(shape, initialLabels(shape), up, die.label);
      shown.push(printLabel(at(labels, upIndex(shape, quaternion)), die.print, die.sides));
      const mesh = dieMesh(die, labels, this.options);
      this.dice.add(mesh);
      return mesh;
    });
    this.playing = {
      message,
      dice,
      meshes,
      run,
      shown,
      started: performance.now(),
      landedAt: null,
    };
    if (still) this.playing.started -= run.frames.length * STEP * 1000;
    this.report({ state: 'rolling', message, shown: [] });
    this.loop();
  }

  /** Removes the throw of `message`, or any throw. */
  clear(message?: string) {
    const playing = this.playing;
    if (!playing || (message !== undefined && playing.message !== message)) return;
    cancelAnimationFrame(this.frame);
    for (const mesh of playing.meshes) {
      this.dice.remove(mesh);
      dispose(mesh);
    }
    this.playing = null;
    this.render();
    this.report({ state: 'idle', message: null, shown: [] });
  }

  private loop() {
    this.frame = requestAnimationFrame((now) => {
      const playing = this.playing;
      if (!playing) return;
      const step = Math.min(
        playing.run.frames.length - 1,
        Math.floor((now - playing.started) / 1000 / STEP),
      );
      const frame = at(playing.run.frames, Math.max(0, step));
      playing.meshes.forEach((mesh, i) => {
        const { position, quaternion } = at(frame, i);
        mesh.position.set(...position);
        mesh.quaternion.set(...quaternion);
      });
      if (step === playing.run.frames.length - 1 && playing.landedAt === null) {
        playing.landedAt = now;
        this.report({ state: 'landed', message: playing.message, shown: playing.shown });
      }
      if (playing.landedAt !== null) {
        const fade = (now - playing.landedAt) / 1000 - this.options.stay;
        if (fade >= FADE_SECONDS) {
          this.clear();
          return;
        }
        if (fade > 0) this.fade(playing, 1 - fade / FADE_SECONDS);
      }
      this.render();
      this.loop();
    });
  }

  private fade(playing: Playing, amount: number) {
    playing.meshes.forEach((mesh, i) => {
      const base = at(playing.dice, i).dim ? 0.45 : 1;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) material.opacity = base * amount;
    });
  }

  private render() {
    this.renderer?.render(this.scene, this.camera);
  }

  dispose() {
    this.clear();
    this.renderer?.dispose();
    this.renderer?.domElement.remove();
  }
}
