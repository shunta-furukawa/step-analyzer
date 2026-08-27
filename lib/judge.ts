// プレイモードの判定エンジン。DDR準拠の判定窓とスコア計算。
// 純粋ロジック (DOM非依存) にして単体で検証できるようにしている。
//
// - 判定窓は実時間 (壁時計) 基準。再生速度を落とすとノーツ間隔は
//   広がるが、ジャストからのズレ許容は本家と同じミリ秒のまま
// - 1行 = 1判定 (同時踏みは両パネルが揃った時点で1つの判定。
//   ズレの大きい方の足で判定が決まる)。スコアも行単位で配分する
// - コンボはMISSでのみ切れる (GOODは継続してカウントも進む)
// - ショックアローは「窓内に何も踏まなければセーフ、踏んだらMISS扱い
//   +コンボ切断」。セーフでも判定数には数えない

import type { ParsedChart } from "./chart";
import { timeAtBeat, type TimingSeg } from "./timing";

export type Judgment = "marvelous" | "perfect" | "great" | "good" | "miss";

// DDR (白筐体) の判定幅ms。GOODの外はMISS
export const JUDGE_WINDOWS_MS: Record<Exclude<Judgment, "miss">, number> = {
  marvelous: 16.7,
  perfect: 33.3,
  great: 91.7,
  good: 141.7,
};

export interface JudgeTarget {
  time: number; // 曲内秒 (等速換算)
  panels: number[]; // 同時踏みは複数パネルで1判定
  row: number; // イベントindex (表示用)
}

export interface JudgeCounts {
  marvelous: number;
  perfect: number;
  great: number;
  good: number;
  miss: number;
}

export interface JudgeResult {
  counts: JudgeCounts;
  maxCombo: number;
  total: number; // 判定対象のノーツ数 (同時踏みは1)
  score: number; // DDR A20式 100万点満点
  exScore: number; // MARV=3 / PERF=2 / GREAT=1
  exMax: number;
  grade: string; // AAA〜D
  shockHits: number; // 触ってしまったショックアロー数
}

/** 譜面から判定対象 (行単位。同時踏みは1判定) とショックアロー時刻を作る */
export function buildJudgeTargets(
  chart: ParsedChart,
  timeline: TimingSeg[]
): { targets: JudgeTarget[]; shocks: number[] } {
  const targets: JudgeTarget[] = [];
  const shocks: number[] = [];
  chart.events.forEach((ev, i) => {
    const t = timeAtBeat(timeline, ev.row.beat);
    if (ev.shock) {
      shocks.push(t);
      return;
    }
    if (ev.ghostPanels.length > 0) return; // 空打ちは判定なし
    if (ev.panels.length === 0) return;
    targets.push({ time: t, panels: [...ev.panels], row: i });
  });
  targets.sort((a, b) => a.time - b.time);
  return { targets, shocks };
}

// DDR A20系のスコア計算 (行単位): 満点100万をノーツ数で均等割りし、
// MARV=満額 / PERF=満額-10 / GREAT=60%-10 / GOOD=20%-10 / MISS=0。
// 最後に10点未満を切り捨て
export function computeScore(counts: JudgeCounts, total: number): number {
  if (total === 0) return 0;
  const p = 1000000 / total;
  const raw =
    counts.marvelous * p +
    counts.perfect * (p - 10) +
    counts.great * (p * 0.6 - 10) +
    counts.good * (p * 0.2 - 10);
  return Math.max(0, Math.floor(raw / 10) * 10);
}

export function gradeOf(score: number): string {
  if (score >= 990000) return "AAA";
  if (score >= 950000) return "AA+";
  if (score >= 900000) return "AA";
  if (score >= 890000) return "AA-";
  if (score >= 850000) return "A+";
  if (score >= 800000) return "A";
  if (score >= 790000) return "A-";
  if (score >= 750000) return "B+";
  if (score >= 700000) return "B";
  if (score >= 690000) return "B-";
  if (score >= 650000) return "C+";
  if (score >= 600000) return "C";
  if (score >= 590000) return "C-";
  if (score >= 550000) return "D+";
  return "D";
}

/**
 * タップ位置から踏むパネルを解釈する。基本は4分割 (対角線区切り) だが、
 * 指の位置の厳密さを要求しないための緩和が2段ある:
 * - 中央付近 (halfSizeの35%以内) は方向を問わず「いま判定窓内に踏める
 *   ノーツがあるパネル」を幾何的に近い順で拾う。逆の手で中央を少し
 *   跨いでしまったタップも意図どおりに解釈される
 * - 対角境界付近 (±約24°) の曖昧なタップは、踏めるノーツのある側へ
 *   解釈を広げる
 * 明確に別方向のタップ・踏めるノーツがない場合は幾何どおり。
 * dx/dyはパッド中心からのオフセット、halfSizeはパッドの短辺の半分。
 */
export function resolveTapPanel(
  dx: number,
  dy: number,
  hasPending: (panel: number) => boolean,
  halfSize?: number
): number {
  const primary = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 0 : 3) : dy < 0 ? 2 : 1;
  // 中央ゾーン: どの方向のノーツでも、タップの寄り順に拾う
  if (halfSize && Math.hypot(dx, dy) < halfSize * 0.35) {
    const dirs: [number, number][] = [
      [-1, 0], // 0 = ←
      [0, 1], // 1 = ↓ (画面座標は下が正)
      [0, -1], // 2 = ↑
      [1, 0], // 3 = →
    ];
    const order = [0, 1, 2, 3]
      .map((p) => ({ p, score: dx * dirs[p][0] + dy * dirs[p][1] }))
      .sort((a, b) => b.score - a.score);
    for (const { p } of order) if (hasPending(p)) return p;
    return primary;
  }
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  const ratio = Math.min(ax, ay) / Math.max(ax, ay, 1e-6);
  if (ratio < 0.45 || hasPending(primary)) return primary;
  const secondary =
    primary === 0 || primary === 3 ? (dy < 0 ? 2 : 1) : dx < 0 ? 0 : 3;
  return hasPending(secondary) ? secondary : primary;
}

export class JudgeSession {
  private targets: JudgeTarget[];
  private shocks: number[];
  private judged: (Judgment | null)[];
  // 行ごとの各パネルの入力ズレ (実時間の絶対秒)。未入力はnull。
  // 同時踏みは全パネルが揃った時点で、最大ズレを行の判定にする
  private hits: (number | null)[][];
  private shockHit: boolean[];
  private speed: number;
  private scale: number; // 判定ゆるめ: 窓を1.5倍
  private sweepFrom = 0;
  counts: JudgeCounts = { marvelous: 0, perfect: 0, great: 0, good: 0, miss: 0 };
  combo = 0;
  maxCombo = 0;

  constructor(
    targets: JudgeTarget[],
    shocks: number[],
    speed: number,
    widen: boolean
  ) {
    this.targets = targets;
    this.shocks = shocks;
    this.judged = targets.map(() => null);
    this.hits = targets.map((t) => t.panels.map(() => null));
    this.shockHit = shocks.map(() => false);
    this.speed = speed <= 0 ? 1 : speed;
    this.scale = widen ? 1.5 : 1;
  }

  get total(): number {
    return this.targets.length;
  }

  private window(j: Exclude<Judgment, "miss">): number {
    return (JUDGE_WINDOWS_MS[j] * this.scale) / 1000;
  }

  private apply(j: Judgment): void {
    this.counts[j]++;
    if (j === "miss") this.combo = 0;
    else {
      this.combo++;
      if (this.combo > this.maxCombo) this.maxCombo = this.combo;
    }
  }

  /**
   * パネルpanelへの入力を曲内時刻songTimeで判定する。
   * 同時踏みの片方だけ揃った状態ではnull (行が完成したときに判定を返す)。
   * 窓内に対象がなければnull (お手つきはペナルティなし。ただし
   * ショックアローの窓内ならMISSを返しコンボを切る)
   */
  hit(panel: number, songTime: number): { judgment: Judgment; shock: boolean } | null {
    const goodW = this.window("good");
    // そのパネルを含む未判定の行から実時間の絶対差が最小のものを探す
    // (sweepFromより前は判定済みか窓超過が確定している)
    let best = -1;
    let bestAbs = Infinity;
    let bestSlot = -1;
    for (let i = this.sweepFrom; i < this.targets.length; i++) {
      const dtReal = (songTime - this.targets[i].time) / this.speed;
      if (dtReal < -goodW) break; // これ以降は全て未来すぎる (time昇順)
      if (this.judged[i] !== null) continue;
      const a = Math.abs(dtReal);
      if (a > goodW || a >= bestAbs) continue;
      const slot = this.targets[i].panels.indexOf(panel);
      if (slot < 0 || this.hits[i][slot] !== null) continue; // 対象外 or 入力済み
      best = i;
      bestAbs = a;
      bestSlot = slot;
    }
    if (best >= 0) {
      this.hits[best][bestSlot] = bestAbs;
      const row = this.hits[best];
      if (row.some((v) => v === null)) return null; // 同時踏みの残りを待つ
      const worst = Math.max(...(row as number[]));
      const j: Judgment =
        worst <= this.window("marvelous")
          ? "marvelous"
          : worst <= this.window("perfect")
          ? "perfect"
          : worst <= this.window("great")
          ? "great"
          : "good";
      this.judged[best] = j;
      this.apply(j);
      return { judgment: j, shock: false };
    }
    // ショックアローの窓内に入力 → 触った扱いでMISS
    for (let s = 0; s < this.shocks.length; s++) {
      if (this.shockHit[s]) continue;
      const dtReal = Math.abs(songTime - this.shocks[s]) / this.speed;
      if (dtReal <= goodW) {
        this.shockHit[s] = true;
        this.counts.miss++;
        this.combo = 0;
        return { judgment: "miss", shock: true };
      }
    }
    return null;
  }

  /** そのパネルに「いま判定窓内で踏める」未入力ノーツがあるか */
  hasPending(panel: number, songTime: number): boolean {
    const goodW = this.window("good");
    for (let i = this.sweepFrom; i < this.targets.length; i++) {
      const dtReal = (songTime - this.targets[i].time) / this.speed;
      if (dtReal < -goodW) break;
      if (this.judged[i] !== null) continue;
      if (Math.abs(dtReal) > goodW) continue;
      const slot = this.targets[i].panels.indexOf(panel);
      if (slot >= 0 && this.hits[i][slot] === null) return true;
    }
    return false;
  }

  /** 窓を過ぎた未判定ノーツをMISSにする。新たに発生したMISS数を返す */
  sweep(songTime: number): number {
    const goodW = this.window("good");
    let misses = 0;
    let i = this.sweepFrom;
    for (; i < this.targets.length; i++) {
      const dtReal = (songTime - this.targets[i].time) / this.speed;
      if (dtReal <= goodW) break; // まだ窓内 or 未来
      if (this.judged[i] === null) {
        this.judged[i] = "miss";
        this.apply("miss");
        misses++;
      }
    }
    this.sweepFrom = i;
    return misses;
  }

  /** 全判定を締めて結果を返す (残りは全てMISS) */
  results(): JudgeResult {
    for (let i = 0; i < this.targets.length; i++) {
      if (this.judged[i] === null) {
        this.judged[i] = "miss";
        this.apply("miss");
      }
    }
    const score = computeScore(this.counts, this.total);
    const exScore =
      this.counts.marvelous * 3 + this.counts.perfect * 2 + this.counts.great;
    return {
      counts: { ...this.counts },
      maxCombo: this.maxCombo,
      total: this.total,
      score,
      exScore,
      exMax: this.total * 3,
      grade: gradeOf(score),
      shockHits: this.shockHit.filter(Boolean).length,
    };
  }
}
