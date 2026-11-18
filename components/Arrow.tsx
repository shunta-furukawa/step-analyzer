import { useId } from "react";
import {
  ARROW_CRYSTAL_LOWER,
  ARROW_CRYSTAL_UPPER,
  ARROW_INNER_PATH,
  ARROW_PATH,
  ARROW_VIEWBOX,
  RECEPTOR_COLORS,
  arrowPalette,
} from "@/lib/arrowShape";

// DDR本家寄せの矢印: 帯シェブロンの矢頭 + 軸クリスタル。
// 描画順: 暗い縁 → 本体 (ノーツ色) → 矢頭の内側の帯 → 軸クリスタル
export default function Arrow({
  size,
  rotation,
  color,
  outline = "#07080d",
  detail = true,
}: {
  size: number;
  rotation: number;
  color: string;
  outline?: string;
  detail?: boolean;
}) {
  const id = useId();
  const pal = arrowPalette(color);
  return (
    <svg
      width={size}
      height={size}
      viewBox={ARROW_VIEWBOX}
      style={{ transform: `rotate(${rotation}deg)`, display: "block" }}
    >
      <defs>
        <linearGradient id={`${id}b`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={pal.bodyTop} />
          <stop offset="100%" stopColor={pal.bodyBottom} />
        </linearGradient>
        <linearGradient id={`${id}c`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="30%" stopColor={pal.crystalTop} />
          <stop offset="100%" stopColor={pal.crystalBottom} />
        </linearGradient>
      </defs>
      <path
        d={ARROW_PATH}
        fill="none"
        stroke={outline}
        strokeWidth={5}
        strokeLinejoin="miter"
      />
      <path
        d={ARROW_PATH}
        fill={`url(#${id}b)`}
        stroke={`url(#${id}b)`}
        strokeWidth={2}
        strokeLinejoin="miter"
      />
      {detail && (
        <>
          <path
            d={ARROW_INNER_PATH}
            fill={pal.inner}
            stroke={pal.inner}
            strokeWidth={1}
            strokeLinejoin="miter"
          />
          <path d={ARROW_CRYSTAL_UPPER} fill={`url(#${id}c)`} />
          <path d={ARROW_CRYSTAL_LOWER} fill={`url(#${id}c)`} />
        </>
      )}
    </svg>
  );
}

// 受け皿 (ステップゾーン): 暗い面にグレーの輪郭。踏んだ瞬間は足の色+白縁
export function ReceptorArrow({
  size,
  rotation,
  hitColor,
  hit,
}: {
  size: number;
  rotation: number;
  hitColor: string | null;
  hit: boolean;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={ARROW_VIEWBOX}
      style={{ transform: `rotate(${rotation}deg)` }}
    >
      <path
        d={ARROW_PATH}
        fill={hitColor ?? RECEPTOR_COLORS.fill}
        stroke={hit ? "#ffffff" : RECEPTOR_COLORS.stroke}
        strokeWidth={3}
        strokeLinejoin="miter"
      />
      {!hitColor &&
        [ARROW_INNER_PATH, ARROW_CRYSTAL_UPPER, ARROW_CRYSTAL_LOWER].map((d) => (
          <path
            key={d}
            d={d}
            fill={RECEPTOR_COLORS.innerFill}
            stroke={hit ? "#ffffff" : RECEPTOR_COLORS.innerStroke}
            strokeWidth={1.4}
            strokeLinejoin="miter"
          />
        ))}
    </svg>
  );
}
