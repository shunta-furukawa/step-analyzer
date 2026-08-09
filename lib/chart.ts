// 譜面データのパースと足割り解析のコアロジック。
// クライアント・サーバー(OG画像生成)の両方から使うため純粋なTSに保つ。

export type Foot = "L" | "R";

// 手動の踏み足指定。L/R = その足で踏む (ジャンプでは若い番号のパネル側)。
// LL/RR = 2枚抜き (ジャンプの2パネルを片足だけでまとめて踏む)
export type FootOverride = Foot | "LL" | "RR";

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
  oneFootJump: boolean; // 2枚抜き (ジャンプを片足で取る)
  heldFeet: Foot[]; // このイベント時点でフリーズ保持中の足
  facing: number; // 譜面開始からの連続回転角 (負=左向き, 正=右向き)
}

export interface ParsedChart {
  measures: string[][];
  rows: ChartRow[];
  events: StepEvent[];
  holds: Hold[];
  mines: { panel: number; beat: number }[];
  shocks: ChartRow[]; // ショックアロー (全パネル同時M。踏んではいけない)
  totalBeats: number;
}

export const MAX_MEASURES = 256;

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

// 直前の連続角度に最も近い等価角を選ぶ (±180境界の巻き戻り防止)
function unwrapDeg(target: number, prev: number): number {
  let f = target;
  while (f - prev > 180) f -= 360;
  while (prev - f > 180) f += 360;
  return f;
}

// 累積回転の上限。±180 (完全に後ろ向き) までは正解、それを超える回転は
// 物理的に無理な足順とみなして踏み替えで解消する
const MAX_ROTATION = 180.5;

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

  // 全パネル同時のMはショックアロー、それ以外のMは単独地雷として扱う
  const mines: { panel: number; beat: number }[] = [];
  const shocks: ChartRow[] = [];
  for (const row of rows) {
    if (row.cols === "MMMM") {
      shocks.push(row);
      continue;
    }
    for (let c = 0; c < 4; c++) {
      if (row.cols[c] === "M") mines.push({ panel: c, beat: row.beat });
    }
  }

  return { measures, rows, events, holds, mines, shocks, totalBeats };
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
 * - holds を渡すと、フリーズ保持中の足はロックされ、その間のノーツは
 *   もう片方の足に割り当てられる。フリーズ開始の足も保持中のノーツの
 *   配置から踏みやすい側を選ぶ
 */
export function assignFeet(
  events: StepEvent[],
  overrides?: Map<number, FootOverride>,
  holds?: Hold[]
): FootStep[] {
  let leftPos = 0;
  let rightPos = 3;
  let lastFoot: Foot | null = null;
  let lastPanel: number | null = null;
  const out: FootStep[] = [];

  // フリーズの開始位置 → Hold と、保持中に踏む他ノーツのx平均 (踏みやすい側の判定用)
  const holdByStart = new Map<string, Hold>();
  const duringX = new Map<string, number | null>();
  for (const h of holds ?? []) {
    const key = `${tickOf(h.startBeat)}:${h.panel}`;
    holdByStart.set(key, h);
    let sum = 0;
    let cnt = 0;
    for (const ev of events) {
      if (ev.row.beat > h.startBeat + 1e-6 && ev.row.beat < h.endBeat - 1e-6) {
        for (const p of ev.panels) {
          sum += PANEL_COORDS[p].x;
          cnt++;
        }
      }
    }
    duringX.set(key, cnt > 0 ? sum / cnt : null);
  }

  // 現在保持中のフリーズ。テール拍のノーツも保持足では踏めないため、
  // ロックは endBeat を含む (beat <= endBeat の間有効)
  let active: { panel: number; endBeat: number; foot: Foot }[] = [];
  // 譜面開始からの連続回転角 (±180を超える回転は禁止)
  let contFacing = 0;

  for (const ev of events) {
    const beat = ev.row.beat;
    active = active.filter((a) => beat <= a.endBeat + 1e-6);
    const lockedL = active.some((a) => a.foot === "L");
    const lockedR = active.some((a) => a.foot === "R");

    const feet: (Foot | null)[] = [null, null, null, null];
    let jump = false;
    let jack = false;
    let doubleStep = false;
    let oneFootJump = false;
    const ps = ev.panels;

    if (ps.length >= 2) {
      jump = true;
      const [a, b] = ps;
      // 手動指定: 若い番号のパネル (a) に置く足を表す
      const jumpOv = overrides?.get(tickOf(beat));
      const cost = (lp: number, rp: number) =>
        dist(leftPos, lp) +
        dist(rightPos, rp) +
        (PANEL_COORDS[lp].x > PANEL_COORDS[rp].x ? 2.5 : 0) +
        (lp === 3 ? 1 : 0) +
        (rp === 0 ? 1 : 0) +
        // 累積回転が±180を超える割り当ては強く忌避
        (Math.abs(unwrapDeg(facingDeg(lp, rp), contFacing)) > MAX_ROTATION ? 100 : 0);
      if (jumpOv === "LL" || jumpOv === "RR") {
        // 2枚抜き: 2パネルを片足でまとめて踏む。もう片方の足は動かさない。
        // 足の位置は横パネル (←/→) を優先して記録する (体の向き計算の近似)
        oneFootJump = true;
        const foot: Foot = jumpOv === "LL" ? "L" : "R";
        feet[a] = foot;
        feet[b] = foot;
        const pos = a === 0 || a === 3 ? a : b === 0 || b === 3 ? b : a;
        if (foot === "L") leftPos = pos;
        else rightPos = pos;
        // 次のノーツは通常のステップ同様、逆足からの交互で続ける
        lastFoot = foot;
        lastPanel = null;
      } else {
        if (jumpOv ? jumpOv === "L" : cost(a, b) <= cost(b, a)) {
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
      }
    } else {
      const p = ps[0];
      const key = `${tickOf(beat)}:${p}`;
      let foot: Foot;
      let flexible = false; // 回転制限で足を差し替えてよいか
      const ov = overrides?.get(tickOf(beat));
      if (ov === "L" || ov === "R") {
        foot = ov;
      } else if (lockedL !== lockedR) {
        // 片足がフリーズ保持中 → 空いている足で踏むしかない
        foot = lockedL ? "R" : "L";
      } else if (lastPanel === p && lastFoot !== null) {
        foot = lastFoot;
      } else if (holdByStart.has(key) && duringX.get(key) !== null) {
        // フリーズ開始で、保持中に他のノーツがある:
        // 残りを空き足で自然に踏めるように保持する足を選ぶ
        const sx = duringX.get(key)!;
        if (p === 0) foot = "L";
        else if (p === 3) foot = "R";
        else if (sx < 1) foot = "R"; // 保持中のノーツが左寄り → 右足で保持
        else if (sx > 1) foot = "L";
        else foot = lastFoot === null ? (dist(leftPos, p) <= dist(rightPos, p) ? "L" : "R") : lastFoot === "L" ? "R" : "L";
      } else if (lastFoot === null) {
        // 開始直後 or ジャンプ直後: すでにそのパネルに乗っている足、なければ近い足
        flexible = true;
        if (leftPos === p) foot = "L";
        else if (rightPos === p) foot = "R";
        else if (p === 0) foot = "L";
        else if (p === 3) foot = "R";
        else foot = dist(leftPos, p) <= dist(rightPos, p) ? "L" : "R";
      } else {
        flexible = true;
        foot = lastFoot === "L" ? "R" : "L";
      }

      // 累積回転が±180を超えるなら、踏み替え (スライド) で解消する
      if (flexible) {
        const simFacing = (f: Foot) =>
          unwrapDeg(facingDeg(f === "L" ? p : leftPos, f === "R" ? p : rightPos), contFacing);
        const f1 = simFacing(foot);
        if (Math.abs(f1) > MAX_ROTATION) {
          const other: Foot = foot === "L" ? "R" : "L";
          if (Math.abs(simFacing(other)) < Math.abs(f1)) foot = other;
        }
      }

      jack = lastPanel === p && lastFoot === foot;
      doubleStep = !jack && lastFoot === foot && lastPanel !== null && lastPanel !== p;
      feet[p] = foot;
      if (foot === "L") leftPos = p;
      else rightPos = p;
      lastFoot = foot;
      lastPanel = p;
    }
    contFacing = unwrapDeg(facingDeg(leftPos, rightPos), contFacing);

    // このイベントで始まるフリーズを登録
    for (const p of ps) {
      const h = holdByStart.get(`${tickOf(beat)}:${p}`);
      const f = feet[p];
      if (h && f) active.push({ panel: p, endBeat: h.endBeat, foot: f });
    }

    out.push({
      feet,
      leftPos,
      rightPos,
      jump,
      jack,
      crossover: crossed(leftPos, rightPos),
      doubleStep,
      oneFootJump,
      heldFeet: Array.from(new Set(active.map((a) => a.foot))),
      facing: contFacing,
    });
  }
  return out;
}

export interface ChartStats {
  steps: number;
  jumps: number;
  jacks: number;
  crossovers: number;
  doubleSteps: number;
  shocks: number;
}

export function statsOf(footsteps: FootStep[], shocks = 0): ChartStats {
  return {
    steps: footsteps.length,
    jumps: footsteps.filter((f) => f.jump).length,
    jacks: footsteps.filter((f) => f.jack).length,
    crossovers: footsteps.filter((f) => f.crossover).length,
    doubleSteps: footsteps.filter((f) => f.doubleStep).length,
    shocks,
  };
}

export const FOOT_COLORS: Record<Foot, string> = {
  L: "#ff5ca8",
  R: "#38bdf8",
};

/**
 * 体の向きに対応する背景色。
 * 左向き=ピンク・右向き=水色で、角度が大きいほど濃い。
 * 225〜270度 (イレギュラー) は紫の警告色、315度以上 (一回転級) は真っ暗。
 * 正面 (±22度未満) は無色 (null)。
 */
export function facingColor(facing: number): string | null {
  const a = Math.abs(facing);
  if (a < 22) return null;
  if (a >= 315) return "rgba(4, 4, 12, 0.88)";
  if (a > 200) return "rgba(168, 85, 247, 0.45)";
  if (a > 157) {
    // 180度 (完全後ろ向き): 135度までの単純な濃淡とは意味を変えるため、
    // 左右の色相を保ちつつ紫側に寄せた別トーンにする
    return facing < 0 ? "rgba(216, 88, 203, 0.52)" : "rgba(106, 142, 247, 0.52)";
  }
  const t = Math.min(a, 180) / 180;
  const alpha = 0.08 + t * 0.42;
  return facing < 0
    ? `rgba(255, 92, 168, ${alpha.toFixed(3)})`
    : `rgba(56, 189, 248, ${alpha.toFixed(3)})`;
}

// 各カラムの矢印の回転角 (上向き矢印を基準)
export const ARROW_ROTATIONS = [-90, 180, 0, 90]; // ←, ↓, ↑, →
