// Three.js製の足ステージシーン (共有モジュール)。
// アプリのFootStage3Dコンポーネントと動画書き出しの両方から使い、
// 見た目とアニメーション規則を完全に一致させる。

import * as THREE from "three";
import { ARROW_PATH } from "./arrowShape";
import { ARROW_ROTATIONS, FOOT_COLORS, type Foot } from "./chart";

export interface FootSceneProps {
  leftPos: number;
  rightPos: number;
  stepping: number[];
  feet: (Foot | null)[];
  facing: number;
  stepKey: number;
  heldFeet: Foot[];
  oneFoot: { foot: Foot; panels: number[] } | null;
  liftedFoot: Foot | null;
  /** このステップと直前ノーツ (LR問わず) の物理的な間隔秒。
      トレイルの濃さ・減衰時間の算出に使う (省略時は既定値) */
  trailGapSec?: number | null;
}

export interface FootScene {
  canvas: HTMLCanvasElement;
  setSize(w: number, h: number, dpr?: number): void;
  /** props変更のコミット時に呼ぶ (トゥイーン・ホップの起点になる) */
  setProps(p: FootSceneProps, nowMs?: number): void;
  /** 毎フレーム呼ぶ (トゥイーンを進めて描画する) */
  frame(nowMs?: number): void;
  /** 足の軌跡 (トレイル) 表示の切り替え */
  setTrail(on: boolean): void;
  dispose(): void;
}

// FootStage (CSS版) と同じグリッド座標
const STAGE_CENTERS = [
  { x: 0.5, y: 1.5 },
  { x: 1.5, y: 2.5 },
  { x: 1.5, y: 0.5 },
  { x: 2.5, y: 1.5 },
  { x: 1.5, y: 1.5 },
];

const TRAVEL_MS = 250; // 足の移動時間の上限 (CSS版のtransitionと同じ)
const TRAVEL_MS_MIN = 90; // 高密度時の移動時間の下限
const HOP_MS = 220;

// ノーツ間隔に応じた足の移動時間。間隔が250msを切る高密度地帯では
// 足が目標に着く前に次の目標へ切り替わって中間でうろつくため、
// 片足の持ち時間 (≒間隔の2倍) に収まる速さまでトゥイーンを縮める
function travelMsOf(gapSec: number | null | undefined): number {
  if (gapSec == null) return TRAVEL_MS;
  return Math.max(TRAVEL_MS_MIN, Math.min(TRAVEL_MS, gapSec * 2 * 1000 * 0.9));
}

// 表示用の足の角度 (Viewerと同じ圧縮 + かかと正面の折り返し)
function displayFootRot(facing: number): number {
  const norm = facing % 360;
  let a = Math.abs(norm);
  const sign = Math.sign(norm);
  const heelFlip = a > 180;
  if (heelFlip) a -= 180;
  const compressed = Math.min(90, a <= 45 ? a : 45 + (a - 45) * 0.4);
  return heelFlip ? sign * (180 - compressed) : sign * compressed;
}

interface Pose {
  lx: number;
  ly: number;
  lRot: number;
  rx: number;
  ry: number;
  rRot: number;
}

function poseOf(p: FootSceneProps): Pose {
  const same = p.leftPos === p.rightPos && !p.liftedFoot;
  const rot = displayFootRot(p.facing);
  const lc = STAGE_CENTERS[p.leftPos];
  const rc = STAGE_CENTERS[p.rightPos];
  let lx = lc.x + (same ? -0.22 : 0);
  let ly = lc.y;
  let rx = rc.x + (same ? 0.22 : 0);
  let ry = rc.y;
  let lRot = rot;
  let rRot = rot;
  if (p.oneFoot) {
    const c1 = STAGE_CENTERS[p.oneFoot.panels[0]];
    const c2 = STAGE_CENTERS[p.oneFoot.panels[1]];
    const mx = (c1.x + c2.x) / 2;
    const my = (c1.y + c2.y) / 2;
    let tilt = (Math.atan2(c2.x - c1.x, c1.y - c2.y) * 180) / Math.PI;
    if (tilt > 90) tilt -= 180;
    if (tilt < -90) tilt += 180;
    if (p.oneFoot.foot === "L") {
      lx = mx;
      ly = my;
      lRot = tilt;
    } else {
      rx = mx;
      ry = my;
      rRot = tilt;
    }
  }
  if (p.liftedFoot === "L") {
    lx = 1.5 - 0.28;
    ly = 1.5;
  } else if (p.liftedFoot === "R") {
    rx = 1.5 + 0.28;
    ry = 1.5;
  }
  return { lx, ly, lRot, rx, ry, rRot };
}

// グリッド座標 → ワールド座標 (パネル間隔 = 1)
const gx2wx = (gx: number) => gx - 1.5;
const gy2wz = (gy: number) => gy - 1.5;
const deg2rotY = (deg: number) => (-deg * Math.PI) / 180;

function makeArrowTexture(rotationDeg: number): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  ctx.translate(64, 64);
  ctx.rotate((rotationDeg * Math.PI) / 180);
  ctx.scale(1.55, 1.55);
  ctx.translate(-32, -33);
  ctx.strokeStyle = "#5a6390";
  ctx.lineWidth = 5;
  ctx.lineJoin = "round";
  ctx.stroke(new Path2D(ARROW_PATH));
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  return tex;
}

function makeLabelTexture(label: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.font = "800 84px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, 64, 70);
  return new THREE.CanvasTexture(c);
}

// フリーズ保持中に足の外側へ敷くミントのグロー (放射グラデーション)
function makeGlowTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(64, 64, 18, 64, 64, 64);
  g.addColorStop(0, "rgba(0, 224, 160, 0.85)");
  g.addColorStop(0.55, "rgba(0, 224, 160, 0.35)");
  g.addColorStop(1, "rgba(0, 224, 160, 0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

// 足型 (角丸の靴底) のジオメトリ
function makeSoleGeometry(): THREE.ExtrudeGeometry {
  const w = 0.34;
  const l = 0.6;
  const r = 0.16;
  const s = new THREE.Shape();
  s.moveTo(-w / 2 + r, -l / 2);
  s.lineTo(w / 2 - r, -l / 2);
  s.absarc(w / 2 - r, -l / 2 + r, r, -Math.PI / 2, 0, false);
  s.lineTo(w / 2, l / 2 - r);
  s.absarc(w / 2 - r, l / 2 - r, r, 0, Math.PI / 2, false);
  s.lineTo(-w / 2 + r, l / 2);
  s.absarc(-w / 2 + r, l / 2 - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(-w / 2, -l / 2 + r);
  s.absarc(-w / 2 + r, -l / 2 + r, r, Math.PI, Math.PI * 1.5, false);
  const geo = new THREE.ExtrudeGeometry(s, {
    depth: 0.05,
    bevelEnabled: true,
    bevelThickness: 0.018,
    bevelSize: 0.03,
    bevelSegments: 3,
    curveSegments: 10,
  });
  geo.rotateX(-Math.PI / 2); // XZ平面に寝かせる (押し出しはY+方向)
  // ベベルがy=0より下に張り出してパネルに食い込むため、
  // 最下点をパネル表面のわずかに上へ持ち上げる
  geo.computeBoundingBox();
  geo.translate(0, -geo.boundingBox!.min.y + 0.008, 0);
  return geo;
}

interface FootRig {
  group: THREE.Group;
  sole: THREE.Mesh;
  soleMat: THREE.MeshStandardMaterial;
  outlineMat: THREE.MeshBasicMaterial;
  labelMat: THREE.MeshBasicMaterial;
  glow: THREE.Mesh;
  glowMat: THREE.MeshBasicMaterial;
  // アニメーション状態
  cur: { x: number; z: number; rot: number; lift: number };
  from: { x: number; z: number; rot: number; lift: number };
  target: { x: number; z: number; rot: number; lift: number };
  tweenT0: number;
  tweenDur: number; // このトゥイーンの所要時間 (高密度時は短くなる)
  tweenMoves: boolean; // このトゥイーンが位置移動を含むか (空中の弧を描くか)
  hopT0: number;
}

function makeFoot(color: string, label: string): FootRig {
  const group = new THREE.Group();
  const geo = makeSoleGeometry();
  const soleMat = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.5,
    metalness: 0.05,
    transparent: true,
  });
  const sole = new THREE.Mesh(geo, soleMat);
  sole.castShadow = true;
  group.add(sole);

  // 白アウトライン (反転ハル)
  const outlineMat = new THREE.MeshBasicMaterial({
    color: "#ffffff",
    side: THREE.BackSide,
    transparent: true,
  });
  const outline = new THREE.Mesh(geo, outlineMat);
  outline.scale.setScalar(1.09);
  group.add(outline);

  const labelMat = new THREE.MeshBasicMaterial({
    map: makeLabelTexture(label),
    transparent: true,
  });
  const labelMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 0.45), labelMat);
  labelMesh.rotation.x = -Math.PI / 2;
  labelMesh.position.y = 0.12;
  group.add(labelMesh);

  // フリーズ保持中のグロー (足の形に合わせて縦長の光彩を床に敷く)
  const glowMat = new THREE.MeshBasicMaterial({
    map: makeGlowTexture(),
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    opacity: 0,
  });
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.78, 1.0), glowMat);
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.005;
  glow.visible = false;
  group.add(glow);

  return {
    group,
    sole,
    soleMat,
    outlineMat,
    labelMat,
    glow,
    glowMat,
    cur: { x: 0, z: 0, rot: 0, lift: 0 },
    from: { x: 0, z: 0, rot: 0, lift: 0 },
    target: { x: 0, z: 0, rot: 0, lift: 0 },
    tweenT0: 0,
    tweenDur: TRAVEL_MS,
    tweenMoves: false,
    hopT0: -1,
  };
}

// 足の軌跡 (トレイル)。スネークゲームのしっぽのように、床に敷いた
// 帯が消えていく。足の移動アニメーション自体は等速 (250ms) なので、
// 速さの表現は「濃さ×減衰時間=一定」で行う: ノーツ間隔 (物理時間) が
// 詰まっているほど濃く短く残り、間隔が空くほど薄く長く漂って消える
const TRAIL_MAX = 120; // 保持するサンプル数の上限
const TRAIL_HALF_W = 0.13; // 頭側の帯の半幅 (ワールド単位)
// 寿命の下限。頭側 (最も濃い部分) は足の下に隠れるため、
// 高速時でも尻尾が足の外へはみ出して見える長さを確保する
const TRAIL_LIFE_MIN = 350;
const TRAIL_LIFE_MAX = 1500; // 寿命の上限ms (超スカスカでも一応視認できる程度)
// 不透明度100%に達するノーツ間隔 (BPM200の16分 = 75ms)。
// 濃さ×間隔=一定の反比例で、これより間隔が空くほど薄くなる
const TRAIL_FULL_MS = 75;
// 完全に白へ振り切るノーツ間隔 (BPM240の16分 = 62.5ms、現場観測の最速)。
// FULL〜WHITEの間は足色→白へ線形に近づく
const TRAIL_WHITE_MS = 62.5;
const TRAIL_ALPHA_MIN = 0.05; // 濃さの下限 (休符明けでも痕跡は残す)
const TRAIL_GAP_DEFAULT = 0.3; // 間隔不明時の既定 (秒)

// ノーツ間隔 (物理秒) → そのステップのトレイルパラメータ。
// whiteは0=足色そのまま、1=真っ白 (100%を超える速さの表現)
function trailParamsOf(gapSec: number | null | undefined): {
  life: number;
  a0: number;
  white: number;
} {
  const gapMs = Math.max(1, (gapSec ?? TRAIL_GAP_DEFAULT) * 1000);
  const life = Math.max(TRAIL_LIFE_MIN, Math.min(TRAIL_LIFE_MAX, gapMs));
  const a0 = Math.max(TRAIL_ALPHA_MIN, Math.min(1, TRAIL_FULL_MS / gapMs));
  // 白へのブレンドはノーツレート (1/間隔 ∝ BPM) 軸で線形に補間する。
  // 16分換算でBPM200=0%, BPM220=50%, BPM240=100% と段階的に白くなる
  const rate = 1 / gapMs;
  const white = Math.max(
    0,
    Math.min(1, (rate - 1 / TRAIL_FULL_MS) / (1 / TRAIL_WHITE_MS - 1 / TRAIL_FULL_MS))
  );
  return { life, a0, white };
}

interface TrailRig {
  mesh: THREE.Mesh;
  geo: THREE.BufferGeometry;
  pos: Float32Array;
  col: Float32Array;
  rgb: [number, number, number];
  samples: { x: number; z: number; t: number; life: number; a0: number; white: number }[];
}

function makeTrail(color: string, y: number): TrailRig {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(TRAIL_MAX * 2 * 3);
  const col = new Float32Array(TRAIL_MAX * 2 * 4);
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  // itemSize=4のcolor属性で頂点ごとのアルファを渡す (three対応済み)
  geo.setAttribute("color", new THREE.BufferAttribute(col, 4));
  const idx: number[] = [];
  for (let i = 0; i < TRAIL_MAX - 1; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  geo.setIndex(idx);
  geo.setDrawRange(0, 0);
  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = y;
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  const c = new THREE.Color(color);
  return { mesh, geo, pos, col, rgb: [c.r, c.g, c.b], samples: [] };
}

// 現在の足位置を取り込み、古いサンプルを捨ててリボンを組み立てる。
// gapSecはこのステップのノーツ間隔 (物理秒): サンプルごとに追加時点の
// 寿命・濃さを焼き込むので、密集地帯と休符明けが混在しても正しく残る
function updateTrail(
  tr: TrailRig,
  x: number,
  z: number,
  now: number,
  gapSec: number | null | undefined
) {
  const s = tr.samples;
  while (s.length > 0 && now - s[0].t > s[0].life) s.shift();
  const last = s[s.length - 1];
  if (!last || Math.hypot(x - last.x, z - last.z) > 0.012) {
    const { life, a0, white } = trailParamsOf(gapSec);
    s.push({ x, z, t: now, life, a0, white });
    if (s.length > TRAIL_MAX - 1) s.shift();
  }
  // 描画点列 = サンプル (古→新) + 現在位置 (頭)。2点未満なら非表示
  const pts: { x: number; z: number; fade: number; a0: number; white: number }[] = s.map(
    (p) => ({
      x: p.x,
      z: p.z,
      fade: Math.max(0, 1 - (now - p.t) / p.life),
      a0: p.a0,
      white: p.white,
    })
  );
  const head = s.length > 0 ? s[s.length - 1] : trailParamsOf(gapSec);
  pts.push({ x, z, fade: 1, a0: head.a0, white: head.white });
  if (pts.length < 2) {
    tr.geo.setDrawRange(0, 0);
    return;
  }
  const n = Math.min(pts.length, TRAIL_MAX);
  const off = pts.length - n;
  for (let i = 0; i < n; i++) {
    const p = pts[off + i];
    const prev = pts[Math.max(off, off + i - 1)];
    const next = pts[Math.min(pts.length - 1, off + i + 1)];
    let dx = next.x - prev.x;
    let dz = next.z - prev.z;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    // 進行方向の左右へ張り出す (尾に向かって細く・薄く)
    const hw = TRAIL_HALF_W * (0.25 + 0.75 * p.fade);
    const px = -dz * hw;
    const pz = dx * hw;
    const vi = i * 6;
    tr.pos[vi] = p.x + px;
    tr.pos[vi + 1] = 0;
    tr.pos[vi + 2] = p.z + pz;
    tr.pos[vi + 3] = p.x - px;
    tr.pos[vi + 4] = 0;
    tr.pos[vi + 5] = p.z - pz;
    const a = p.a0 * p.fade * Math.sqrt(p.fade); // 尾側の消え際をなめらかに (fade^1.5)
    // 100%超の速さは足色→白へ振る (whiteが混合率)
    const r = tr.rgb[0] + (1 - tr.rgb[0]) * p.white;
    const g = tr.rgb[1] + (1 - tr.rgb[1]) * p.white;
    const bl = tr.rgb[2] + (1 - tr.rgb[2]) * p.white;
    const ci = i * 8;
    for (const base of [ci, ci + 4]) {
      tr.col[base] = r;
      tr.col[base + 1] = g;
      tr.col[base + 2] = bl;
      tr.col[base + 3] = a;
    }
  }
  tr.geo.attributes.position.needsUpdate = true;
  tr.geo.attributes.color.needsUpdate = true;
  tr.geo.setDrawRange(0, (n - 1) * 6);
}

function lerpAngleDeg(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return a + d * t;
}

export function createFootScene(): FootScene | null {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch {
    return null; // WebGL不可 (呼び出し側でフォールバック)
  }
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  // 画角を狭めてカメラを遠ざけると、同じ構図のまま遠近の縮みが弱まる
  const camera = new THREE.PerspectiveCamera(20, 1, 0.1, 40);
  camera.position.set(0, 4.95, 5.75);
  camera.lookAt(0, -0.15, 0.1);

  scene.add(new THREE.AmbientLight(0xffffff, 0.85));
  const dir = new THREE.DirectionalLight(0xffffff, 1.6);
  dir.position.set(1.6, 4.2, 2.2);
  dir.castShadow = true;
  dir.shadow.mapSize.set(1024, 1024);
  dir.shadow.camera.left = -2.4;
  dir.shadow.camera.right = 2.4;
  dir.shadow.camera.top = 2.4;
  dir.shadow.camera.bottom = -2.4;
  dir.shadow.radius = 4;
  scene.add(dir);

  // 影受けの床
  const shadowFloor = new THREE.Mesh(
    new THREE.PlaneGeometry(8, 8),
    new THREE.ShadowMaterial({ opacity: 0.3 })
  );
  shadowFloor.rotation.x = -Math.PI / 2;
  shadowFloor.position.y = -0.001;
  shadowFloor.receiveShadow = true;
  scene.add(shadowFloor);

  // パネル
  const panels: { flash: THREE.Mesh; flashMat: THREE.MeshBasicMaterial }[] = [];
  for (let p = 0; p < 4; p++) {
    const c = STAGE_CENTERS[p];
    const g = new THREE.Group();
    g.position.set(gx2wx(c.x), 0, gy2wz(c.y));
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(0.94, 0.07, 0.94),
      new THREE.MeshStandardMaterial({ color: "#22242c", roughness: 0.92 })
    );
    base.position.y = -0.035;
    base.receiveShadow = true;
    g.add(base);
    const arrow = new THREE.Mesh(
      new THREE.PlaneGeometry(0.8, 0.8),
      new THREE.MeshBasicMaterial({
        map: makeArrowTexture(ARROW_ROTATIONS[p]),
        transparent: true,
        opacity: 0.75,
      })
    );
    arrow.rotation.x = -Math.PI / 2;
    arrow.position.y = 0.004;
    g.add(arrow);
    // 踏んだときの発光オーバーレイ
    const flashMat = new THREE.MeshBasicMaterial({
      color: "#ffffff",
      transparent: true,
      opacity: 0,
    });
    const flash = new THREE.Mesh(new THREE.PlaneGeometry(0.94, 0.94), flashMat);
    flash.rotation.x = -Math.PI / 2;
    flash.position.y = 0.006;
    g.add(flash);
    scene.add(g);
    panels.push({ flash, flashMat });
  }

  // 足
  const feet = { L: makeFoot(FOOT_COLORS.L, "L"), R: makeFoot(FOOT_COLORS.R, "R") };
  scene.add(feet.L.group);
  scene.add(feet.R.group);

  // 足の軌跡 (オプション。yを僅かにずらして左右のZファイトを防ぐ)
  let trailOn = false;
  const trails = {
    L: makeTrail(FOOT_COLORS.L, 0.014),
    R: makeTrail(FOOT_COLORS.R, 0.018),
  };
  scene.add(trails.L.mesh);
  scene.add(trails.R.mesh);

  // 体の向きマーカー (▲)
  const triShape = new THREE.Shape();
  triShape.moveTo(0, 0.11);
  triShape.lineTo(0.09, -0.07);
  triShape.lineTo(-0.09, -0.07);
  triShape.closePath();
  const markerMat = new THREE.MeshBasicMaterial({
    color: "#aab2c8",
    transparent: true,
    opacity: 0.7,
  });
  const marker = new THREE.Mesh(new THREE.ShapeGeometry(triShape), markerMat);
  marker.rotation.x = -Math.PI / 2;
  marker.position.y = 0.01;
  scene.add(marker);

  let props: FootSceneProps = {
    leftPos: 0,
    rightPos: 3,
    stepping: [],
    feet: [null, null, null, null],
    facing: 0,
    stepKey: -1,
    heldFeet: [],
    oneFoot: null,
    liftedFoot: null,
  };
  let lastStepKey = props.stepKey;
  let initialized = false;

  const setProps = (p: FootSceneProps, nowMs?: number) => {
    const now = nowMs ?? performance.now();
    props = p;
    const pose = poseOf(p);
    if (!initialized) {
      initialized = true;
      const init = (rig: FootRig, gx: number, gy: number, rot: number) => {
        rig.cur = { x: gx2wx(gx), z: gy2wz(gy), rot, lift: 0 };
        rig.from = { ...rig.cur };
        rig.target = { ...rig.cur };
      };
      init(feet.L, pose.lx, pose.ly, pose.lRot);
      init(feet.R, pose.rx, pose.ry, pose.rRot);
      lastStepKey = p.stepKey;
      return;
    }
    const retarget = (rig: FootRig, foot: Foot, gx: number, gy: number, rot: number) => {
      const lift = p.liftedFoot === foot ? 0.32 : 0;
      const tx = gx2wx(gx);
      const tz = gy2wz(gy);
      if (
        Math.abs(tx - rig.target.x) > 1e-4 ||
        Math.abs(tz - rig.target.z) > 1e-4 ||
        Math.abs(rot - rig.target.rot) > 1e-4 ||
        Math.abs(lift - rig.target.lift) > 1e-4
      ) {
        rig.from = { ...rig.cur };
        rig.target = { x: tx, z: tz, rot, lift };
        rig.tweenT0 = now;
        rig.tweenDur = travelMsOf(p.trailGapSec);
        rig.tweenMoves = Math.hypot(tx - rig.from.x, tz - rig.from.z) > 0.05;
      }
    };
    retarget(feet.L, "L", pose.lx, pose.ly, pose.lRot);
    retarget(feet.R, "R", pose.rx, pose.ry, pose.rRot);

    // ホップ (移動なしの踏みの着地バウンド) はstepKeyの変化で発火
    if (p.stepKey !== lastStepKey) {
      lastStepKey = p.stepKey;
      const lStep =
        p.stepping.includes(p.leftPos) && (p.leftPos === 4 || p.feet[p.leftPos] === "L");
      const rStep =
        p.stepping.includes(p.rightPos) && (p.rightPos === 4 || p.feet[p.rightPos] === "R");
      // 移動の着地弧が「踏み」そのものなので、直後の着地バウンドは重ねない。
      // 先読みの早着地ぶん (FOOT_EARLY) + 状態反映ラグでもはみ出さない窓にする
      const justTraveled = (rig: FootRig) =>
        rig.tweenMoves && now - rig.tweenT0 < rig.tweenDur + 200;
      if ((lStep || p.oneFoot?.foot === "L") && !justTraveled(feet.L)) feet.L.hopT0 = now;
      if ((rStep || p.oneFoot?.foot === "R") && !justTraveled(feet.R)) feet.R.hopT0 = now;
    }
  };

  const frame = (nowMs?: number) => {
    const now = nowMs ?? performance.now();
    const applyFoot = (rig: FootRig, foot: Foot) => {
      const t = Math.min(1, (now - rig.tweenT0) / rig.tweenDur);
      const e = t * (2 - t); // ease-out
      rig.cur.x = rig.from.x + (rig.target.x - rig.from.x) * e;
      rig.cur.z = rig.from.z + (rig.target.z - rig.from.z) * e;
      rig.cur.rot = lerpAngleDeg(rig.from.rot, rig.target.rot, e);
      rig.cur.lift = rig.from.lift + (rig.target.lift - rig.from.lift) * e;
      // 上下の動き: 移動中は空中の弧 (ジャストで着地)、
      // 移動なしの踏み (縦連など) は着地時の小さいバウンド
      let hopY = 0;
      if (rig.tweenMoves && t < 1) {
        hopY = Math.sin(t * Math.PI) * 0.13;
      }
      if (rig.hopT0 >= 0) {
        const ht = (now - rig.hopT0) / HOP_MS;
        if (ht >= 1) rig.hopT0 = -1;
        else hopY += Math.sin(ht * Math.PI) * 0.09;
      }
      rig.group.position.set(rig.cur.x, rig.cur.lift + hopY, rig.cur.z);
      rig.group.rotation.y = deg2rotY(rig.cur.rot);
      const lifted = props.liftedFoot === foot;
      rig.soleMat.opacity = lifted ? 0.6 : 1;
      rig.outlineMat.opacity = lifted ? 0.5 : 1;
      rig.labelMat.opacity = lifted ? 0.7 : 1;
      // フリーズ保持中: 枠をミント色に + 足の外側にミントのグローを脈打たせる
      const held = props.heldFeet.includes(foot);
      rig.outlineMat.color.set(held ? "#00e0a0" : "#ffffff");
      rig.glow.visible = held;
      if (held) {
        rig.glowMat.opacity = 0.6 + 0.25 * Math.sin(now / 260);
      }
    };
    applyFoot(feet.L, "L");
    applyFoot(feet.R, "R");

    // 足の軌跡 (床への投影。ホップの高さは含めず移動経路だけを描く)
    if (trailOn) {
      updateTrail(trails.L, feet.L.cur.x, feet.L.cur.z, now, props.trailGapSec);
      updateTrail(trails.R, feet.R.cur.x, feet.R.cur.z, now, props.trailGapSec);
    }

    // パネルの発光 (選択中のノーツのパネル)
    for (let p = 0; p < 4; p++) {
      const active = props.stepping.includes(p);
      const f = props.feet[p];
      const mat = panels[p].flashMat;
      const targetOpacity = active ? 0.4 : 0;
      mat.opacity += (targetOpacity - mat.opacity) * 0.35;
      if (active) mat.color.set(f ? FOOT_COLORS[f] : "#ffffff");
    }

    // 体の向きマーカー (両足の中間、生のfacingを使う)
    const mx = (feet.L.cur.x + feet.R.cur.x) / 2;
    const mz = (feet.L.cur.z + feet.R.cur.z) / 2;
    marker.position.set(mx, 0.012, mz);
    marker.rotation.z = deg2rotY(props.facing);

    renderer.render(scene, camera);
  };

  return {
    canvas: renderer.domElement,
    setSize(w: number, h: number, dpr = 1) {
      if (w === 0 || h === 0) return;
      renderer.setPixelRatio(dpr);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    },
    setProps,
    frame,
    setTrail(on: boolean) {
      if (on === trailOn) return;
      trailOn = on;
      for (const tr of [trails.L, trails.R]) {
        tr.samples.length = 0;
        tr.geo.setDrawRange(0, 0);
        tr.mesh.visible = on;
      }
    },
    dispose() {
      renderer.dispose();
      renderer.domElement.remove();
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          for (const m of mats) m.dispose();
        }
      });
    },
  };
}
