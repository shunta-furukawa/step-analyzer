import { useId } from "react";
import { ARROW_PATH, ARROW_VIEWBOX, darken, lighten } from "@/lib/arrowShape";

// DDR風の矢印: 斜めグラデーションの塗り + 黒縁 + 外側の白リム。
// 上向きを基準に回転させて4方向を表現する。
export default function Arrow({
  size,
  rotation,
  color,
  outline = "#10142a",
}: {
  size: number;
  rotation: number;
  color: string;
  outline?: string;
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
        <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={lighten(color, 0.55)} />
          <stop offset="45%" stopColor={color} />
          <stop offset="100%" stopColor={darken(color, 0.3)} />
        </linearGradient>
      </defs>
      <path
        d={ARROW_PATH}
        fill="none"
        stroke="#f2f5ff"
        strokeWidth={9}
        strokeLinejoin="round"
      />
      <path
        d={ARROW_PATH}
        fill={`url(#${gradId})`}
        stroke={outline}
        strokeWidth={4.5}
        strokeLinejoin="round"
      />
    </svg>
  );
}
