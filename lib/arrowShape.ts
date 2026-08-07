// DDR X系の矢印造形 (上向き基準、viewBox 0 0 64 64)。
// 全幅シェブロンの矢頭 + 丸い翼先 + 下向きに尖る軸、が特徴。
// シルエットに加えて頭部ストライプ・軸クリスタルの装飾パスを持つ。

export const ARROW_VIEWBOX = "0 0 64 64";

// シルエット (外形)
export const ARROW_PATH =
  "M32 2 L61 31 L61 37 L53 45 L47 45 L43 41 L43 54 L32 64 L21 54 L21 41 L17 45 L11 45 L3 37 L3 31 Z";

// 頭部内側のシェブロンストライプ (ポリライン、strokeで描く)
export const ARROW_HEAD_STRIPE = "M10 34 L32 12 L54 34";

// 軸のクリスタル (上下2ピース、間にシェブロンの切れ目)
export const ARROW_CRYSTAL_UPPER =
  "M32 26 L38 32 L38 43 L32 49 L26 43 L26 32 Z";
export const ARROW_CRYSTAL_LOWER = "M32 50 L37 55 L32 60 L27 55 Z";

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
