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
  parseCompact,
  statsOf,
  type ParsedChart,
  type FootStep,
} from "@/lib/chart";

export const runtime = "nodejs";

const W = 1200;
const H = 630;
const MAX_LANES = 4;

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

// タイトルに日本語が含まれる場合のみ、Google Fontsから必要なグリフだけのサブセットを取得する。
// 失敗した場合はASCIIのみで描画する (デフォルトフォントで足りる)。
async function loadJpFont(text: string): Promise<ArrayBuffer | null> {
  if (!/[^\x00-\x7F]/.test(text)) return null;
  try {
    const cssUrl = `https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@700&text=${encodeURIComponent(
      text
    )}`;
    const css = await (
      await fetch(cssUrl, {
        // woff2非対応の古いクライアントを名乗るとTTFのURLが返る (satoriはwoff2非対応)
        headers: { "User-Agent": "curl/8.0" },
      })
    ).text();
    const m = css.match(/url\((.+?)\)\s*format\('(opentype|truetype)'\)/);
    if (!m) return null;
    const res = await fetch(m[1]);
    if (!res.ok) return null;
    return await res.arrayBuffer();
  } catch {
    return null;
  }
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
}: {
  chart: ParsedChart;
  footsteps: FootStep[];
  startMeasure: number;
  laneCount: number;
}) {
  const S = 31;
  const cell = S + 8;
  const laneInnerW = cell * 4;
  const laneH = H - 100;

  // (measure, rowIdx) → 表示情報 のルックアップを作る
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
                color: "#8b93b5",
                fontSize: 18,
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
                background: "#131830",
                border: "2px solid #2a3160",
                borderRadius: 14,
              }}
            >
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

  const font = await loadJpFont(rawTitle);
  // フォントが取得できなければ非ASCII文字は描画できないので落とす
  const title = font ? rawTitle : rawTitle.replace(/[^\x00-\x7F]/g, "").trim();

  const rootStyle: React.CSSProperties = {
    display: "flex",
    width: W,
    height: H,
    background: "linear-gradient(135deg, #0b0e1a 0%, #141b3d 100%)",
    padding: 40,
    gap: 36,
  };
  if (font) rootStyle.fontFamily = "NotoJP";

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
          <div
            style={{
              display: "flex",
              color: "#7c5cff",
              fontSize: 26,
              fontWeight: 700,
              letterSpacing: 2,
            }}
          >
            STEP ANALYZER
          </div>
          <div
            style={{
              display: "flex",
              color: "#e6e9f5",
              fontSize: (title || "").length > 24 ? 28 : (title || "").length > 12 ? 34 : 42,
              fontWeight: 700,
              lineHeight: 1.3,
              marginTop: 14,
              wordBreak: "break-word",
            }}
          >
            {title || "DDR Chart"}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ display: "flex", gap: 12 }}>
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
                  background: "#1a2040",
                  borderRadius: 12,
                  padding: "10px 18px",
                }}
              >
                <div style={{ display: "flex", color: "#fff", fontSize: 32, fontWeight: 700 }}>
                  {String(s.num)}
                </div>
                <div style={{ display: "flex", color: "#8b93b5", fontSize: 15 }}>{s.label}</div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
            {(["L", "R"] as const).map((f) => (
              <div key={f} style={{ display: "flex", alignItems: "center", gap: 8 }}>
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
                <div style={{ display: "flex", color: "#8b93b5", fontSize: 18 }}>
                  {f === "L" ? "LEFT" : "RIGHT"}
                </div>
              </div>
            ))}
            {chart && chart.measures.length > laneCount && (
              <div style={{ display: "flex", color: "#8b93b5", fontSize: 16 }}>
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
          />
        ) : (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              color: "#8b93b5",
              fontSize: 28,
            }}
          >
            No chart data
          </div>
        )}
      </div>
    </div>
  );

  const options: ConstructorParameters<typeof ImageResponse>[1] = {
    width: W,
    height: H,
    headers: {
      "Cache-Control": "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800",
    },
  };
  if (font) {
    options.fonts = [{ name: "NotoJP", data: font, weight: 700, style: "normal" }];
  }
  return new ImageResponse(image, options);
}
