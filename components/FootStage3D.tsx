"use client";

// Three.js版の足ステージ。CSS 3D版 (Viewer内のFootStage) と同じポーズ規則で、
// 本物の透視カメラ・ライティング・影付きの見た目にする。
// 将来の動画書き出しでも同じレンダラを使えるよう、シーン構築は自己完結させる。

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { ARROW_PATH } from "@/lib/arrowShape";
import { ARROW_ROTATIONS, FOOT_COLORS, type Foot } from "@/lib/chart";

interface FootStage3DProps {
  leftPos: number;
  rightPos: number;
  stepping: number[];
  feet: (Foot | null)[];
  facing: number;
  stepKey: number;
  heldFeet: Foot[];
  oneFoot: { foot: Foot; panels: number[] } | null;
  liftedFoot: Foot | null;
}

// FootStage (CSS版) と同じグリッド座標
const STAGE_CENTERS = [
  { x: 0.5, y: 1.5 },
  { x: 1.5, y: 2.5 },
  { x: 1.5, y: 0.5 },
  { x: 2.5, y: 1.5 },
  { x: 1.5, y: 1.5 },
];

const TRAVEL_MS = 250; // 足の移動時間 (CSS版のtransitionと同じ)
const HOP_MS = 220;

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

function poseOf(p: FootStage3DProps): Pose {
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
    hopT0: -1,
  };
}

function lerpAngleDeg(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return a + d * t;
}

export default function FootStage3D(props: FootStage3DProps) {
  const sceneRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    panels: { flash: THREE.Mesh; flashMat: THREE.MeshBasicMaterial }[];
    feet: { L: FootRig; R: FootRig };
    marker: THREE.Mesh;
    markerMat: THREE.MeshBasicMaterial;
    raf: number;
    lastStepKey: number;
  } | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  // シーン構築 (マウント時に1回)
  useEffect(() => {
    const holder = sceneRef.current;
    if (!holder) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      return; // WebGL不可 (呼び出し側でフォールバック済みの想定)
    }
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor(0x000000, 0);
    holder.appendChild(renderer.domElement);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";

    const scene = new THREE.Scene();
    // 画角を狭めてカメラを遠ざけると、同じ構図のまま遠近の縮みが弱まる
    // (fov 38→20でパースの効きはおよそ半分)
    const camera = new THREE.PerspectiveCamera(20, 1, 0.1, 40);
    camera.position.set(0, 5.9, 6.85);
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
    const feetRigs = { L: makeFoot(FOOT_COLORS.L, "L"), R: makeFoot(FOOT_COLORS.R, "R") };
    scene.add(feetRigs.L.group);
    scene.add(feetRigs.R.group);

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

    // 初期ポーズを即時反映
    const p0 = poseOf(propsRef.current);
    const init = (rig: FootRig, gx: number, gy: number, rot: number) => {
      rig.cur = { x: gx2wx(gx), z: gy2wz(gy), rot, lift: 0 };
      rig.from = { ...rig.cur };
      rig.target = { ...rig.cur };
    };
    init(feetRigs.L, p0.lx, p0.ly, p0.lRot);
    init(feetRigs.R, p0.rx, p0.ry, p0.rRot);

    const st = {
      renderer,
      scene,
      camera,
      panels,
      feet: feetRigs,
      marker,
      markerMat,
      raf: 0,
      lastStepKey: propsRef.current.stepKey,
    };
    stateRef.current = st;

    // サイズ追従 (.sceneのCSSサイズに合わせる)
    const resize = () => {
      const w = holder.clientWidth;
      const h = holder.clientHeight;
      if (w === 0 || h === 0) return;
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(holder);

    // 描画ループ (小さなシーンなので常時回して単純にする)
    const tick = () => {
      const now = performance.now();
      const pr = propsRef.current;
      const pose = poseOf(pr);
      const applyFoot = (
        rig: FootRig,
        foot: Foot,
        gx: number,
        gy: number,
        rot: number
      ) => {
        const lift = pr.liftedFoot === foot ? 0.32 : 0;
        const tx = gx2wx(gx);
        const tz = gy2wz(gy);
        // ターゲットが変わったらトゥイーン開始
        if (
          Math.abs(tx - rig.target.x) > 1e-4 ||
          Math.abs(tz - rig.target.z) > 1e-4 ||
          Math.abs(rot - rig.target.rot) > 1e-4 ||
          Math.abs(lift - rig.target.lift) > 1e-4
        ) {
          rig.from = { ...rig.cur };
          rig.target = { x: tx, z: tz, rot, lift };
          rig.tweenT0 = now;
        }
        const t = Math.min(1, (now - rig.tweenT0) / TRAVEL_MS);
        const e = t * (2 - t); // ease-out
        rig.cur.x = rig.from.x + (rig.target.x - rig.from.x) * e;
        rig.cur.z = rig.from.z + (rig.target.z - rig.from.z) * e;
        rig.cur.rot = lerpAngleDeg(rig.from.rot, rig.target.rot, e);
        rig.cur.lift = rig.from.lift + (rig.target.lift - rig.from.lift) * e;
        // ホップ (踏んだ瞬間の小ジャンプ)
        let hopY = 0;
        if (rig.hopT0 >= 0) {
          const ht = (now - rig.hopT0) / HOP_MS;
          if (ht >= 1) rig.hopT0 = -1;
          else hopY = Math.sin(ht * Math.PI) * 0.16;
        }
        rig.group.position.set(rig.cur.x, rig.cur.lift + hopY, rig.cur.z);
        rig.group.rotation.y = deg2rotY(rig.cur.rot);
        const lifted = pr.liftedFoot === foot;
        rig.soleMat.opacity = lifted ? 0.6 : 1;
        rig.outlineMat.opacity = lifted ? 0.5 : 1;
        rig.labelMat.opacity = lifted ? 0.7 : 1;
        // フリーズ保持中: 枠をミント色に + 足の外側にミントのグローを脈打たせる
        // (本体の色味は変えない)
        const held = pr.heldFeet.includes(foot);
        rig.outlineMat.color.set(held ? "#00e0a0" : "#ffffff");
        rig.glow.visible = held;
        if (held) {
          rig.glowMat.opacity = 0.6 + 0.25 * Math.sin(now / 260);
        }
      };
      applyFoot(st.feet.L, "L", pose.lx, pose.ly, pose.lRot);
      applyFoot(st.feet.R, "R", pose.rx, pose.ry, pose.rRot);

      // ホップのトリガ (stepKeyが変わったフレームで踏み足に発火)
      if (pr.stepKey !== st.lastStepKey) {
        st.lastStepKey = pr.stepKey;
        const lStep =
          pr.stepping.includes(pr.leftPos) &&
          (pr.leftPos === 4 || pr.feet[pr.leftPos] === "L");
        const rStep =
          pr.stepping.includes(pr.rightPos) &&
          (pr.rightPos === 4 || pr.feet[pr.rightPos] === "R");
        if (lStep || pr.oneFoot?.foot === "L") st.feet.L.hopT0 = now;
        if (rStep || pr.oneFoot?.foot === "R") st.feet.R.hopT0 = now;
      }

      // パネルの発光 (選択中のノーツのパネル)
      for (let p = 0; p < 4; p++) {
        const active = pr.stepping.includes(p);
        const f = pr.feet[p];
        const mat = st.panels[p].flashMat;
        const targetOpacity = active ? 0.4 : 0;
        mat.opacity += (targetOpacity - mat.opacity) * 0.35;
        if (active) mat.color.set(f ? FOOT_COLORS[f] : "#ffffff");
      }

      // 体の向きマーカー (両足の中間)
      const mx = (st.feet.L.cur.x + st.feet.R.cur.x) / 2;
      const mz = (st.feet.L.cur.z + st.feet.R.cur.z) / 2;
      st.marker.position.set(mx, 0.012, mz);
      // マーカーはCSS版と同じく生のfacing (連続回転角) を使う
      st.marker.rotation.z = deg2rotY(pr.facing);

      renderer.render(scene, camera);
      st.raf = requestAnimationFrame(tick);
    };
    st.raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(st.raf);
      ro.disconnect();
      renderer.dispose();
      renderer.domElement.remove();
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          for (const m of mats) m.dispose();
        }
      });
      stateRef.current = null;
    };
    // シーンは1回だけ構築し、以降はpropsRef経由で毎フレーム追従する
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="stage3d stage3d-gl">
      <div className="scene" ref={sceneRef} />
    </div>
  );
}
