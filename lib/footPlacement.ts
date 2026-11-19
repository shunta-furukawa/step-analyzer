// 足の接地位置 (パネルビュー用)。
// パネルの中心ではなく、「足を自然に開いて立った位置」から最短距離で
// 踏めるパネル内の点に足を置く。右パネルなら左の際、上パネルなら手前の際
// というように、中央寄りの省エネな位置になる。
// 座標は3x3グリッドのセル単位 (パネル1枚 = 1x1)。

import type { Foot, FootStep } from "./chart";

export interface FootPlace {
  lx: number;
  ly: number;
  rx: number;
  ry: number;
  // 足ごとの向き (度。0=正面、+90=つま先が右)。未指定なら体の向きに従う
  lRot?: number;
  rRot?: number;
}

// 3x3グリッド上のパネル中心座標
export const STAGE_CENTERS = [
  { x: 0.5, y: 1.5 },
  { x: 1.5, y: 2.5 },
  { x: 1.5, y: 0.5 },
  { x: 2.5, y: 1.5 },
  { x: 1.5, y: 1.5 }, // 4 = 中央 (ショックの中央空打ち)
];

// 自然に立ったときの足の中心 (中央パネル上で左右に開く)
const NEUTRAL_HALF_GAP = 0.28;
export const NEUTRAL = {
  L: { x: 1.5 - NEUTRAL_HALF_GAP, y: 1.5 },
  R: { x: 1.5 + NEUTRAL_HALF_GAP, y: 1.5 },
};

// 足の中心をパネルの際からどれだけ内側に入れるか。
// 靴底の半幅 (0.17) より少し大きく、横方向は足がパネルに収まる
const EDGE_INSET = 0.2;
// 同じパネルに両足を置くときの足の中心間隔
const SAME_PANEL_GAP = 0.44;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function nearestOnPanel(foot: Foot, panel: number): { x: number; y: number } {
  const c = STAGE_CENTERS[panel];
  const n = NEUTRAL[foot];
  const r = 0.5 - EDGE_INSET;
  return { x: clamp(n.x, c.x - r, c.x + r), y: clamp(n.y, c.y - r, c.y + r) };
}

export function footPlacement(
  leftPos: number,
  rightPos: number,
  liftedFoot: Foot | null
): FootPlace {
  const l = nearestOnPanel("L", leftPos);
  const r = nearestOnPanel("R", rightPos);
  // 同じパネルに両足: 重ならない間隔まで左右に開き、パネル内に収め直す
  if (leftPos === rightPos && !liftedFoot && r.x - l.x < SAME_PANEL_GAP) {
    const c = STAGE_CENTERS[leftPos];
    const lo = c.x - (0.5 - EDGE_INSET);
    const hi = c.x + (0.5 - EDGE_INSET) - SAME_PANEL_GAP;
    l.x = clamp((l.x + r.x) / 2 - SAME_PANEL_GAP / 2, lo, Math.max(lo, hi));
    r.x = l.x + SAME_PANEL_GAP;
  }
  // 持ち替えで解放された足は、次に踏むまで中央 (ニュートラル位置) に浮かせる
  if (liftedFoot === "L") Object.assign(l, NEUTRAL.L);
  if (liftedFoot === "R") Object.assign(r, NEUTRAL.R);
  return { lx: l.x, ly: l.y, rx: r.x, ry: r.y };
}

// 表示用の足の角度。内部のfacingは「両足を結ぶ線」由来の解析角だが、
// 画面が正面にあるので実際の体と足は正面を保とうとする。そのため
// 解析角を半分に圧縮して表示する (45°→22.5°, 90°→45°, 上限は真横)。
// 180°超のイレギュラー帯は「かかとを正面に向けて捻りを受ける」解釈で、
// つま先を後ろ側へ折り返す
export function displayFootRot(facing: number): number {
  const norm = facing % 360;
  let a = Math.abs(norm);
  const sign = Math.sign(norm);
  const heelFlip = a > 180;
  if (heelFlip) a -= 180;
  const compressed = Math.min(90, a * 0.5);
  return heelFlip ? sign * (180 - compressed) : sign * compressed;
}

// ===== 捻り (交差) の補正 =====
// 足を交差して反対側の横パネルを踏むときは、なるべく体を捻らずに済む位置を狙う。
// 例: 右足が↑にいて左足で→を踏むなら、→パネルの左下の角にかかとだけを乗せ、
// 足の残りは中央パネル側へはみ出させる (足全体をパネルに乗せに行かない)。

// 接地点 (かかと or つま先) を角からどれだけ内側に入れるか
const CORNER_INSET = 0.12;
// 足の中心から接地点 (かかと/つま先) までの距離 (靴底の半長0.3より少し内側)
const END_OFFSET = 0.22;

function twistPoint(
  foot: Foot,
  panel: number,
  other: { x: number; y: number },
  facing: number
): { x: number; y: number } {
  const c = STAGE_CENTERS[panel];
  const r = 0.5 - CORNER_INSET;
  // 接地点: 中央パネル側の際で、前後はもう片方の足から遠い側の角
  // (両足を結ぶ線が横向きに近づき、捻りが最小になる)
  const cx = c.x + (c.x > 1.5 ? -r : r);
  const cy = c.y + (other.y < 1.5 ? r : -r);
  // 足の向き (つま先方向)。かかと/つま先のうち、足の中心が自然な立ち位置に
  // 近く残るほうを接地点に合わせる
  const rot = (displayFootRot(facing) * Math.PI) / 180;
  const tx = Math.sin(rot) * END_OFFSET;
  const ty = -Math.cos(rot) * END_OFFSET;
  const n = NEUTRAL[foot];
  const heel = { x: cx + tx, y: cy + ty }; // かかとを接地点に置いたときの足の中心
  const toe = { x: cx - tx, y: cy - ty }; // つま先を置いたとき
  return Math.hypot(heel.x - n.x, heel.y - n.y) <= Math.hypot(toe.x - n.x, toe.y - n.y)
    ? heel
    : toe;
}

// ===== 横パネルでの踏み替え (スイッチ) =====
// ←や→に両足を乗せて踏み替えるときは、パネルの上に並んで立つのではなく、
// 足先だけ (かかと or つま先) を中央寄りの際に乗せて最小限の動きで取る。
// 足の本体は中央パネル側へはみ出す。
//
// かかとで取るか、つま先で取るかは「つま先は体の向きに従う」で決まる:
//  - 踏み替えの前後が交差 (体を90度より大きく捻る) なら、つま先はその
//    捻りの向きを向く。つま先がパネル側 (外) を向くならつま先で、
//    中央側を向くならかかとで取ることになる
//    例) ←で踏み替えたあと左足を↓へ (左へ捻る) → つま先 / ↑へ (右へ捻る) → かかと
//  - 前後とも交差でない (ほぼ正面のまま) なら、つま先を中央寄りへ開いて
//    かかとで取る

// 踏み替え中のつま先の開き。真横 (90度) だと体ごと横を向いた立ち方に
// なるので、正面のままの踏み替えは少し前へ開いた角度にする
const SIDE_SWITCH_ROT = 60;
// 接地点 (かかと/つま先) をパネルの際からどれだけ内側に入れるか。
// 並んだ両足の接地点がどちらもパネルに乗る深さ
const SIDE_SWITCH_INSET = 0.2;
// 表示角 (解析角の半分) がこれを超えたら交差とみなす (解析角で90度超)
const CROSSED_DISPLAY_ROT = 45;

/** 踏み替え中のつま先の向き (度)。前後の「両足が別パネルの状態」の体の向きから決める */
function sideSwitchRot(panel: 0 | 3, prevFacing: number | null, nextFacing: number | null): number {
  const towardCenter = panel === 0 ? SIDE_SWITCH_ROT : -SIDE_SWITCH_ROT;
  // 捻りが大きいほうに合わせる (同程度ならこれから向かう側を優先)
  const cands = [nextFacing, prevFacing]
    .filter((f): f is number => f !== null)
    .map(displayFootRot);
  let rot = 0;
  for (const c of cands) if (Math.abs(c) > Math.abs(rot) + 1e-6) rot = c;
  if (Math.abs(rot) <= CROSSED_DISPLAY_ROT) return towardCenter;
  return Math.sign(rot) * Math.max(SIDE_SWITCH_ROT, Math.min(90, Math.abs(rot)));
}

function sideSwitchPlace(panel: 0 | 3, rot: number): FootPlace {
  const left = panel === 0;
  const rad = (rot * Math.PI) / 180;
  const dx = Math.sin(rad); // つま先方向
  const dy = -Math.cos(rad);
  const nx = Math.cos(rad); // 足の右手方向 (両足はこの方向に並ぶ)
  const ny = Math.sin(rad);
  const cx = left ? 1 - SIDE_SWITCH_INSET : 2 + SIDE_SWITCH_INSET;
  // つま先がパネル側 (外) を向くならつま先、中央側ならかかとを接地点に置く
  const toeOut = left ? dx < 0 : dx > 0;
  const k = toeOut ? -END_OFFSET : END_OFFSET;
  const bx = cx + dx * k;
  const by = 1.5 + dy * k;
  const g = SAME_PANEL_GAP / 2 + 0.04; // 並んだ足が触れない間隔
  return {
    lx: bx - nx * g,
    ly: by - ny * g,
    rx: bx + nx * g,
    ry: by + ny * g,
    lRot: rot,
    rRot: rot,
  };
}

/** 足割り結果の各ステップに足の接地位置 (place) を書き込む。
    ステップ順にたどり、そのステップで動かした足だけを置き直す
    (踏んでいない足は、もう片方の足が動いても滑らせない) */
export function attachPlacements(steps: FootStep[]): void {
  // 各ステップの前後で、両足が別パネルにある直近の状態の体の向き
  // (同じパネルでの踏み替え中の足の向きを決めるのに使う)
  const open = (st: FootStep) => st.leftPos !== st.rightPos && !st.liftedFoot;
  const prevOpen: (number | null)[] = [];
  let last: number | null = null;
  for (const st of steps) {
    prevOpen.push(last);
    if (open(st)) last = st.facing;
  }
  const nextOpen: (number | null)[] = new Array(steps.length).fill(null);
  last = null;
  for (let i = steps.length - 1; i >= 0; i--) {
    nextOpen[i] = last;
    if (open(steps[i])) last = steps[i].facing;
  }

  let prev: FootStep | null = null;
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const base = footPlacement(s.leftPos, s.rightPos, s.liftedFoot);
    const place = { ...base };
    const samePanel = s.leftPos === s.rightPos;
    const moved = (f: Foot) => {
      if (!prev || !prev.place || samePanel || prev.leftPos === prev.rightPos) return true;
      const key = f === "L" ? "leftPos" : "rightPos";
      return (
        prev[key] !== s[key] ||
        s.feet.includes(f) ||
        s.liftedFoot === f ||
        prev.liftedFoot === f
      );
    };
    const lMoved = moved("L");
    const rMoved = moved("R");
    if (!lMoved && prev?.place) {
      place.lx = prev.place.lx;
      place.ly = prev.place.ly;
    }
    if (!rMoved && prev?.place) {
      place.rx = prev.place.rx;
      place.ry = prev.place.ry;
    }
    const vertical = (panel: number) => panel === 1 || panel === 2;
    if (!s.liftedFoot && !s.stretch) {
      if (lMoved && s.leftPos === 3 && vertical(s.rightPos)) {
        const t = twistPoint("L", 3, { x: place.rx, y: place.ry }, s.facing);
        place.lx = t.x;
        place.ly = t.y;
      } else if (rMoved && s.rightPos === 0 && vertical(s.leftPos)) {
        const t = twistPoint("R", 0, { x: place.lx, y: place.ly }, s.facing);
        place.rx = t.x;
        place.ry = t.y;
      }
    }
    if (samePanel && !s.liftedFoot && !s.stretch && (s.leftPos === 0 || s.leftPos === 3)) {
      const rot = sideSwitchRot(s.leftPos, prevOpen[i], nextOpen[i]);
      Object.assign(place, sideSwitchPlace(s.leftPos, rot));
    }
    s.place = place;
    prev = s;
  }
}
