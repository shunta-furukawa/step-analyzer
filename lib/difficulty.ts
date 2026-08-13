// 難易度メタ情報。5段階クラス (習/楽/踊/激/鬼 相当) は文字ではなく
// 色で表現し、1-20スケールの数字を併記する。
// アイコンは足あとをSVG/canvas両対応の楕円群として持つ。

// クラス色 (習=水色 / 楽=黄 / 踊=赤 / 激=緑 / 鬼=紫)
export const DIFF_COLORS = ["#4fc8f0", "#f9a825", "#ff5252", "#2fd66a", "#c04df0"];

type FootCircle = { cx: number; cy: number; r: number };
type FootEllipse = { cx: number; cy: number; rx: number; ry: number; rot: number };
export type FootBlob = FootCircle | FootEllipse;

// 足あとアイコン (24x24ボックス、右足)。足裏+かかと+指5本
export const FOOT_BLOBS: FootBlob[] = [
  { cx: 11.6, cy: 11.4, rx: 5.6, ry: 6.0, rot: -0.1 },
  { cx: 12.9, cy: 18.4, rx: 3.4, ry: 3.9, rot: -0.12 },
  { cx: 6.3, cy: 4.6, r: 2.6 },
  { cx: 10.6, cy: 3.1, r: 1.7 },
  { cx: 14.0, cy: 3.3, r: 1.5 },
  { cx: 17.1, cy: 4.2, r: 1.35 },
  { cx: 19.5, cy: 5.9, r: 1.2 },
];

export function isFootCircle(b: FootBlob): b is FootCircle {
  return "r" in b;
}

/** dfパラメータ ("318"=クラス3のLv18、"x17"=クラスなしLv17、"2"=クラスのみ) */
export function parseDiffParam(v?: string): { cls: number | null; lvl: string } {
  const m = v?.match(/^([0-4x])([0-9]{0,2})$/);
  if (!m) return { cls: null, lvl: "" };
  return { cls: m[1] === "x" ? null : Number(m[1]), lvl: m[2] };
}

export function serializeDiff(cls: number | null, lvl: string): string {
  if (cls === null && !lvl) return "";
  return `${cls ?? "x"}${lvl}`;
}

/** SM/SSCの難易度表記を5段階クラスへ (対応しない表記はnull) */
export function diffClassFromSm(difficulty: string): number | null {
  const d = difficulty.toLowerCase();
  if (d.includes("beginner")) return 0;
  if (["challenge", "smaniac", "oni"].some((k) => d.includes(k))) return 4;
  if (["easy", "basic", "light"].some((k) => d.includes(k))) return 1;
  if (["medium", "standard", "trick", "another", "difficult"].some((k) => d.includes(k)))
    return 2;
  if (["hard", "heavy", "maniac", "expert"].some((k) => d.includes(k))) return 3;
  return null;
}

/** SMのメーター表記を表示用レベル文字列へ */
export function diffLevelFromSm(meter: string): string {
  const n = parseInt(meter, 10);
  return Number.isFinite(n) && n > 0 ? String(Math.min(99, n)) : "";
}

/**
 * canvasへ足あとアイコンを描く (x,yは左上、sizeは24pxボックスの拡大サイズ)。
 * outline指定時は全パーツをその色で太らせて下描きし、縁取りの
 * シルエットを作る (背景色とクラス色が近くても視認できるように)
 */
export function drawDiffFoot(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
  outline?: string
) {
  const s = size / 24;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  const trace = (b: FootBlob) => {
    ctx.beginPath();
    if (isFootCircle(b)) ctx.arc(b.cx, b.cy, b.r, 0, Math.PI * 2);
    else ctx.ellipse(b.cx, b.cy, b.rx, b.ry, b.rot, 0, Math.PI * 2);
  };
  if (outline) {
    ctx.fillStyle = outline;
    ctx.strokeStyle = outline;
    ctx.lineWidth = 3;
    ctx.lineJoin = "round";
    for (const b of FOOT_BLOBS) {
      trace(b);
      ctx.fill();
      ctx.stroke();
    }
  }
  ctx.fillStyle = color;
  for (const b of FOOT_BLOBS) {
    trace(b);
    ctx.fill();
  }
  ctx.restore();
}
