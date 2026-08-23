// 難所の自動検出。足割り解析の結果 (footsteps) とタイミングから
// 小節ごとに難しさをスコアリングし、上位数箇所へ日本語の解説文を
// テンプレ生成する。横動画の注目ポイント (spotlights) に、手動の
// コメントがないときの既定として使う。

import type { FootStep, ParsedChart } from "./chart";
import { timeAtBeat, type TimingSeg } from "./timing";

export interface AutoSpot {
  beat: number; // 代表ノーツの拍位置 (グループのピーク小節)
  measure: number; // 0-based小節番号 (グループ末尾)
  measures: number[]; // リプレイ対象の小節列 (0-based昇順)
  text: string;
  score: number;
}

// タイムラインから拍位置のBPMを引く
function bpmAt(timeline: TimingSeg[], beat: number): number {
  let cur = timeline.find((s) => s.move)?.bpm ?? 120;
  for (const s of timeline) {
    if (!s.move) continue;
    if (s.beat0 <= beat + 1e-9) cur = s.bpm;
    else break;
  }
  return cur;
}

interface MeasureFeatures {
  measure: number;
  score: number;
  kind: string; // 指摘の種別 (同種の連続をグルーピングする鍵)
  firstBeat: number; // 小節内で最初に難所要素が現れるノーツの拍
  crosses: number;
  switches: number;
  jacks: number;
  stretches: number;
  maxSwingDeg: number; // 小節内での体の向きの振れ幅
  gapRatio: number; // 直前小節比のノーツ間隔の詰まり (2=倍速化)
  bpmFrom: number;
  bpmTo: number;
  densest: number; // 小節内の最小ノーツ間隔 (等速換算秒)
  mainQuant: number; // 密集部の代表的な音価 (16=16分)
}

/**
 * 小節単位の難所スコアリング。
 * スコアが閾値を超えた小節を、近接しすぎない (2小節以上空ける) ように
 * すべて選ぶ。maxSpotsを渡せば件数を絞れる。
 */
export function detectSpotlights(
  chart: ParsedChart,
  footsteps: FootStep[],
  timeline: TimingSeg[],
  maxSpots = Infinity,
  minScore = 4
): AutoSpot[] {
  const measures = chart.measures.length;
  if (measures === 0) return [];

  // 判定対象のノーツ (空打ち・ショックは除く) と時刻
  const judged: { beat: number; time: number; idx: number; quant: number; j: number }[] =
    [];
  chart.events.forEach((e, i) => {
    if (e.panels.length === 0 || e.ghostPanels.length > 0 || e.shock) return;
    judged.push({
      beat: e.row.beat,
      time: timeAtBeat(timeline, e.row.beat),
      idx: i,
      quant: e.row.quant,
      j: judged.length,
    });
  });
  if (judged.length < 4) return [];

  const feats: MeasureFeatures[] = [];
  let prevAvgGap = Infinity;
  for (let m = 0; m < measures; m++) {
    const b0 = m * 4;
    const b1 = b0 + 4;
    const inM = judged.filter((n) => n.beat >= b0 - 1e-6 && n.beat < b1 - 1e-6);
    if (inM.length === 0) {
      prevAvgGap = Infinity;
      continue;
    }
    const f: MeasureFeatures = {
      measure: m,
      score: 0,
      kind: "generic",
      firstBeat: inM[0].beat,
      crosses: 0,
      switches: 0,
      jacks: 0,
      stretches: 0,
      maxSwingDeg: 0,
      gapRatio: 1,
      bpmFrom: bpmAt(timeline, Math.max(0, b0 - 4)),
      bpmTo: bpmAt(timeline, b0),
      densest: Infinity,
      mainQuant: 4,
    };

    // 足割りフラグの集計と、最初に難所要素が出るノーツ
    let firstFeatureBeat: number | null = null;
    let minFacing = Infinity;
    let maxFacing = -Infinity;
    for (const n of inM) {
      const st = footsteps[n.idx];
      if (!st) continue;
      let hit = false;
      if (st.crossover) {
        f.crosses++;
        hit = true;
      }
      if (st.doubleStep) {
        f.switches++;
        hit = true;
      }
      if (st.jack) {
        f.jacks++;
        hit = true;
      }
      if (st.stretch || st.oneFootJump) {
        f.stretches++;
        hit = true;
      }
      minFacing = Math.min(minFacing, st.facing);
      maxFacing = Math.max(maxFacing, st.facing);
      if (hit && firstFeatureBeat === null) firstFeatureBeat = n.beat;
    }
    f.maxSwingDeg = maxFacing > minFacing ? maxFacing - minFacing : 0;

    // ノーツ間隔 (等速換算秒)。小節をまたぐ最初の間隔も含める
    const gaps: number[] = [];
    const quantCount = new Map<number, number>();
    for (const n of inM) {
      if (n.j > 0) {
        const gap = n.time - judged[n.j - 1].time;
        if (gap > 1e-4) gaps.push(gap);
      }
      quantCount.set(n.quant, (quantCount.get(n.quant) ?? 0) + 1);
    }
    if (gaps.length > 0) {
      f.densest = Math.min(...gaps);
      const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
      if (Number.isFinite(prevAvgGap) && avg > 1e-4) f.gapRatio = prevAvgGap / avg;
      prevAvgGap = avg;
    }
    f.mainQuant = [...quantCount.entries()].sort((a, b) => b[1] - a[1])[0][0];

    // スコアリング (重みはコンテンツとしての「見どころ度」)
    f.score += f.crosses * 3;
    f.score += f.switches * 4;
    f.score += f.jacks >= 3 ? 3 + (f.jacks - 3) : f.jacks * 0.5;
    f.score += f.stretches * 4;
    if (f.maxSwingDeg >= 180) f.score += 4;
    else if (f.maxSwingDeg >= 120) f.score += 2.5;
    else if (f.maxSwingDeg >= 90) f.score += 1;
    // 加速: BPMが上がる or ノーツ間隔が急に詰まる
    if (f.bpmTo > f.bpmFrom * 1.3) f.score += 4;
    if (f.gapRatio >= 1.8) f.score += 4;
    else if (f.gapRatio >= 1.4) f.score += 2;
    // 密度: 16分相当 (BPM150の16分=0.1s) を基準に連続スコア。
    // 詰まっているほど高く、全体最速の小節が勝ちやすくする
    if (f.densest <= 0.15) f.score += Math.min(6, 3 * (0.1 / f.densest));

    if (firstFeatureBeat !== null) f.firstBeat = firstFeatureBeat;
    // 支配的な特徴を種別として持つ (同種の連続をまとめる鍵)
    f.kind =
      f.bpmTo > f.bpmFrom * 1.3
        ? "accel"
        : f.crosses >= 2
          ? "cross"
          : f.switches >= 1
            ? "switch"
            : f.stretches >= 1
              ? "stretch"
              : f.jacks >= 3
                ? "jack"
                : f.gapRatio >= 1.5
                  ? "rush"
                  : f.densest <= 0.1
                    ? "dense"
                    : "generic";
    feats.push(f);
  }

  // 「この曲最速」の判定用: 全小節での最小ノーツ間隔
  const globalDensest = Math.min(...feats.map((f) => f.densest));

  // 閾値を超えた小節を、同種の指摘が2小節以内に連続する限りひと塊に
  // まとめる (塊の末尾で1回だけ停止し、各小節を順にリプレイする)
  const qualifying = feats
    .filter((f) => f.score >= minScore)
    .sort((a, b) => a.measure - b.measure);
  const groups: { kind: string; members: MeasureFeatures[] }[] = [];
  for (const f of qualifying) {
    const g = groups[groups.length - 1];
    if (g && g.kind === f.kind && f.measure - g.members[g.members.length - 1].measure <= 2) {
      g.members.push(f);
    } else {
      groups.push({ kind: f.kind, members: [f] });
    }
  }

  let spots = groups.map((g) => {
    const peak = g.members.reduce((a, b) => (b.score > a.score ? b : a));
    const last = g.members[g.members.length - 1];
    const base = spotText(peak, peak.densest <= globalDensest * 1.05);
    const text =
      g.members.length > 1 ? `${base}。この形が${g.members.length}小節にわたり続く` : base;
    return {
      beat: peak.firstBeat,
      measure: last.measure,
      measures: g.members.map((m) => m.measure),
      text,
      score: peak.score,
    };
  });
  if (Number.isFinite(maxSpots) && spots.length > maxSpots) {
    spots = spots
      .sort((a, b) => b.score - a.score)
      .slice(0, maxSpots)
      .sort((a, b) => a.measure - b.measure);
  }
  return spots;
}

// 検出した特徴から解説文を生成。寄与の大きい要素を1〜2個拾う
function spotText(f: MeasureFeatures, isFastest: boolean): string {
  const parts: string[] = [];
  const accel = f.bpmTo > f.bpmFrom * 1.3;
  const dense = f.densest <= 0.1;
  const quantLabel = f.mainQuant >= 12 ? `${f.mainQuant}分` : "";

  if (accel) {
    parts.push(
      `BPM ${round1(f.bpmFrom)}→${round1(f.bpmTo)}へ加速！つられて走らないように`
    );
  } else if (f.gapRatio >= 1.5 && quantLabel) {
    parts.push(`ここから${quantLabel}ラッシュ！一気に密度が上がる`);
  }

  if (f.crosses >= 2 && f.maxSwingDeg >= 90) {
    parts.push(
      `交差${f.crosses}連発、体は${Math.round(f.maxSwingDeg)}°振り回される捻り地帯`
    );
  } else if (f.crosses >= 1) {
    parts.push(`交差あり。軸足を残して体を捻る`);
  }

  if (f.switches >= 2) {
    parts.push(`踏み替え(スイッチ)×${f.switches}。素早い足の入れ替えに注意`);
  } else if (f.switches === 1) {
    parts.push(`ここで踏み替え。同じパネルを逆の足で取り直す`);
  }

  if (f.jacks >= 3) parts.push(`縦連${f.jacks}連打。膝のバネで刻む`);
  if (f.stretches >= 1) parts.push(`2枚抜き/スタンス広めの配置。重心を低く`);

  if (parts.length === 0) {
    if (isFastest && dense && quantLabel)
      return `この曲最速の${quantLabel}地帯。足元を先に作っておく`;
    if (dense && quantLabel) return `${quantLabel}の高密度地帯。省エネな足運びで`;
    return `リズムの取りにくい地帯。落ち着いて足順キープ`;
  }
  return parts.slice(0, 2).join("。");
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
