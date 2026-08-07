import { useId } from "react";
import {
  ARROW_CRYSTAL_LOWER,
  ARROW_CRYSTAL_UPPER,
  ARROW_HEAD_STRIPE,
  ARROW_PATH,
  ARROW_VIEWBOX,
  darken,
  lighten,
} from "@/lib/arrowShape";

// DDR X系の矢印: シェブロン矢頭 + 頭部ストライプ + 軸クリスタル。
// 描画順: 白リム → グラデ塗り → 装飾 → 黒縁 (装飾が縁を侵食しないよう最後に縁)
export default function Arrow({
  size,
  rotation,
  color,
  outline = "#10142a",
  detail = true,
}: {
  size: number;
  rotation: number;
  color: string;
  outline?: string;
  detail?: boolean;
}) {
  const gradId = useId();
  return (
    <svg
      width={size}
      height={size}
      viewBox={ARROW_VIEWBOX}
      style={{ transform: `rotate(${rotation}deg)`, display: "block" }}
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={lighten(color, 0.35)} />
          <stop offset="55%" stopColor={color} />
          <stop offset="100%" stopColor={darken(color, 0.35)} />
        </linearGradient>
      </defs>
      <path
        d={ARROW_PATH}
        fill="none"
        stroke="#f2f5ff"
        strokeWidth={8}
        strokeLinejoin="round"
      />
      <path d={ARROW_PATH} fill={`url(#${gradId})`} />
      {detail && (
        <>
          <path
            d={ARROW_HEAD_STRIPE}
            fill="none"
            stroke={lighten(color, 0.7)}
            strokeWidth={5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path d={ARROW_CRYSTAL_UPPER} fill={lighten(color, 0.65)} />
          <path d={ARROW_CRYSTAL_LOWER} fill={lighten(color, 0.65)} />
        </>
      )}
      <path
        d={ARROW_PATH}
        fill="none"
        stroke={outline}
        strokeWidth={4.5}
        strokeLinejoin="round"
      />
    </svg>
  );
}
