// 特定の小節範囲だけを切り出した「クリップ」を作る。
// 変速・停止・足の手動指定をクリップの座標系 (先頭=0拍) にシフトする。

import { parseCompact, tickOf, type FootOverride } from "./chart";
import {
  bpmAtBeat,
  serializeBpmParam,
  serializeStopsParam,
  type BpmChange,
  type Stop,
} from "./timing";

export interface ClipResult {
  compact: string;
  b?: string;
  s?: string;
  f?: string;
  hl?: string;
}

function setChar(row: string, i: number, ch: string): string {
  return row.slice(0, i) + ch + row.slice(i + 1);
}

/**
 * startMeasure〜endMeasure (1始まり、両端含む) を切り出す。
 * クリップ開始をまたぐフリーズには先頭行に合成の頭 (2) を立てて、
 * 保持状態が切れないようにする。
 */
export function buildClipData(
  compact: string,
  bpms: BpmChange[],
  stops: Stop[],
  overrides: Map<number, FootOverride>,
  startMeasure: number,
  endMeasure: number,
  highlights: Set<number> = new Set()
): ClipResult {
  const measures = compact.split("-");
  const start = Math.max(1, Math.min(startMeasure, measures.length));
  const end = Math.max(start, Math.min(endMeasure, measures.length));
  const startBeat = (start - 1) * 4;
  const endBeat = end * 4;

  const clipped = measures.slice(start - 1, end);

  // クリップ開始をまたぐフリーズ: 先頭行に合成の頭を立てる
  try {
    const chart = parseCompact(compact);
    const spanning = chart.holds.filter(
      (h) => h.startBeat < startBeat - 1e-6 && h.endBeat > startBeat + 1e-6
    );
    if (spanning.length > 0 && clipped.length > 0) {
      const rows: string[] = [];
      for (let i = 0; i < clipped[0].length; i += 4) rows.push(clipped[0].slice(i, i + 4));
      for (const h of spanning) {
        if (rows[0][h.panel] === "0") {
          rows[0] = setChar(rows[0], h.panel, h.roll ? "4" : "2");
        }
      }
      clipped[0] = rows.join("");
    }
  } catch {
    // パース不能なら合成頭はあきらめてそのまま切り出す
  }

  // 変速: クリップ開始時点のBPMを初期値に、範囲内の変化をシフト
  let b: string | undefined;
  if (bpms.length > 0) {
    const entries: BpmChange[] = [{ beat: 0, bpm: bpmAtBeat(bpms, startBeat) }];
    for (const e of bpms) {
      if (e.beat > startBeat + 1e-6 && e.beat < endBeat - 1e-6) {
        entries.push({ beat: e.beat - startBeat, bpm: e.bpm });
      }
    }
    b = serializeBpmParam(entries);
  }

  // 停止: 範囲内のものをシフト
  const clippedStops: Stop[] = stops
    .filter((st) => st.beat >= startBeat - 1e-6 && st.beat < endBeat - 1e-6)
    .map((st) => ({ beat: st.beat - startBeat, sec: st.sec }));
  const s = clippedStops.length > 0 ? serializeStopsParam(clippedStops) : undefined;

  // 足の手動指定: 範囲内のtickをシフト
  const tickStart = tickOf(startBeat);
  const tickEnd = tickOf(endBeat);
  const parts: string[] = [];
  for (const [tick, foot] of [...overrides.entries()].sort((x, y) => x[0] - y[0])) {
    if (tick >= tickStart && tick < tickEnd) parts.push(`${tick - tickStart}${foot}`);
  }
  const f = parts.length > 0 ? parts.join("-") : undefined;

  // 注目ノーツ: 範囲内のtickをシフト
  const hlParts = [...highlights]
    .filter((tick) => tick >= tickStart && tick < tickEnd)
    .sort((a, b2) => a - b2)
    .map((tick) => String(tick - tickStart));
  const hl = hlParts.length > 0 ? hlParts.join("-") : undefined;

  return { compact: clipped.join("-"), b, s, f, hl };
}
