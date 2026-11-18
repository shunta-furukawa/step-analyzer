// DDR本家に寄せた矢印造形 (上向き基準、viewBox 0 0 64 64)。
// 直角に切った太い帯のシェブロン矢頭 + 太い軸、が特徴。翼先と軸尻の角は
// 丸めず、軸に平行/45度の直線で面取りする。外形は縦横とも 2〜62 の正方形。
// 外形の内側に、矢頭の帯 (一段明るい面) と軸のクリスタル2ピースを持つ。

export const ARROW_VIEWBOX = "0 0 64 64";

// シルエット (外形)
export const ARROW_PATH =
  "M32 2 L62 32 L62 36 L56 42 L50 42 L40.6 32.6 L40.6 55.9 L34.5 62 L29.5 62 L23.4 55.9 L23.4 32.6 L14 42 L8 42 L2 36 L2 32 Z";

// 矢頭の内側の帯 (外形を内側に寄せたシェブロン)
export const ARROW_INNER_PATH =
  "M32 7.4 L58.2 33.6 L58.2 34.4 L54.4 38.2 L51.6 38.2 L32 18.6 L12.4 38.2 L9.6 38.2 L5.8 34.4 L5.8 33.6 Z";

// 軸のクリスタル (上下2ピース。どちらも矢先側が尖る)
export const ARROW_CRYSTAL_UPPER =
  "M32 24.5 L36.8 29.3 L36.8 41 L32 36.2 L27.2 41 L27.2 29.3 Z";
export const ARROW_CRYSTAL_LOWER =
  "M32 39 L36.8 43.8 L36.8 54.3 L32.9 58.2 L31.1 58.2 L27.2 54.3 L27.2 43.8 Z";

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
