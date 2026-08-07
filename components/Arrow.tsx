// DDR風のブロック矢印。上向きを基準に回転させて4方向を表現する。
export default function Arrow({
  size,
  rotation,
  color,
  outline = "#0b0e1a",
}: {
  size: number;
  rotation: number;
  color: string;
  outline?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      style={{ transform: `rotate(${rotation}deg)`, display: "block" }}
    >
      <path
        d="M12 1.5 L22.5 12 L16 12 L16 22.5 L8 22.5 L8 12 L1.5 12 Z"
        fill={color}
        stroke={outline}
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}
