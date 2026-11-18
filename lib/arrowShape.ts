// DDR本家に寄せた矢印造形 (上向き基準、viewBox 0 0 64 64)。
// 直角に切った太い帯のシェブロン矢頭 + 太い軸、が特徴。翼先と軸尻の角は
// 丸めず、軸に平行/45度の直線で面取りする。
// 外形の内側に、矢頭の帯 (一段明るい面) と軸のクリスタル2ピースを持つ。

export const ARROW_VIEWBOX = "0 0 64 64";

// シルエット (外形)
export const ARROW_PATH =
  "M32 1.5 L59 28.5 L59 34.5 L53.5 40 L47.5 40 L41 33.5 L41 56 L35.5 61.5 L28.5 61.5 L23 56 L23 33.5 L16.5 40 L10.5 40 L5 34.5 L5 28.5 Z";

// 矢頭の内側の帯 (外形を内側に寄せたシェブロン)
export const ARROW_INNER_PATH =
  "M32 7.9 L54 29.9 L54 33.1 L52.1 35 L48.9 35 L32 18.1 L15.1 35 L11.9 35 L10 33.1 L10 29.9 Z";

// 軸のクリスタル (上下2ピース。どちらも矢先側が尖る)
export const ARROW_CRYSTAL_UPPER =
  "M32 23 L36.5 27.5 L36.5 40.5 L32 36 L27.5 40.5 L27.5 27.5 Z";
export const ARROW_CRYSTAL_LOWER =
  "M32 38.6 L36.5 43.1 L36.5 54.5 L33.5 57.5 L30.5 57.5 L27.5 54.5 L27.5 43.1 Z";

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
