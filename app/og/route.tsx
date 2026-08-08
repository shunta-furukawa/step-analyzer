import { ImageResponse } from "next/og";
import {
  ARROW_CRYSTAL_LOWER,
  ARROW_CRYSTAL_UPPER,
  ARROW_HEAD_STRIPE,
  ARROW_PATH,
  ARROW_VIEWBOX,
  lighten,
} from "@/lib/arrowShape";
import { decompressCompact } from "@/lib/codec-server";
import { parseOverrides } from "@/lib/edit";
import {
  ARROW_ROTATIONS,
  FOOT_COLORS,
  QUANT_COLORS,
  assignFeet,
  facingColor,
  parseCompact,
  statsOf,
  type ParsedChart,
  type FootStep,
} from "@/lib/chart";

export const runtime = "nodejs";

const W = 1200;
const H = 630;
const MAX_LANES = 4;
const INK = "#17181c";
const MINT = "#00e0a0";
const DEFAULT_BG = "#29d6a2";

// ノーツが最も密な連続laneCount小節の開始位置を選ぶ (空イントロ対策)
function bestWindow(chart: ParsedChart, laneCount: number): number {
  const counts = new Array(chart.measures.length).fill(0);
  for (const ev of chart.events) counts[ev.row.measure] += ev.panels.length;
  let best = 0;
  let bestScore = -1;
  for (let s = 0; s + laneCount <= counts.length; s++) {
    let score = 0;
    for (let i = 0; i < laneCount; i++) score += counts[s + i];
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }
  return best;
}

// Google Fontsからフォントを取得 (woff2非対応クライアントを名乗りTTFを得る)。
// モジュールスコープでキャッシュしてリクエスト毎の再取得を避ける。
const fontCache = new Map<string, Promise<ArrayBuffer | null>>();

function loadGoogleFont(family: string, text?: string): Promise<ArrayBuffer | null> {
  const key = `${family}|${text ?? ""}`;
  if (!fontCache.has(key)) {
    fontCache.set(
      key,
      (async () => {
        try {
          const url =
            `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}` +
            (text ? `&text=${encodeURIComponent(text)}` : "");
          const css = await (
            await fetch(url, { headers: { "User-Agent": "curl/8.0" } })
          ).text();
          const m = css.match(/url\((.+?)\)\s*format\('(opentype|truetype)'\)/);
          if (!m) return null;
          const res = await fetch(m[1]);
          if (!res.ok) return null;
          return await res.arrayBuffer();
        } catch {
          return null;
        }
      })()
    );
  }
  return fontCache.get(key)!;
}

// 背景色の明度から前景色 (黒/白) を選ぶ
function fgFor(bgHex: string): string {
  const r = parseInt(bgHex.slice(1, 3), 16);
  const g = parseInt(bgHex.slice(3, 5), 16);
  const b = parseInt(bgHex.slice(5, 7), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.45 ? INK : "#ffffff";
}

function OgArrow({
  size,
  rotation,
  color,
  ring,
}: {
  size: number;
  rotation: number;
  color: string;
  ring: string | null;
}) {
  return (
    <div
      style={{
        display: "flex",
        width: size + 8,
        height: size + 8,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 10,
        border: ring ? `4px solid ${ring}` : "4px solid rgba(0,0,0,0)",
      }}
    >
      <div style={{ display: "flex", transform: `rotate(${rotation}deg)` }}>
        <svg width={size - 6} height={size - 6} viewBox={ARROW_VIEWBOX}>
          <path
            d={ARROW_PATH}
            fill="none"
            stroke="#f2f5ff"
            strokeWidth="8"
            strokeLinejoin="round"
          />
          <path d={ARROW_PATH} fill={color} />
          <path
            d={ARROW_HEAD_STRIPE}
            fill="none"
            stroke={lighten(color, 0.7)}
            strokeWidth="5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path d={ARROW_CRYSTAL_UPPER} fill={lighten(color, 0.65)} />
          <path d={ARROW_CRYSTAL_LOWER} fill={lighten(color, 0.65)} />
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
  );
}

function ChartLanes({
  chart,
  footsteps,
  startMeasure,
  laneCount,
  fg,
}: {
  chart: ParsedChart;
  footsteps: FootStep[];
  startMeasure: number;
  laneCount: number;
  fg: string;
}) {
  const S = 31;
  const cell = S + 8;
  const laneInnerW = cell * 4;
  const laneH = H - 100;

  const noteMap = new Map<string, { color: string; ring: string | null }>();
  chart.events.forEach((ev, i) => {
    const step = footsteps[i];
    for (const p of ev.panels) {
      const foot = step.feet[p];
      noteMap.set(`${ev.row.measure}:${ev.row.idx}:${p}`, {
        color: QUANT_COLORS[ev.row.quant] ?? "#9aa3b5",
        ring: foot ? FOOT_COLORS[foot] : null,
      });
    }
  });

  // 体の向きの背景バンド: ノーツi-1→i をノーツiの向きの色で塗る
  const bands: { start: number; end: number; color: string }[] = [];
  chart.events.forEach((ev, i) => {
    const color = facingColor(footsteps[i].facing);
    if (!color) return;
    bands.push({
      start: i > 0 ? chart.events[i - 1].row.beat : 0,
      end: ev.row.beat,
      color,
    });
  });

  return (
    <div style={{ display: "flex", gap: 18, flexShrink: 0 }}>
      {Array.from({ length: laneCount }, (_, li) => {
        const mi = startMeasure + li;
        const rows = chart.measures[mi];
        return (
          <div
            key={mi}
            style={{
              display: "flex",
              flexDirection: "column",
              width: laneInnerW + 16,
            }}
          >
            <div
              style={{
                display: "flex",
                color: fg,
                fontSize: 18,
                fontWeight: 700,
                justifyContent: "center",
              }}
            >
              {`#${mi + 1}`}
            </div>
            <div
              style={{
                display: "flex",
                position: "relative",
                width: laneInnerW + 16,
                height: laneH,
                background: INK,
                boxShadow: "0 5px 0 rgba(0,0,0,0.28)",
                overflow: "hidden",
              }}
            >
              {bands.map((bd, bi) => {
                const m0 = mi * 4;
                const s = Math.max(bd.start, m0);
                const e = Math.min(bd.end, m0 + 4);
                if (e <= s) return null;
                const yOf = (beat: number) =>
                  8 + ((beat - m0) / 4) * (laneH - cell - 16) + S / 2;
                return (
                  <div
                    key={`b${bi}`}
                    style={{
                      display: "flex",
                      position: "absolute",
                      left: 0,
                      right: 0,
                      top: yOf(s),
                      height: yOf(e) - yOf(s),
                      background: bd.color,
                    }}
                  />
                );
              })}
              {rows.map((_, ri) => {
                const y = 8 + (ri / rows.length) * (laneH - cell - 16);
                const notes = [];
                for (let p = 0; p < 4; p++) {
                  const info = noteMap.get(`${mi}:${ri}:${p}`);
                  if (!info) continue;
                  notes.push(
                    <div
                      key={`${ri}-${p}`}
                      style={{
                        display: "flex",
                        position: "absolute",
                        left: 8 + p * cell,
                        top: y,
                      }}
                    >
                      <OgArrow
                        size={S}
                        rotation={ARROW_ROTATIONS[p]}
                        color={info.color}
                        ring={info.ring}
                      />
                    </div>
                  );
                }
                return notes;
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// STEP ANALYZERロゴ (Ultra + 黒アウトライン + 黄色押し出し) を
// 重ね置きしたテキストコピーで再現する
function Logo({ hasUltra }: { hasUltra: boolean }) {
  const layers: { dx: number; dy: number; color: string }[] = [
    { dx: 6, dy: 6, color: INK },
    { dx: 4, dy: 4, color: "#ffd400" },
    { dx: -2, dy: -2, color: INK },
    { dx: 2, dy: -2, color: INK },
    { dx: -2, dy: 2, color: INK },
    { dx: 2, dy: 2, color: INK },
    { dx: 0, dy: 0, color: "#ffffff" },
  ];
  return (
    <div style={{ display: "flex", position: "relative", width: 320, height: 44 }}>
      {layers.map((l, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            position: "absolute",
            left: l.dx,
            top: l.dy,
            color: l.color,
            fontSize: 30,
            ...(hasUltra ? { fontFamily: "Ultra" } : {}),
            whiteSpace: "nowrap",
          }}
        >
          STEP ANALYZER
        </div>
      ))}
    </div>
  );
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  let n = searchParams.get("n") ?? "";
  const d = searchParams.get("d");
  if (!n && d) {
    try {
      n = decompressCompact(d);
    } catch {
      n = "";
    }
  }
  const rawTitle = searchParams.get("t") ?? "";
  const overrides = parseOverrides(searchParams.get("f") ?? undefined);
  const cRaw = searchParams.get("c");
  const bg = cRaw && /^[0-9a-fA-F]{6}$/.test(cRaw) ? `#${cRaw.toLowerCase()}` : DEFAULT_BG;
  const fg = fgFor(bg);

  let chart: ParsedChart | null = null;
  try {
    if (n) chart = parseCompact(n);
  } catch {
    chart = null;
  }

  const footsteps = chart ? assignFeet(chart.events, overrides, chart.holds) : [];
  const stats = statsOf(footsteps);
  const laneCount = chart ? Math.min(chart.measures.length, MAX_LANES) : 0;
  const startMeasure = chart ? bestWindow(chart, laneCount) : 0;

  const hasJp = /[^\x00-\x7F]/.test(rawTitle);
  const [jpFont, ultraFont, antonFont] = await Promise.all([
    hasJp ? loadGoogleFont("Noto Sans JP:wght@700", rawTitle) : Promise.resolve(null),
    loadGoogleFont("Ultra"),
    loadGoogleFont("Anton"),
  ]);
  const title = hasJp && !jpFont ? rawTitle.replace(/[^\x00-\x7F]/g, "").trim() : rawTitle;

  const rootStyle: React.CSSProperties = {
    display: "flex",
    width: W,
    height: H,
    backgroundColor: bg,
    backgroundImage:
      "repeating-linear-gradient(115deg, rgba(255,255,255,0.07) 0px, rgba(255,255,255,0.07) 22px, rgba(0,0,0,0.05) 22px, rgba(0,0,0,0.05) 44px)",
    padding: 36,
    gap: 32,
  };
  if (jpFont) rootStyle.fontFamily = "NotoJP";

  const image = (
    <div style={rootStyle}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: 320,
          flexShrink: 0,
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          <Logo hasUltra={!!ultraFont} />
          <div
            style={{
              display: "flex",
              color: fg,
              fontSize: (title || "").length > 24 ? 28 : (title || "").length > 12 ? 34 : 42,
              fontWeight: 700,
              lineHeight: 1.3,
              marginTop: 18,
              wordBreak: "break-word",
            }}
          >
            {title || "DDR Chart"}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", gap: 8 }}>
            {[
              { num: stats.steps, label: "STEPS" },
              { num: stats.jumps, label: "JUMPS" },
              { num: stats.crossovers, label: "CROSS" },
            ].map((s) => (
              <div
                key={s.label}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  background: INK,
                  padding: "10px 18px",
                  boxShadow: "0 4px 0 rgba(0,0,0,0.28)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    color: MINT,
                    fontSize: 34,
                    ...(antonFont ? { fontFamily: "Anton" } : {}),
                    fontWeight: 700,
                  }}
                >
                  {String(s.num)}
                </div>
                <div style={{ display: "flex", color: "#9aa0a8", fontSize: 14 }}>
                  {s.label}
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 18, alignItems: "center" }}>
            {(["L", "R"] as const).map((f) => (
              <div key={f} style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <div
                  style={{
                    display: "flex",
                    width: 26,
                    height: 26,
                    borderRadius: 13,
                    background: FOOT_COLORS[f],
                    color: "#fff",
                    fontSize: 16,
                    fontWeight: 700,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {f}
                </div>
                <div style={{ display: "flex", color: fg, fontSize: 17, fontWeight: 700 }}>
                  {f === "L" ? "LEFT" : "RIGHT"}
                </div>
              </div>
            ))}
            {chart && chart.measures.length > laneCount && (
              <div style={{ display: "flex", color: fg, fontSize: 16, fontWeight: 700 }}>
                {`M${startMeasure + 1}-${startMeasure + laneCount} / ${chart.measures.length}`}
              </div>
            )}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", flex: 1, justifyContent: "flex-end" }}>
        {chart ? (
          <ChartLanes
            chart={chart}
            footsteps={footsteps}
            startMeasure={startMeasure}
            laneCount={laneCount}
            fg={fg}
          />
        ) : (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              color: fg,
              fontSize: 28,
            }}
          >
            No chart data
          </div>
        )}
      </div>
    </div>
  );

  const fonts: { name: string; data: ArrayBuffer; weight: 400 | 700; style: "normal" }[] = [];
  if (jpFont) fonts.push({ name: "NotoJP", data: jpFont, weight: 700, style: "normal" });
  if (ultraFont) fonts.push({ name: "Ultra", data: ultraFont, weight: 400, style: "normal" });
  if (antonFont) fonts.push({ name: "Anton", data: antonFont, weight: 400, style: "normal" });

  const options: ConstructorParameters<typeof ImageResponse>[1] = {
    width: W,
    height: H,
    headers: {
      "Cache-Control": "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800",
    },
  };
  if (fonts.length > 0) options.fonts = fonts;
  return new ImageResponse(image, options);
}
