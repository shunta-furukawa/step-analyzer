// 動的アイコン (ファビコン / apple-touch-icon / PWAアイコン)。
// c= で背景色をカスタムでき、ホーム画面追加時のアイコンが
// ページの背景色設定と揃う。s= でサイズ指定 (既定180)。

import { ImageResponse } from "next/og";
import {
  ARROW_CRYSTAL_LOWER,
  ARROW_CRYSTAL_UPPER,
  ARROW_HEAD_STRIPE,
  ARROW_PATH,
  ARROW_VIEWBOX,
} from "@/lib/arrowShape";

export const runtime = "nodejs";

const DEFAULT_BG = "#0b0e1a";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const c = searchParams.get("c");
  const bg = c && /^[0-9a-fA-F]{6}$/.test(c) ? `#${c.toLowerCase()}` : DEFAULT_BG;
  const sizeRaw = Number(searchParams.get("s") ?? 180);
  const size = Number.isFinite(sizeRaw) ? Math.max(32, Math.min(1024, sizeRaw)) : 180;
  // ファビコン用の小サイズは角丸、apple/PWA用はiOS側でマスクされるため全面塗り
  const radius = size < 150 ? Math.round(size * 0.19) : 0;
  const arrow = Math.round(size * 0.78);

  return new ImageResponse(
    (
      <div
        style={{
          width: size,
          height: size,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: bg,
          borderRadius: radius,
        }}
      >
        <div style={{ display: "flex", transform: "rotate(90deg)" }}>
          <svg width={arrow} height={arrow} viewBox={ARROW_VIEWBOX}>
            <path
              d={ARROW_PATH}
              fill="none"
              stroke="#f2f5ff"
              strokeWidth="8"
              strokeLinejoin="round"
            />
            <path d={ARROW_PATH} fill="#ff5262" />
            <path
              d={ARROW_HEAD_STRIPE}
              fill="none"
              stroke="#ffc9cf"
              strokeWidth="5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path d={ARROW_CRYSTAL_UPPER} fill="#ffc0c7" />
            <path d={ARROW_CRYSTAL_LOWER} fill="#ffc0c7" />
            <path
              d={ARROW_PATH}
              fill="none"
              stroke="#10142a"
              strokeWidth="4.5"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </div>
    ),
    {
      width: size,
      height: size,
      headers: {
        "Cache-Control": "public, max-age=86400, s-maxage=604800",
      },
    }
  );
}
