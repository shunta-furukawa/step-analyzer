// 譜面の指定範囲をCanvasに描画してPNG共有するためのレンダラ。
// アプリ本体の表示 (体の向きバンド・足バッジ・保持足で塗り分けたフリーズ・
// ショック・空打ち) をそのまま静止画に再現する。

import {
  ARROW_CRYSTAL_LOWER,
  ARROW_CRYSTAL_UPPER,
  ARROW_HEAD_STRIPE,
  ARROW_PATH,
  lighten,
} from "./arrowShape";
import {
  ARROW_ROTATIONS,
  FOOT_COLORS,
  QUANT_COLORS,
  facingColor,
  tickOf,
  type Foot,
  type FootOverride,
  type FootStep,
  type ParsedChart,
} from "./chart";

export interface ChartImageOptions {
  chart: ParsedChart;
  footsteps: FootStep[];
  overrides: Map<number, FootOverride>;
  startMeasure: number; // 1-based inclusive
  endMeasure: number;
  title: string;
  bgColor: string; // 6桁hex ('#'なし)
  measuresPerColumn?: number;
}

const INK = "#17181c";
const LANE_W = 40;
const NOTE = 34;
const PX_PER_BEAT = 30;
const COL_GAP = 18;
const PAD = 18;
const HEADER = 46;

function fgFor(bgHex: string): string {
  const r = parseInt(bgHex.slice(0, 2), 16);
  const g = parseInt(bgHex.slice(2, 4), 16);
  const b = parseInt(bgHex.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.45 ? INK : "#ffffff";
}

// 64x64ビューボックスのパスを (cx, cy) 中心・size幅・rotation度で描く準備
function withArrowTransform(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  rotation: number,
  draw: () => void
) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((rotation * Math.PI) / 180);
  const s = size / 64;
  ctx.scale(s, s);
  ctx.translate(-32, -33);
  draw();
  ctx.restore();
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  rotation: number,
  color: string
) {
  const body = new Path2D(ARROW_PATH);
  const stripe = new Path2D(ARROW_HEAD_STRIPE);
  const cu = new Path2D(ARROW_CRYSTAL_UPPER);
  const cl = new Path2D(ARROW_CRYSTAL_LOWER);
  withArrowTransform(ctx, cx, cy, size, rotation, () => {
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#f2f5ff";
    ctx.lineWidth = 8;
    ctx.stroke(body);
    ctx.fillStyle = color;
    ctx.fill(body);
    ctx.strokeStyle = lighten(color, 0.7);
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.stroke(stripe);
    ctx.fillStyle = lighten(color, 0.65);
    ctx.fill(cu);
    ctx.fill(cl);
    ctx.strokeStyle = "#10142a";
    ctx.lineWidth = 4.5;
    ctx.stroke(body);
  });
}

function drawGhostArrow(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  rotation: number,
  color = "#7ce8a9",
  fill = "rgba(46, 204, 113, 0.15)"
) {
  const body = new Path2D(ARROW_PATH);
  withArrowTransform(ctx, cx, cy, size, rotation, () => {
    ctx.lineJoin = "round";
    ctx.fillStyle = fill;
    ctx.fill(body);
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.setLineDash([7, 5]);
    ctx.stroke(body);
    ctx.setLineDash([]);
  });
}

function drawFootBadge(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  foot: Foot,
  pinned: boolean
) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, 9, 0, Math.PI * 2);
  ctx.fillStyle = FOOT_COLORS[foot];
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = pinned ? "#ffffff" : INK;
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.font = "800 11px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(foot, x, y + 0.5);
  ctx.restore();
}

/** フリーズを保持足ごとの区間に分割 (Viewerの表示と同じ規則) */
function holdSegments(chart: ParsedChart, footsteps: FootStep[]) {
  const segs: {
    panel: number;
    start: number;
    end: number;
    foot: Foot | null;
    roll: boolean;
  }[] = [];
  for (const h of chart.holds) {
    const headIdx = chart.events.findIndex(
      (e) => Math.abs(e.row.beat - h.startBeat) < 1e-6 && e.panels.includes(h.panel)
    );
    let foot: Foot | null =
      headIdx >= 0 ? footsteps[headIdx]?.feet[h.panel] ?? null : null;
    let segStart = h.startBeat;
    chart.events.forEach((e, i) => {
      if (!e.ghostPanels.includes(h.panel)) return;
      const b = e.row.beat;
      if (b <= h.startBeat + 1e-6 || b >= h.endBeat - 1e-6) return;
      segs.push({ panel: h.panel, start: segStart, end: b, foot, roll: h.roll });
      segStart = b;
      foot = footsteps[i]?.feet[h.panel] ?? foot;
    });
    segs.push({ panel: h.panel, start: segStart, end: h.endBeat, foot, roll: h.roll });
  }
  return segs;
}

export function renderChartImage(o: ChartImageOptions): HTMLCanvasElement {
  const { chart, footsteps, overrides } = o;
  const total = chart.measures.length;
  const start = Math.max(1, Math.min(o.startMeasure, total));
  const end = Math.max(start, Math.min(o.endMeasure, total));
  const perCol = o.measuresPerColumn ?? 4;
  const count = end - start + 1;
  const cols = Math.ceil(count / perCol);

  const colInnerW = LANE_W * 4;
  // 小節境界ちょうどのノーツが矢印半分だけレーン外にはみ出すぶんの余白
  const noteMargin = NOTE / 2 + 3;
  const colH = Math.min(count, perCol) * 4 * PX_PER_BEAT;
  const width = PAD * 2 + cols * (colInnerW + COL_GAP) - COL_GAP;
  const height = PAD * 2 + HEADER + noteMargin + colH + noteMargin;

  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);

  // 背景 (ページと同じ斜めストライプ)
  ctx.fillStyle = `#${o.bgColor}`;
  ctx.fillRect(0, 0, width, height);
  ctx.save();
  ctx.rotate((-25 * Math.PI) / 180);
  for (let x = -height * 2; x < width + height * 2; x += 36) {
    ctx.fillStyle = (x / 36) % 2 === 0 ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.045)";
    ctx.fillRect(x, -width, 36, width * 2 + height * 2);
  }
  ctx.restore();

  // ヘッダ: タイトル + 範囲
  const fg = fgFor(o.bgColor);
  ctx.fillStyle = fg;
  ctx.font = "800 20px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(o.title, PAD, PAD, width - PAD * 2 - 120);
  ctx.font = "700 12px system-ui, sans-serif";
  ctx.globalAlpha = 0.75;
  ctx.fillText(`#${start}-${end} · step-analyzer`, PAD, PAD + 26);
  ctx.globalAlpha = 1;

  const segs = holdSegments(chart, footsteps);
  const topY = PAD + HEADER + noteMargin;

  for (let ci = 0; ci < cols; ci++) {
    const colX = PAD + ci * (colInnerW + COL_GAP);
    const colStartMeasure = start - 1 + ci * perCol; // 0-based
    const colMeasures = Math.min(perCol, end - (colStartMeasure + 1) + 1);
    const colStartBeat = colStartMeasure * 4;
    const colEndBeat = colStartBeat + colMeasures * 4;
    const yOf = (beat: number) => topY + (beat - colStartBeat) * PX_PER_BEAT;

    // レーン背景
    ctx.fillStyle = INK;
    ctx.fillRect(colX, topY, colInnerW, colMeasures * 4 * PX_PER_BEAT);

    // 体の向きバンド (ノーツi-1→i をiの色で)
    chart.events.forEach((ev, i) => {
      const color = facingColor(footsteps[i].facing);
      if (!color) return;
      const bandStart = i > 0 ? chart.events[i - 1].row.beat : 0;
      const s = Math.max(bandStart, colStartBeat);
      const e = Math.min(ev.row.beat, colEndBeat);
      if (e <= s) return;
      ctx.fillStyle = color;
      ctx.fillRect(colX, yOf(s), colInnerW, yOf(e) - yOf(s));
    });

    // 小節線 + 小節番号
    for (let m = 0; m <= colMeasures; m++) {
      const y = topY + m * 4 * PX_PER_BEAT;
      ctx.strokeStyle = "rgba(255,255,255,0.28)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(colX, y);
      ctx.lineTo(colX + colInnerW, y);
      ctx.stroke();
      if (m < colMeasures) {
        ctx.fillStyle = "rgba(255,255,255,0.5)";
        ctx.font = "700 10px ui-monospace, monospace";
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.fillText(String(colStartMeasure + m + 1), colX + 3, y + 3);
      }
    }

    // フリーズ (保持足の色)
    for (const s of segs) {
      const a = Math.max(s.start, colStartBeat);
      const b = Math.min(s.end, colEndBeat);
      if (b <= a) continue;
      ctx.fillStyle = s.roll
        ? "#ff9f43"
        : s.foot === "L"
        ? "rgba(255, 92, 168, 0.66)"
        : s.foot === "R"
        ? "rgba(56, 189, 248, 0.66)"
        : "#2ecc71";
      const x = colX + s.panel * LANE_W + (LANE_W - NOTE) / 2 + 5;
      ctx.fillRect(x, yOf(a), NOTE - 10, yOf(b) - yOf(a));
    }

    // ショックアロー行
    for (const r of chart.shocks) {
      if (r.beat < colStartBeat || r.beat >= colEndBeat) continue;
      const y = yOf(r.beat);
      ctx.fillStyle = "rgba(125, 249, 255, 0.16)";
      ctx.fillRect(colX + 1, y - NOTE * 0.34, colInnerW - 2, NOTE * 0.68);
      ctx.strokeStyle = "rgba(125, 249, 255, 0.65)";
      ctx.lineWidth = 1;
      ctx.strokeRect(colX + 1, y - NOTE * 0.34, colInnerW - 2, NOTE * 0.68);
      for (let p = 0; p < 4; p++) {
        drawGhostArrow(
          ctx,
          colX + p * LANE_W + LANE_W / 2,
          y,
          NOTE * 0.56,
          ARROW_ROTATIONS[p],
          "#7df9ff",
          "rgba(125, 249, 255, 0.16)"
        );
      }
      const ov = overrides.get(tickOf(r.beat));
      if (ov === "C" || ov === "CL" || ov === "CR") {
        const label = ov === "C" ? "◇" : ov === "CL" ? "◇L" : "◇R";
        ctx.fillStyle = "rgba(13, 15, 20, 0.88)";
        ctx.fillRect(colX + colInnerW - 24, y - 8, 22, 16);
        ctx.fillStyle = ov === "CL" ? FOOT_COLORS.L : ov === "CR" ? FOOT_COLORS.R : "#7df9ff";
        ctx.font = "800 9px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(label, colX + colInnerW - 13, y);
      }
    }

    // 地雷
    for (const m of chart.mines) {
      if (m.beat < colStartBeat || m.beat >= colEndBeat) continue;
      ctx.fillStyle = "#aab";
      ctx.font = "700 16px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("✕", colX + m.panel * LANE_W + LANE_W / 2, yOf(m.beat));
    }

    // ノーツ
    chart.events.forEach((ev, i) => {
      const beat = ev.row.beat;
      if (beat < colStartBeat || beat >= colEndBeat) return;
      const step = footsteps[i];
      const hasOverride = overrides.has(tickOf(beat));
      for (const p of ev.panels) {
        const cx = colX + p * LANE_W + LANE_W / 2;
        const cy = yOf(beat);
        if (ev.ghostPanels.includes(p)) {
          drawGhostArrow(ctx, cx, cy, NOTE, ARROW_ROTATIONS[p]);
        } else {
          drawArrow(
            ctx,
            cx,
            cy,
            NOTE,
            ARROW_ROTATIONS[p],
            QUANT_COLORS[ev.row.quant] ?? "#9aa3b5"
          );
        }
        const foot = step.feet[p];
        if (foot) {
          drawFootBadge(ctx, cx + NOTE / 2 - 4, cy - NOTE / 2 + 4, foot, hasOverride);
        }
      }
    });
  }

  return canvas;
}
