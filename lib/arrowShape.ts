// DDR風矢印のシルエット (上向き基準、viewBox 0 0 64 64)。
// 返し付きの矢頭 + 尾部のV字ノッチが特徴。回転させて4方向に使う。
export const ARROW_PATH =
  "M32 2 L60 30 L43 30 L43 62 L32 51 L21 62 L21 30 L4 30 Z";

export const ARROW_VIEWBOX = "0 0 64 64";

function clamp255(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function mix(hex: string, target: number, t: number): string {
  const m = hex.replace("#", "");
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  const f = (c: number) => clamp255(c + (target - c) * t).toString(16).padStart(2, "0");
  return `#${f(r)}${f(g)}${f(b)}`;
}

// 白方向に混ぜる (ハイライト用)
export function lighten(hex: string, t: number): string {
  return mix(hex, 255, t);
}

// 黒方向に混ぜる (シャドウ用)
export function darken(hex: string, t: number): string {
  return mix(hex, 0, t);
}
