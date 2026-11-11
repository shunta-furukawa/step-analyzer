// 足の接地位置 (パネルビュー用)。
// パネルの中心ではなく、「足を自然に開いて立った位置」から最短距離で
// 踏めるパネル内の点に足を置く。右パネルなら左の際、上パネルなら手前の際
// というように、中央寄りの省エネな位置になる。
// 座標は3x3グリッドのセル単位 (パネル1枚 = 1x1)。

import type { Foot } from "./chart";

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
): { lx: number; ly: number; rx: number; ry: number } {
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
