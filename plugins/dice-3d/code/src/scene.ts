// Draws thrown dice with three.js on a transparent canvas over the table page.

import {
  BufferGeometry,
  CanvasTexture,
  DirectionalLight,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  ShadowMaterial,
  SRGBColorSpace,
  WebGLRenderer,
} from 'three';

import { relabel, type DieToThrow, type Throw } from './dice.js';
import { randomFrom, simulate, STEP, type Recording, type Table } from './physics.js';
import { faceNormal, SHAPES, type Shape, type ShapeName } from './shapes.js';

export interface Look {
  colour: string;
  numbers: string;
  /** The camera's height: higher shows smaller dice. */
  height: number;
  /** Seconds the dice stay once they all landed. */
  seconds: number;
  /** Show where the dice land, without the tumble. */
  still: boolean;
}

export type State = 'idle' | 'rolling' | 'settled';

const FOV = 35;
const FADE_SECONDS = 0.6;
const DIMMED = 0.4;
/** Throws on screen at once; a new one replaces the oldest. */
const MAX_THROWS = 4;
const TEXTURE = 128;

/** Where a face's vertex `k` of `n` sits on its texture: on a circle, counter-clockwise. */
const corner = (k: number, n: number): [number, number] => {
  const angle = Math.PI / 2 + (2 * Math.PI * k) / n;
  return [0.5 + 0.5 * Math.cos(angle), 0.5 + 0.5 * Math.sin(angle)];
};

const geometries = new Map<ShapeName, BufferGeometry>();
/** A shape as triangles, a material group per face, each face's texture on a circle. */
function geometry(shape: Shape): BufferGeometry {
  const found = geometries.get(shape.name);
  if (found) return found;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const built = new BufferGeometry();
  shape.faces.forEach((face, index) => {
    const normal = faceNormal(shape.vertices, face);
    const start = positions.length / 3;
    for (let k = 1; k < face.length - 1; k += 1) {
      for (const at of [0, k, k + 1]) {
        const vertex = shape.vertices[face[at] ?? 0] ?? [0, 0, 0];
        positions.push(...vertex);
        normals.push(...normal);
        uvs.push(...corner(at, face.length));
      }
    }
    built.addGroup(start, positions.length / 3 - start, index);
  });
  built.setAttribute('position', new Float32BufferAttribute(positions, 3));
  built.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  built.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometries.set(shape.name, built);
  return built;
}

/** 6 and 9 get a line under them, as on real dice. */
const ambiguous = (label: string): boolean => label === '6' || label === '9';

function drawLabel(
  context: CanvasRenderingContext2D,
  label: string,
  x: number,
  y: number,
  size: number,
  rotation: number,
): void {
  context.save();
  context.translate(x, y);
  context.rotate(rotation);
  context.font = `bold ${String(size)}px sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(label, 0, 0);
  if (ambiguous(label)) {
    const width = context.measureText(label).width;
    context.fillRect(-width / 2, size * 0.45, width, Math.max(2, size * 0.08));
  }
  context.restore();
}

/** Text size per shape, so labels fit their faces. */
const FONT: Readonly<Record<ShapeName, number>> = {
  d4: 26,
  d6: 64,
  d8: 40,
  d10: 40,
  d12: 44,
  d20: 34,
};

export class DiceScene {
  readonly canvas: HTMLCanvasElement;
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(FOV, 1, 1, 200);
  private readonly light = new DirectionalLight(0xffffff, 2.4);
  private readonly textures = new Map<string, CanvasTexture>();
  private throws: LiveThrow[] = [];
  private frame = 0;
  private look: Look;
  private state: State = 'idle';

  constructor(
    look: Look,
    private readonly onState: (state: State) => void,
  ) {
    this.look = look;
    this.renderer = new WebGLRenderer({ alpha: true, antialias: true });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.canvas = this.renderer.domElement;
    this.canvas.style.cssText = 'display: block; width: 100%; height: 100%';
    this.scene.add(new HemisphereLight(0xffffff, 0x555555, 1.6));
    this.light.position.set(8, 30, 12);
    this.light.castShadow = true;
    this.light.shadow.mapSize.set(1024, 1024);
    this.scene.add(this.light);
    const shadows = new Mesh(new PlaneGeometry(400, 400), new ShadowMaterial({ opacity: 0.25 }));
    shadows.rotation.x = -Math.PI / 2;
    shadows.receiveShadow = true;
    this.scene.add(shadows);
    this.resize();
  }

  /** True when no dice are on screen. */
  get idle(): boolean {
    return this.throws.length === 0;
  }

  setLook(look: Look): void {
    const height = look.height !== this.look.height;
    this.look = look;
    if (height) this.resize();
  }

  /** Follows the window: the visible floor is the table the dice roll on. */
  resize(): void {
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.position.set(0, this.look.height, 0);
    this.camera.up.set(0, 0, -1);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();
    const table = this.table();
    const shadow = this.light.shadow.camera;
    shadow.left = -table.halfWidth - 4;
    shadow.right = table.halfWidth + 4;
    shadow.top = table.halfDepth + 4;
    shadow.bottom = -table.halfDepth - 4;
    shadow.updateProjectionMatrix();
    this.render();
  }

  private table(): Table {
    // Inside the view by a die's height: dice nearer the camera look farther out.
    const halfDepth = this.look.height * Math.tan((FOV * Math.PI) / 360) * 0.85;
    return { halfDepth, halfWidth: halfDepth * this.camera.aspect };
  }

  /** Throws the dice; they land on the results the server decided. */
  throw(thrown: Throw): void {
    if (thrown.dice.length === 0) return;
    const recording = simulate(
      thrown.dice.map((die) => die.shape),
      this.table(),
      randomFrom(thrown.seed),
    );
    const group = new Group();
    const meshes = thrown.dice.map((die, index) => {
      const shape = SHAPES[die.shape];
      const labels = relabel(die.labels, recording.up[index] ?? 0, die.result);
      const mesh = new Mesh(geometry(shape), this.materials(shape, labels));
      mesh.castShadow = true;
      group.add(mesh);
      return mesh;
    });
    this.scene.add(group);
    this.throws.push({
      dice: thrown.dice,
      group,
      meshes,
      recording,
      started: performance.now() - (this.look.still ? recording.frames.length * STEP * 1000 : 0),
      landed: null,
    });
    while (this.throws.length > MAX_THROWS) {
      const oldest = this.throws.shift();
      if (oldest) this.remove(oldest);
    }
    this.start();
  }

  private materials(shape: Shape, labels: readonly string[]): MeshStandardMaterial[] {
    return shape.faces.map((face, index) => {
      const texture =
        shape.readAt === 'vertex'
          ? this.texture(
              shape.name,
              face.map((vertex) => labels[vertex] ?? ''),
            )
          : this.texture(shape.name, [labels[index] ?? '']);
      return new MeshStandardMaterial({
        map: texture,
        roughness: 0.45,
        metalness: 0.05,
        transparent: true,
      });
    });
  }

  /**
   * A face's texture: its label in the middle, or for a d4 one label by each corner, upright
   * towards it, so the label at the top vertex reads the same on the three faces around it.
   */
  private texture(shape: ShapeName, labels: readonly string[]): CanvasTexture {
    const key = [shape, this.look.colour, this.look.numbers, ...labels].join('|');
    const found = this.textures.get(key);
    if (found) return found;
    const canvas = document.createElement('canvas');
    canvas.width = TEXTURE;
    canvas.height = TEXTURE;
    const context = canvas.getContext('2d');
    if (context) {
      context.fillStyle = this.look.colour;
      context.fillRect(0, 0, TEXTURE, TEXTURE);
      context.fillStyle = this.look.numbers;
      const size = FONT[shape];
      if (labels.length === 1) {
        drawLabel(context, labels[0] ?? '', TEXTURE / 2, TEXTURE / 2, size, 0);
      } else {
        labels.forEach((label, k) => {
          const angle = Math.PI / 2 + (2 * Math.PI * k) / labels.length;
          const x = TEXTURE / 2 + 0.27 * TEXTURE * Math.cos(angle);
          const y = TEXTURE / 2 - 0.27 * TEXTURE * Math.sin(angle);
          drawLabel(context, label, x, y, size, Math.PI / 2 - angle);
        });
      }
    }
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = 4;
    this.textures.set(key, texture);
    return texture;
  }

  private start(): void {
    if (this.frame === 0) this.frame = requestAnimationFrame(this.tick);
  }

  private readonly tick = (now: number): void => {
    this.frame = 0;
    for (const live of [...this.throws]) this.advance(live, now);
    this.render();
    const next: State =
      this.throws.length === 0
        ? 'idle'
        : this.throws.some((live) => live.landed === null)
          ? 'rolling'
          : 'settled';
    if (next !== this.state) {
      this.state = next;
      this.onState(next);
    }
    if (this.throws.length > 0) this.start();
  };

  private advance(live: LiveThrow, now: number): void {
    const { frames } = live.recording;
    const step = Math.min(frames.length - 1, Math.floor((now - live.started) / 1000 / STEP));
    const frame = frames[Math.max(0, step)];
    if (frame) {
      live.meshes.forEach((mesh, index) => {
        const at = index * 7;
        mesh.position.set(frame[at] ?? 0, frame[at + 1] ?? 0, frame[at + 2] ?? 0);
        mesh.quaternion.set(
          frame[at + 3] ?? 0,
          frame[at + 4] ?? 0,
          frame[at + 5] ?? 0,
          frame[at + 6] ?? 1,
        );
      });
    }
    if (live.landed === null && step >= frames.length - 1) {
      live.landed = now;
      live.meshes.forEach((mesh, index) => {
        if (!live.dice[index]?.active) setOpacity(mesh, DIMMED);
      });
    }
    if (live.landed === null) return;
    const fading = (now - live.landed) / 1000 - this.look.seconds;
    if (fading >= FADE_SECONDS) {
      this.remove(live);
      return;
    }
    if (fading > 0) {
      const left = 1 - fading / FADE_SECONDS;
      live.meshes.forEach((mesh, index) => {
        setOpacity(mesh, (live.dice[index]?.active ? 1 : DIMMED) * left);
      });
    }
  }

  private remove(live: LiveThrow): void {
    this.throws = this.throws.filter((other) => other !== live);
    this.scene.remove(live.group);
    for (const mesh of live.meshes) for (const material of mesh.material) material.dispose();
  }

  private render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    if (this.frame !== 0) cancelAnimationFrame(this.frame);
    for (const live of [...this.throws]) this.remove(live);
    for (const texture of this.textures.values()) texture.dispose();
    for (const built of geometries.values()) built.dispose();
    geometries.clear();
    this.renderer.dispose();
  }
}

interface LiveThrow {
  dice: readonly DieToThrow[];
  group: Group;
  meshes: Mesh<BufferGeometry, MeshStandardMaterial[]>[];
  recording: Recording;
  started: number;
  /** When the last die came to rest. */
  landed: number | null;
}

function setOpacity(mesh: Mesh<BufferGeometry, MeshStandardMaterial[]>, opacity: number): void {
  for (const material of mesh.material) material.opacity = opacity;
}
