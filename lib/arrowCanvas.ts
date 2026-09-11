// Shared arrow artwork for chart images and embedded video frames.
import {
  ARROW_CRYSTAL_LOWER,
  ARROW_CRYSTAL_UPPER,
  ARROW_HEAD_STRIPE,
  ARROW_PATH,
  lighten,
  darken,
} from "./arrowShape";
import { FOOT_COLORS, type Foot } from "./chart";
const INK = "#17181c";

// 64x64ビューボックスのパスを (cx, cy) 中心・size幅・rotation度で描く準備
function withArrowTransform(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
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

export function drawArrow(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
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
    const gradient = ctx.createLinearGradient(0, 0, 0, 64);
    gradient.addColorStop(0, lighten(color, 0.35));
    gradient.addColorStop(0.55, color);
    gradient.addColorStop(1, darken(color, 0.35));
    ctx.fillStyle = gradient;
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

export function drawGhostArrow(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
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

export function drawFootBadge(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
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

