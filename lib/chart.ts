// 譜面データのパースと足割り解析のコアロジック。
// クライアント・サーバー(OG画像生成)の両方から使うため純粋なTSに保つ。

export type Foot = "L" | "R";

export interface ChartRow {
  measure: number; // 小節番号 (0-based)
  idx: number; // 小節内の行インデックス
  total: number; // 小節内の行数
  beat: number; // 曲頭からのビート位置 (1小節 = 4ビート)
  cols: string; // 4文字 (0/1/2/3/4/M)
  quant: number; // 4, 8, 12, 16, 24, 32, 48, 64
}

export interface StepEvent {
  eventIdx: number;
  row: ChartRow;
  panels: number[]; // 踏むパネル (0=←, 1=↓, 2=↑, 3=→)、昇順
}

export interface Hold {
  panel: number;
  startBeat: number;
  endBeat: number;
  roll: boolean;
}

export interface FootStep {
  feet: (Foot | null)[]; // パネルごとの足 (length 4)
  leftPos: number; // このイベント処理後の左足のパネル
  rightPos: number;
  jump: boolean;
  jack: boolean; // 縦連 (同じパネルを同じ足で連続)
  crossover: boolean; // 足が交差した状態
  doubleStep: boolean;
}

export interface ParsedChart {
  measures: string[][];
  rows: ChartRow[];
  events: StepEvent[];
  holds: Hold[];
  mines: { panel: number; beat: number }[];
  totalBeats: number;
}

export const MAX_MEASURES = 64;

const QUANTS = [4, 8, 12, 16, 24, 32, 48, 64];

export function quantOf(idx: number, total: number): number {
  for (const q of QUANTS) {
    if ((idx * q) % total === 0) return q;
  }
  return 64;
}

// DDRの慣習に合わせた色分け: 4分=赤ピンク, 8分=青, 12分=緑, 16分=黄
export const QUANT_COLORS: Record<number, string> = {
  4: "#ff5262",
  8: "#4f7dff",
  12: "#3ddc84",
  16: "#ffd23f",
  24: "#b44bff",
  32: "#ff8fd0",
  48: "#9aa3b5",
  64: "#9aa3b5",
};

// パネルの物理座標 (足の移動距離・体の向きの計算用)。0=←, 1=↓, 2=↑, 3=→
export const PANEL_COORDS = [
  { x: 0, y: 1 },
  { x: 1, y: 2 },
  { x: 1, y: 0 },
  { x: 2, y: 1 },
];

function dist(a: number, b: number): number {
  return Math.hypot(
    PANEL_COORDS[a].x - PANEL_COORDS[b].x,
    PANEL_COORDS[a].y - PANEL_COORDS[b].y
  );
}

function crossed(leftPos: number, rightPos: number): boolean {
  return PANEL_COORDS[leftPos].x > PANEL_COORDS[rightPos].x;
}

// 体の向き (度)。0=正面(奥向き)、右回りが正。左右の足の位置から求める。
// 180度捻り状態では ±180 付近になる。
export function facingDeg(leftPos: number, rightPos: number): number {
  const dx = PANEL_COORDS[rightPos].x - PANEL_COORDS[leftPos].x;
  const dy = PANEL_COORDS[rightPos].y - PANEL_COORDS[leftPos].y;
  if (dx === 0 && dy === 0) return 0;
  return Math.round((Math.atan2(dy, dx) * 180) / Math.PI);
}

/**
 * コンパクト形式の譜面文字列をパースする。
 * 形式: 小節を "-" 区切りで連結。各小節は4文字/行を改行なしで連結した [01234M] の列。
 * 例: "0001001001001000-1000010000100001" (2小節、各4分×4行)
 */
export function parseCompact(n: string): ParsedChart {
  const measureStrs = n.split("-").filter((s) => s.length > 0);
  if (measureStrs.length === 0) throw new Error("譜面データが空です");
  if (measureStrs.length > MAX_MEASURES)
    throw new Error(`小節数が多すぎます (最大${MAX_MEASURES}小節)`);

  const measures: string[][] = [];
  for (const [mi, ms] of measureStrs.entries()) {
    if (!/^[01234M]+$/.test(ms))
      throw new Error(`${mi + 1}小節目に不正な文字が含まれています`);
    if (ms.length % 4 !== 0)
      throw new Error(`${mi + 1}小節目の長さが4の倍数ではありません`);
    const rows: string[] = [];
    for (let i = 0; i < ms.length; i += 4) rows.push(ms.slice(i, i + 4));
    measures.push(rows);
  }

  const rows: ChartRow[] = [];
  for (const [mi, m] of measures.entries()) {
    for (const [ri, cols] of m.entries()) {
      rows.push({
        measure: mi,
        idx: ri,
        total: m.length,
        beat: mi * 4 + (ri / m.length) * 4,
        cols,
        quant: quantOf(ri, m.length),
      });
    }
  }

  const totalBeats = measures.length * 4;

  const events: StepEvent[] = [];
  for (const row of rows) {
    const panels: number[] = [];
    for (let c = 0; c < 4; c++) {
      const ch = row.cols[c];
      if (ch === "1" || ch === "2" || ch === "4") panels.push(c);
    }
    if (panels.length > 0) {
      events.push({ eventIdx: events.length, row, panels });
    }
  }

  const holds: Hold[] = [];
  const open: (Hold | null)[] = [null, null, null, null];
  for (const row of rows) {
    for (let c = 0; c < 4; c++) {
      const ch = row.cols[c];
      if (ch === "2" || ch === "4") {
        open[c] = { panel: c, startBeat: row.beat, endBeat: row.beat, roll: ch === "4" };
      } else if (ch === "3" && open[c]) {
        open[c]!.endBeat = row.beat;
        holds.push(open[c]!);
        open[c] = null;
      }
    }
  }
  for (const h of open) {
    if (h) {
      h.endBeat = totalBeats;
      holds.push(h);
    }
  }

  const mines: { panel: number; beat: number }[] = [];
  for (const row of rows) {
    for (let c = 0; c < 4; c++) {
      if (row.cols[c] === "M") mines.push({ panel: c, beat: row.beat });
    }
  }

  return { measures, rows, events, holds, mines, totalBeats };
}

// ビート位置を整数チケット (1ビート=48tick) に変換する。
// 足の手動指定をノーツ位置に安定して紐付けるためのキー。
export function tickOf(beat: number): number {
  return Math.round(beat * 48);
}

/**
 * 交互踏みを基本とするグリーディな足割り。
 * - 縦連 (直前と同じパネル) は同じ足
 * - ジャンプは移動距離と交差ペナルティが最小になる割り当て
 * - それ以外は直前と逆の足 (交差・振り向きもそのまま表示する)
 * - overrides でノーツ単位の手動指定 (tick → 足) を与えると、
 *   そのノーツは指定した足になり、以降はそこを起点に再計算される
 */
export function assignFeet(
  events: StepEvent[],
  overrides?: Map<number, Foot>
): FootStep[] {
  let leftPos = 0;
  let rightPos = 3;
  let lastFoot: Foot | null = null;
  let lastPanel: number | null = null;
  const out: FootStep[] = [];

  for (const ev of events) {
    const feet: (Foot | null)[] = [null, null, null, null];
    let jump = false;
    let jack = false;
    let doubleStep = false;
    const ps = ev.panels;

    if (ps.length >= 2) {
      jump = true;
      const [a, b] = ps;
      const cost = (lp: number, rp: number) =>
        dist(leftPos, lp) +
        dist(rightPos, rp) +
        (PANEL_COORDS[lp].x > PANEL_COORDS[rp].x ? 2.5 : 0) +
        (lp === 3 ? 1 : 0) +
        (rp === 0 ? 1 : 0);
      if (cost(a, b) <= cost(b, a)) {
        leftPos = a;
        rightPos = b;
      } else {
        leftPos = b;
        rightPos = a;
      }
      feet[leftPos] = "L";
      feet[rightPos] = "R";
      lastFoot = null;
      lastPanel = null;
    } else {
      const p = ps[0];
      let foot: Foot;
      const ov = overrides?.get(tickOf(ev.row.beat));
      if (ov) {
        foot = ov;
        jack = lastPanel === p && lastFoot === ov;
        doubleStep = lastFoot === ov && lastPanel !== null && lastPanel !== p;
      } else if (lastPanel === p && lastFoot !== null) {
        foot = lastFoot;
        jack = true;
      } else if (lastFoot === null) {
        // 開始直後 or ジャンプ直後: すでにそのパネルに乗っている足、なければ近い足
        if (leftPos === p) foot = "L";
        else if (rightPos === p) foot = "R";
        else if (p === 0) foot = "L";
        else if (p === 3) foot = "R";
        else foot = dist(leftPos, p) <= dist(rightPos, p) ? "L" : "R";
      } else {
        foot = lastFoot === "L" ? "R" : "L";
        doubleStep = false;
      }
      feet[p] = foot;
      if (foot === "L") leftPos = p;
      else rightPos = p;
      lastFoot = foot;
      lastPanel = p;
    }

    out.push({
      feet,
      leftPos,
      rightPos,
      jump,
      jack,
      crossover: crossed(leftPos, rightPos),
      doubleStep,
    });
  }
  return out;
}

export interface ChartStats {
  steps: number;
  jumps: number;
  jacks: number;
  crossovers: number;
}

export function statsOf(footsteps: FootStep[]): ChartStats {
  return {
    steps: footsteps.length,
    jumps: footsteps.filter((f) => f.jump).length,
    jacks: footsteps.filter((f) => f.jack).length,
    crossovers: footsteps.filter((f) => f.crossover).length,
  };
}

export const FOOT_COLORS: Record<Foot, string> = {
  L: "#ff5ca8",
  R: "#38bdf8",
};

// 各カラムの矢印の回転角 (上向き矢印を基準)
export const ARROW_ROTATIONS = [-90, 180, 0, 90]; // ←, ↓, ↑, →
