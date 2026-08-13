// 縦型ショート動画 (720x1280) の書き出し (β)。
// 譜面再生をcanvasに描画し、音源と合わせてMediaRecorderでリアルタイム録画する。
// すべてクライアントサイドで完結し、サーバーには何も送らない。

import {
  ARROW_ROTATIONS,
  FOOT_COLORS,
  QUANT_COLORS,
  facingColor,
  type Foot,
  type FootStep,
  type ParsedChart,
} from "./chart";
import { drawArrow, drawFootBadge, drawGhostArrow } from "./chartImage";
import { ARROW_PATH } from "./arrowShape";
import { beatAtTime, timeAtBeat, type TimingSeg } from "./timing";
import { renderClapTrackSamples } from "./clap";

export interface VideoExportOptions {
  chart: ParsedChart;
  footsteps: FootStep[];
  timeline: TimingSeg[];
  title: string;
  bpmLabel: string; // "175" や "154-308" など表示用
  bgColor: string; // 6桁hex ('#'なし)
  hispeed: number;
  audio: AudioBuffer;
  jacket: HTMLImageElement | null;
  offsetSec: number; // 譜面1小節目の頭が音源の何秒目か
  onProgress?: (ratio: number) => void;
  signal?: { cancelled: boolean };
}

const W = 720;
const H = 1280;
const LANE_W = 130;
const NOTE = 112;
const LANE_X = (W - LANE_W * 4) / 2;
const RECEPTOR_Y = 420;
const HEADER_H = 250;
const LANE_BOTTOM = H - 370; // ここから下は足パッドの領域
const LEAD_IN = 1.5; // 録画開始から1ノーツ目までの助走秒数
const TAIL = 1.2;
const FOOT_TRAVEL = 0.25; // 足が次のパネルへ移動するのにかける秒数 (アプリと同じ)

// 足パッド (FootStageと同じ3x3グリッド座標)
const STAGE_CENTERS = [
  { x: 0.5, y: 1.5 },
  { x: 1.5, y: 2.5 },
  { x: 1.5, y: 0.5 },
  { x: 2.5, y: 1.5 },
  { x: 1.5, y: 1.5 },
];
const PAD_CELL = 150;
const PAD_SQUASH = 0.5;
const PAD_Y = LANE_BOTTOM + 60;

// 簡易透視投影: 奥の行ほど狭く・詰めて描き、CSSのperspective+rotateXの
// 見え方に寄せる。グリッド座標 (0..3, 0..3) → スクリーン座標
function padProject(gx: number, gy: number): { x: number; y: number; s: number } {
  const t = gy / 3;
  const rowScale = 0.74 + 0.38 * t; // 奥0.74倍 → 手前1.12倍
  const x = W / 2 + (gx - 1.5) * PAD_CELL * rowScale;
  const y = PAD_Y + PAD_CELL * PAD_SQUASH * gy * (0.8 + 0.09 * gy);
  return { x, y, s: rowScale };
}

// 表示用の足の角度 (Viewerと同じ圧縮 + かかと正面の折り返し)
function displayFootRot(facing: number): number {
  const norm = facing % 360;
  let a = Math.abs(norm);
  const sign = Math.sign(norm);
  const heelFlip = a > 180;
  if (heelFlip) a -= 180;
  const compressed = Math.min(90, a <= 45 ? a : 45 + (a - 45) * 0.4);
  return heelFlip ? sign * (180 - compressed) : sign * compressed;
}

interface FootPose {
  lx: number;
  ly: number;
  lRot: number;
  rx: number;
  ry: number;
  rRot: number;
}

// FootStageの配置規則をそのまま再現した表示ポーズ
function footPoseOf(step: FootStep): FootPose {
  const same = step.leftPos === step.rightPos && !step.liftedFoot;
  const rot = displayFootRot(step.facing);
  const lc = STAGE_CENTERS[step.leftPos];
  const rc = STAGE_CENTERS[step.rightPos];
  let lx = lc.x + (same ? -0.22 : 0);
  let ly = lc.y;
  let rx = rc.x + (same ? 0.22 : 0);
  let ry = rc.y;
  let lRot = rot;
  let rRot = rot;
  if (step.stretch) {
    const c1 = STAGE_CENTERS[step.stretch.panels[0]];
    const c2 = STAGE_CENTERS[step.stretch.panels[1]];
    const mx = (c1.x + c2.x) / 2;
    const my = (c1.y + c2.y) / 2;
    let tilt = (Math.atan2(c2.x - c1.x, c1.y - c2.y) * 180) / Math.PI;
    if (tilt > 90) tilt -= 180;
    if (tilt < -90) tilt += 180;
    if (step.stretch.foot === "L") {
      lx = mx;
      ly = my;
      lRot = tilt;
    } else {
      rx = mx;
      ry = my;
      rRot = tilt;
    }
  }
  if (step.liftedFoot === "L") {
    lx = 1.5 - 0.28;
    ly = 1.5;
  } else if (step.liftedFoot === "R") {
    rx = 1.5 + 0.28;
    ry = 1.5;
  }
  return { lx, ly, lRot, rx, ry, rRot };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
// 角度は近い方向へ補間する
function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return a + d * t;
}

function fgFor(bgHex: string): string {
  const r = parseInt(bgHex.slice(0, 2), 16);
  const g = parseInt(bgHex.slice(2, 4), 16);
  const b = parseInt(bgHex.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.45 ? "#17181c" : "#ffffff";
}

function pickMime(): { mime: string; ext: string } {
  // H.264+AACを最優先 (Xなど投稿先の互換性が最も高い)。
  // 非対応環境は順にフォールバック (Chromeのmp4はvp9/opusになる場合あり)
  const candidates: [string, string][] = [
    ['video/mp4;codecs="avc1.42E01E,mp4a.40.2"', "mp4"],
    ["video/mp4;codecs=avc1", "mp4"],
    ["video/mp4", "mp4"],
    ["video/webm;codecs=vp9,opus", "webm"],
    ["video/webm;codecs=vp8,opus", "webm"],
    ["video/webm", "webm"],
  ];
  for (const [mime, ext] of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(mime)) {
      return { mime, ext };
    }
  }
  return { mime: "", ext: "webm" };
}

/** フリーズを保持足ごとの区間に分割 (chartImageと同じ規則) */
function holdSegmentsOf(chart: ParsedChart, footsteps: FootStep[]) {
  const segs: { panel: number; start: number; end: number; foot: Foot | null; roll: boolean }[] =
    [];
  for (const h of chart.holds) {
    const headIdx = chart.events.findIndex(
      (e) => Math.abs(e.row.beat - h.startBeat) < 1e-6 && e.panels.includes(h.panel)
    );
    let foot: Foot | null = headIdx >= 0 ? footsteps[headIdx]?.feet[h.panel] ?? null : null;
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

export async function recordChartVideo(
  o: VideoExportOptions
): Promise<{ blob: Blob; ext: string }> {
  const { chart, footsteps, timeline } = o;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;

  const segs = holdSegmentsOf(chart, footsteps);
  const pxPerBeat = NOTE * 1.8 * Math.max(0.25, o.hispeed);
  const fg = fgFor(o.bgColor);
  const songEnd = o.offsetSec + timeAtBeat(timeline, chart.totalBeats) + TAIL;
  const recStart = Math.max(0, o.offsetSec - LEAD_IN);
  const durationSec = songEnd - recStart;

  // 音声: バッファ再生を録画ストリームへ (スピーカーにも出して進行がわかるように)
  const actx = new AudioContext();
  await actx.resume();
  const dest = actx.createMediaStreamDestination();
  const src = actx.createBufferSource();
  src.buffer = o.audio;
  src.connect(dest);
  src.connect(actx.destination);

  // ハンドクラップ: アプリ再生と同じ判定音を録画開始時刻基準で合成する
  const judged = chart.events.filter(
    (e) => e.panels.length > 0 && e.ghostPanels.length === 0 && !e.shock
  );
  const clapTimes = judged.map(
    (e) => o.offsetSec + timeAtBeat(timeline, e.row.beat) - recStart
  );
  const clapAccents = judged.map((e) => e.panels.length >= 2);
  const ghostTimes = chart.events
    .filter((e, i) => e.ghostPanels.length > 0 || (e.shock && footsteps[i]?.ghost))
    .map((e) => o.offsetSec + timeAtBeat(timeline, e.row.beat) - recStart);
  const { samples: clapSamples, sr: clapSr } = renderClapTrackSamples(
    clapTimes,
    clapAccents,
    durationSec,
    ghostTimes
  );
  const clapBuf = actx.createBuffer(1, clapSamples.length, clapSr);
  clapBuf.copyToChannel(clapSamples as Float32Array<ArrayBuffer>, 0);
  const clapSrc = actx.createBufferSource();
  clapSrc.buffer = clapBuf;
  clapSrc.connect(dest);
  clapSrc.connect(actx.destination);

  const videoStream = canvas.captureStream(60);
  const stream = new MediaStream([
    ...videoStream.getVideoTracks(),
    ...dest.stream.getAudioTracks(),
  ]);
  const { mime, ext } = pickMime();
  const rec = new MediaRecorder(stream, {
    ...(mime ? { mimeType: mime } : {}),
    videoBitsPerSecond: 8_000_000,
  });
  const chunks: BlobPart[] = [];
  rec.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  // 各イベントの譜面内時刻 (足アニメの補間・パネル発光用)
  const evTimesRef = chart.events.map((e) => timeAtBeat(timeline, e.row.beat));

  const drawFrame = (audioTime: number) => {
    const tSong = audioTime - o.offsetSec; // 譜面内時刻
    const curBeat = beatAtTime(timeline, Math.max(0, tSong));

    // 背景 (ページと同じ斜めストライプ)
    ctx.fillStyle = `#${o.bgColor}`;
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.rotate((-25 * Math.PI) / 180);
    for (let x = -H * 2; x < W + H * 2; x += 72) {
      ctx.fillStyle = (x / 72) % 2 === 0 ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.045)";
      ctx.fillRect(x, -W, 72, W * 2 + H * 2);
    }
    ctx.restore();

    // ヘッダ: ジャケット + タイトル + BPM
    const jSize = 170;
    if (o.jacket) {
      ctx.save();
      ctx.beginPath();
      ctx.roundRect
        ? ctx.roundRect(40, 40, jSize, jSize, 14)
        : ctx.rect(40, 40, jSize, jSize);
      ctx.clip();
      ctx.drawImage(o.jacket, 40, 40, jSize, jSize);
      ctx.restore();
      ctx.strokeStyle = "rgba(255,255,255,0.65)";
      ctx.lineWidth = 3;
      ctx.strokeRect(40, 40, jSize, jSize);
    }
    const textX = o.jacket ? 40 + jSize + 26 : 40;
    ctx.fillStyle = fg;
    ctx.font = "800 40px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(o.title, textX, 62, W - textX - 40);
    ctx.font = "700 28px ui-monospace, monospace";
    ctx.globalAlpha = 0.85;
    ctx.fillText(`♩=${o.bpmLabel}`, textX, 118);
    ctx.globalAlpha = 0.6;
    ctx.font = "700 22px system-ui, sans-serif";
    ctx.fillText("step-analyzer", textX, 160);
    ctx.globalAlpha = 1;

    // レーン背景
    ctx.fillStyle = "#17181c";
    ctx.fillRect(LANE_X - 8, HEADER_H, LANE_W * 4 + 16, LANE_BOTTOM - HEADER_H);

    const yOf = (beat: number) => RECEPTOR_Y + (beat - curBeat) * pxPerBeat;
    const clipTop = RECEPTOR_Y - NOTE / 2; // 受け皿上端より上は描かない
    ctx.save();
    ctx.beginPath();
    const clipY = Math.max(HEADER_H, clipTop);
    ctx.rect(LANE_X - 8, clipY, LANE_W * 4 + 16, LANE_BOTTOM - clipY);
    ctx.clip();

    // 体の向きバンド
    chart.events.forEach((ev, i) => {
      const color = facingColor(footsteps[i].facing);
      if (!color) return;
      const bandStart = i > 0 ? chart.events[i - 1].row.beat : 0;
      const y1 = yOf(bandStart);
      const y2 = yOf(ev.row.beat);
      if (y2 < HEADER_H || y1 > H) return;
      ctx.fillStyle = color;
      ctx.fillRect(LANE_X - 8, y1, LANE_W * 4 + 16, y2 - y1);
    });

    // 小節線
    const beatTop = curBeat + (clipTop - RECEPTOR_Y) / pxPerBeat;
    const beatBottom = curBeat + (H - RECEPTOR_Y) / pxPerBeat;
    for (
      let m = Math.max(0, Math.floor(beatTop / 4));
      m * 4 <= beatBottom && m <= chart.measures.length;
      m++
    ) {
      const y = yOf(m * 4);
      ctx.strokeStyle = "rgba(255,255,255,0.22)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(LANE_X - 8, y);
      ctx.lineTo(LANE_X + LANE_W * 4 + 8, y);
      ctx.stroke();
      if (m < chart.measures.length) {
        ctx.fillStyle = "rgba(255,255,255,0.45)";
        ctx.font = "700 24px ui-monospace, monospace";
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.fillText(String(m + 1), LANE_X - 2, y + 6);
      }
    }

    // フリーズ (保持足の色)。判定線より上は消費済みとして描かない
    for (const s of segs) {
      const a = Math.max(s.start, curBeat);
      const b = s.end;
      if (b <= a || yOf(a) > H) continue;
      ctx.fillStyle = s.roll
        ? "#ff9f43"
        : s.foot === "L"
        ? "rgba(255, 92, 168, 0.72)"
        : s.foot === "R"
        ? "rgba(56, 189, 248, 0.72)"
        : "#2ecc71";
      const x = LANE_X + s.panel * LANE_W + (LANE_W - NOTE) / 2 + 16;
      ctx.fillRect(x, yOf(a), NOTE - 32, yOf(b) - yOf(a));
    }

    // ショックアロー行
    for (const r of chart.shocks) {
      if (r.beat < curBeat - 0.05 || yOf(r.beat) > H + NOTE) continue;
      const y = yOf(r.beat);
      ctx.fillStyle = "rgba(125, 249, 255, 0.16)";
      ctx.fillRect(LANE_X, y - NOTE * 0.3, LANE_W * 4, NOTE * 0.6);
      for (let p = 0; p < 4; p++) {
        drawGhostArrow(
          ctx,
          LANE_X + p * LANE_W + LANE_W / 2,
          y,
          NOTE * 0.5,
          ARROW_ROTATIONS[p],
          "#7df9ff",
          "rgba(125, 249, 255, 0.16)"
        );
      }
    }

    // ノーツ (判定済みは非表示)
    chart.events.forEach((ev, i) => {
      const beat = ev.row.beat;
      if (beat < curBeat - 1e-6) return;
      const y = yOf(beat);
      if (y > H + NOTE) return;
      const step = footsteps[i];
      for (const p of ev.panels) {
        const cx = LANE_X + p * LANE_W + LANE_W / 2;
        if (ev.ghostPanels.includes(p)) {
          drawGhostArrow(ctx, cx, y, NOTE, ARROW_ROTATIONS[p]);
        } else {
          drawArrow(ctx, cx, y, NOTE, ARROW_ROTATIONS[p], QUANT_COLORS[ev.row.quant] ?? "#9aa3b5");
        }
        const foot = step.feet[p];
        if (foot) {
          // バッジはスケールを掛けて描く (chartImage側は9px固定のため)
          const k = NOTE / 60;
          ctx.save();
          ctx.translate(cx + NOTE / 2 - 10, y - NOTE / 2 + 10);
          ctx.scale(k, k);
          drawFootBadge(ctx, 0, 0, foot, false);
          ctx.restore();
        }
      }
    });
    ctx.restore();

    // 受け皿 (直近で踏んだパネルは足の色で光る)
    let hitIdx = -1;
    for (let k = 0; k < chart.events.length; k++) {
      if (chart.events[k].row.beat <= curBeat + 1e-6) hitIdx = k;
      else break;
    }
    const hitEvent =
      hitIdx >= 0 &&
      tSong - timeAtBeat(timeline, chart.events[hitIdx].row.beat) < 0.18
        ? chart.events[hitIdx]
        : null;
    for (let p = 0; p < 4; p++) {
      const hit = hitEvent?.panels.includes(p) ?? false;
      const foot = hit && hitIdx >= 0 ? footsteps[hitIdx].feet[p] : null;
      const path = new Path2D(ARROW_PATH);
      ctx.save();
      ctx.translate(LANE_X + p * LANE_W + LANE_W / 2, RECEPTOR_Y);
      ctx.rotate((ARROW_ROTATIONS[p] * Math.PI) / 180);
      const s = NOTE / 64;
      ctx.scale(s, s);
      ctx.translate(-32, -33);
      ctx.lineJoin = "round";
      ctx.fillStyle = foot ? FOOT_COLORS[foot] : "rgba(255,255,255,0.05)";
      ctx.fill(path);
      ctx.strokeStyle = hit ? "#ffffff" : "#5a6390";
      ctx.lineWidth = 5;
      ctx.stroke(path);
      ctx.restore();
    }

    // 足パッド (簡易透視投影で3D感を出す)
    const evTimes = evTimesRef;
    let footIdx = -1;
    const tLead = tSong + FOOT_TRAVEL;
    for (let k = 0; k < chart.events.length; k++) {
      if (evTimes[k] <= tLead + 1e-6) footIdx = k;
      else break;
    }
    const stepFlash =
      footIdx >= 0 && tSong - evTimes[footIdx] > -FOOT_TRAVEL && tSong - evTimes[footIdx] < 0.18
        ? chart.events[footIdx]
        : null;
    // パネル: グリッドの四隅を投影した台形として描く
    for (let p = 0; p < 4; p++) {
      const c = STAGE_CENTERS[p];
      const lit = stepFlash?.panels.includes(p) && tSong - evTimes[footIdx] >= -0.02;
      const litFoot = lit && footIdx >= 0 ? footsteps[footIdx].feet[p] : null;
      const m = 0.44; // パネル半径 (グリッド単位)
      const corners = [
        padProject(c.x - m, c.y - m),
        padProject(c.x + m, c.y - m),
        padProject(c.x + m, c.y + m),
        padProject(c.x - m, c.y + m),
      ];
      ctx.beginPath();
      ctx.moveTo(corners[0].x, corners[0].y);
      for (let k = 1; k < 4; k++) ctx.lineTo(corners[k].x, corners[k].y);
      ctx.closePath();
      // 奥を暗くして立体感を出す
      const g = ctx.createLinearGradient(0, corners[0].y, 0, corners[2].y);
      if (lit && litFoot) {
        g.addColorStop(0, `${FOOT_COLORS[litFoot]}44`);
        g.addColorStop(1, `${FOOT_COLORS[litFoot]}77`);
      } else {
        g.addColorStop(0, "rgba(14, 15, 18, 0.72)");
        g.addColorStop(1, "rgba(34, 36, 42, 0.72)");
      }
      ctx.fillStyle = g;
      ctx.fill();
      ctx.strokeStyle = lit && litFoot ? FOOT_COLORS[litFoot] : "rgba(255,255,255,0.25)";
      ctx.lineWidth = lit ? 5 : 2.5;
      ctx.stroke();
      // パネルの矢印 (うっすら、行スケールと圧縮を反映)
      const pc = padProject(c.x, c.y);
      ctx.save();
      ctx.globalAlpha = 0.3;
      const path = new Path2D(ARROW_PATH);
      ctx.translate(pc.x, pc.y);
      ctx.scale(pc.s, pc.s * PAD_SQUASH * 1.25);
      ctx.rotate((ARROW_ROTATIONS[p] * Math.PI) / 180);
      const sk = (PAD_CELL * 0.5) / 64;
      ctx.scale(sk, sk);
      ctx.translate(-32, -33);
      ctx.strokeStyle = "#8a93b5";
      ctx.lineWidth = 6;
      ctx.stroke(path);
      ctx.restore();
    }
    // 足 (直前ステップから0.25秒かけて補間移動 + 着地ホップ + 影)
    if (footIdx >= 0) {
      const cur = footPoseOf(footsteps[footIdx]);
      const prev = footIdx > 0 ? footPoseOf(footsteps[footIdx - 1]) : cur;
      const t0f = evTimes[footIdx] - FOOT_TRAVEL;
      const pr = Math.max(0, Math.min(1, (tSong - t0f) / FOOT_TRAVEL));
      const ease = pr * (2 - pr); // ease-out
      const heldFeet = footsteps[footIdx].heldFeet;
      const lifted = footsteps[footIdx].liftedFoot;
      const sincePlay = tSong - evTimes[footIdx];
      const stepped = footsteps[footIdx];
      const drawFoot = (foot: Foot, gx: number, gy: number, rot: number) => {
        const pc = padProject(gx, gy);
        // 着地直後のホップ (踏んだ足だけ少し拡大して戻る)
        const isStepping =
          stepFlash !== null &&
          sincePlay >= -0.02 &&
          sincePlay < 0.15 &&
          stepFlash.panels.some((pp) => stepped.feet[pp] === foot);
        const hop = isStepping ? 1 + 0.16 * (1 - sincePlay / 0.15) : 1;
        // 影 (足より少し下の楕円)
        ctx.save();
        ctx.globalAlpha = lifted === foot ? 0.18 : 0.32;
        ctx.fillStyle = "#000";
        ctx.beginPath();
        ctx.ellipse(pc.x, pc.y + 10 * pc.s, 40 * pc.s, 15 * pc.s, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        ctx.save();
        // 浮いた足は少し上に描いて「浮き」を表現
        ctx.translate(pc.x, pc.y - (lifted === foot ? 16 : 6) * pc.s);
        ctx.scale(pc.s * hop, pc.s * hop);
        ctx.scale(1, 0.8); // 床に寝ている感じの軽い圧縮
        ctx.rotate((rot * Math.PI) / 180);
        if (lifted === foot) ctx.globalAlpha = 0.6;
        const fw = 54;
        const fh = 96;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(-fw / 2, -fh / 2, fw, fh, 27);
        else ctx.rect(-fw / 2, -fh / 2, fw, fh);
        ctx.fillStyle = FOOT_COLORS[foot];
        ctx.fill();
        ctx.lineWidth = 5;
        ctx.strokeStyle = heldFeet.includes(foot) ? "#00e0a0" : "#ffffff";
        ctx.stroke();
        ctx.fillStyle = "#ffffff";
        ctx.font = "800 42px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(foot, 0, 2);
        ctx.restore();
      };
      drawFoot(
        "L",
        lerp(prev.lx, cur.lx, ease),
        lerp(prev.ly, cur.ly, ease),
        lerpAngle(prev.lRot, cur.lRot, ease)
      );
      drawFoot(
        "R",
        lerp(prev.rx, cur.rx, ease),
        lerp(prev.ry, cur.ry, ease),
        lerpAngle(prev.rRot, cur.rRot, ease)
      );
    }

    // 下部プログレスバー
    const ratio = Math.max(0, Math.min(1, (audioTime - recStart) / durationSec));
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.fillRect(0, H - 10, W, 10);
    ctx.fillStyle = "#00e0a0";
    ctx.fillRect(0, H - 10, W * ratio, 10);
  };

  return new Promise<{ blob: Blob; ext: string }>((resolve, reject) => {
    let raf = 0;
    const cleanup = () => {
      cancelAnimationFrame(raf);
      try {
        src.stop();
      } catch {
        // 既に停止済みなら無視
      }
      try {
        clapSrc.stop();
      } catch {
        // 既に停止済みなら無視
      }
      void actx.close();
    };
    rec.onstop = () => {
      cleanup();
      resolve({ blob: new Blob(chunks, { type: mime || "video/webm" }), ext });
    };
    rec.onerror = () => {
      cleanup();
      reject(new Error("録画に失敗しました"));
    };

    const t0 = actx.currentTime;
    src.start(0, Math.min(recStart, Math.max(0, o.audio.duration - 0.1)));
    clapSrc.start(0);
    rec.start(1000);
    const tick = () => {
      if (o.signal?.cancelled) {
        rec.stop();
        return;
      }
      const audioTime = recStart + (actx.currentTime - t0);
      drawFrame(audioTime);
      o.onProgress?.(Math.max(0, Math.min(1, (audioTime - recStart) / durationSec)));
      if (audioTime >= songEnd) {
        rec.stop();
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  });
}

/** プロキシ経由で音源を取得してデコードする */
export async function loadAudioFromUrl(url: string): Promise<AudioBuffer> {
  const res = await fetch(`/api/media?url=${encodeURIComponent(url)}`);
  if (!res.ok) {
    const j = await res.json().catch(() => null);
    throw new Error(j?.error ?? `音源の取得に失敗しました (HTTP ${res.status})`);
  }
  const buf = await res.arrayBuffer();
  const actx = new AudioContext();
  try {
    return await actx.decodeAudioData(buf);
  } catch {
    throw new Error(
      "音源をデコードできませんでした (Safariはogg非対応です。mp3/m4aのURLを試してください)"
    );
  } finally {
    void actx.close();
  }
}

/** プロキシ経由でジャケット画像を取得する */
export async function loadImageFromUrl(url: string): Promise<HTMLImageElement> {
  const res = await fetch(`/api/media?url=${encodeURIComponent(url)}`);
  if (!res.ok) {
    const j = await res.json().catch(() => null);
    throw new Error(j?.error ?? `画像の取得に失敗しました (HTTP ${res.status})`);
  }
  const blob = await res.blob();
  const img = new Image();
  const objUrl = URL.createObjectURL(blob);
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("画像を読み込めませんでした"));
      img.src = objUrl;
    });
  } finally {
    // 描画中も参照が生きるようrevokeはロード完了後でよい
    URL.revokeObjectURL(objUrl);
  }
  return img;
}
