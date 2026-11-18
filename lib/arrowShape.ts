// DDR本家に寄せた矢印造形 (上向き基準、viewBox 0 0 64 64)。
// 直角に切った太い帯のシェブロン矢頭 + 太い軸 + 浅く尖る軸尻、が特徴。
// 外形の内側に、矢頭の帯 (一段明るい面) と軸のクリスタル2ピースを持つ。

export const ARROW_VIEWBOX = "0 0 64 64";

// シルエット (外形)
export const ARROW_PATH =
  "M32 1.5 L62 31.5 L50.5 43 L41 33.5 L41 57 L32 63 L23 57 L23 33.5 L13.5 43 L2 31.5 Z";

// 矢頭の内側の帯 (外形を内側に寄せたシェブロン)
export const ARROW_INNER_PATH =
  "M32 7.9 L55.6 31.5 L50.5 36.6 L32 18.1 L13.5 36.6 L8.4 31.5 Z";

// 軸のクリスタル (上下2ピース。どちらも矢先側が尖る)
export const ARROW_CRYSTAL_UPPER =
  "M32 23 L36.5 27.5 L36.5 40.5 L32 36 L27.5 40.5 L27.5 27.5 Z";
export const ARROW_CRYSTAL_LOWER =
  "M32 38.6 L36.5 43.1 L36.5 55 L32 58 L27.5 55 L27.5 43.1 Z";

// 受け皿 (ステップゾーン) の配色: 暗い面にグレーの輪郭 (本家のグレー矢印風)
export const RECEPTOR_COLORS = {
  // 面は半透明: 重なったノーツが受け皿越しに透けて見える
  fill: "rgba(20, 22, 28, 0.55)",
  stroke: "#b4bac6",
  innerFill: "rgba(58, 62, 76, 0.45)",
  innerStroke: "#70778a",
} as const;

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

// 矢頭の内側の帯の色: ノーツ色を明るいグレーへ半分寄せた、くすんだ面
export function innerTone(hex: string): string {
  const m = hex.replace("#", "");
  const c = [0, 2, 4].map((i) => parseInt(m.slice(i, i + 2), 16));
  const g = [196, 196, 206];
  return `#${c
    .map((v, i) => clamp255(v + (g[i] - v) * 0.5).toString(16).padStart(2, "0"))
    .join("")}`;
}

// 矢印1個ぶんの配色 (SVG・Canvas・OG画像で共通)
export function arrowPalette(color: string) {
  return {
    bodyTop: lighten(color, 0.06),
    bodyBottom: darken(color, 0.18),
    inner: innerTone(color),
    crystalTop: lighten(color, 0.42),
    crystalBottom: lighten(color, 0.62),
  };
}
