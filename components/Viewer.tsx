"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ARROW_ROTATIONS,
  FOOT_COLORS,
  QUANT_COLORS,
  assignFeet,
  parseCompact,
  statsOf,
  type Foot,
} from "@/lib/chart";
import Arrow from "./Arrow";

const PX_PER_BEAT = 72;
const NOTE_SIZE = 40;
const LANE_W = 52;

// パッド上のパネル配置: [row][col] → パネル番号 or null
const PAD_LAYOUT: (number | null)[][] = [
  [null, 2, null],
  [0, null, 3],
  [null, 1, null],
];

export default function Viewer({
  compact,
  title,
  bpm,
}: {
  compact: string;
  title?: string;
  bpm?: string;
}) {
  const parsed = useMemo(() => {
    try {
      return { chart: parseCompact(compact), error: null };
    } catch (e) {
      return { chart: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [compact]);

  const [current, setCurrent] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const chart = parsed.chart;
  const footsteps = useMemo(() => (chart ? assignFeet(chart.events) : []), [chart]);
  const stats = useMemo(() => statsOf(footsteps), [footsteps]);

  const clamp = useCallback(
    (i: number) => Math.max(0, Math.min(footsteps.length - 1, i)),
    [footsteps.length]
  );

  const go = useCallback(
    (i: number) => setCurrent(clamp(i)),
    [clamp]
  );

  // キーボード操作 (←/→ or J/K)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)
        return;
      if (e.key === "ArrowRight" || e.key === "j") {
        e.preventDefault();
        setCurrent((c) => clamp(c + 1));
      } else if (e.key === "ArrowLeft" || e.key === "k") {
        e.preventDefault();
        setCurrent((c) => clamp(c - 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [clamp]);

  // 現在のイベントが見えるようにスクロール
  useEffect(() => {
    if (!chart || !scrollRef.current) return;
    const ev = chart.events[current];
    if (!ev) return;
    const y = ev.row.beat * PX_PER_BEAT;
    const el = scrollRef.current;
    el.scrollTo({ top: y - el.clientHeight / 2 + NOTE_SIZE, behavior: "smooth" });
  }, [current, chart]);

  if (!chart) {
    return (
      <div className="card">
        <h2>譜面を読み込めませんでした</h2>
        <p className="error">{parsed.error}</p>
        <p style={{ marginTop: 12 }}>
          <a href="/">トップに戻って譜面を入力する</a>
        </p>
      </div>
    );
  }

  const totalH = chart.totalBeats * PX_PER_BEAT + NOTE_SIZE;
  const curStep = footsteps[current];
  const curEvent = chart.events[current];

  return (
    <div>
      <div className="card" style={{ padding: "14px 20px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>
              {title || "無題の譜面"}
              {bpm && (
                <span style={{ color: "var(--muted)", fontSize: 13, marginLeft: 10 }}>
                  BPM {bpm}
                </span>
              )}
            </div>
            <div className="legend" style={{ marginTop: 8 }}>
              <span className="chip">
                <span className="dot" style={{ background: FOOT_COLORS.L }} /> 左足
              </span>
              <span className="chip">
                <span className="dot" style={{ background: FOOT_COLORS.R }} /> 右足
              </span>
              <span className="chip">
                <span className="dot" style={{ background: QUANT_COLORS[4] }} /> 4分
              </span>
              <span className="chip">
                <span className="dot" style={{ background: QUANT_COLORS[8] }} /> 8分
              </span>
              <span className="chip">
                <span className="dot" style={{ background: QUANT_COLORS[16] }} /> 16分
              </span>
            </div>
          </div>
          <div className="stats">
            <div className="stat">
              <div className="num">{stats.steps}</div>
              <div className="label">ステップ</div>
            </div>
            <div className="stat">
              <div className="num">{stats.jumps}</div>
              <div className="label">ジャンプ</div>
            </div>
            <div className="stat">
              <div className="num">{stats.jacks}</div>
              <div className="label">縦連</div>
            </div>
            <div className="stat">
              <div className="num">{stats.crossovers}</div>
              <div className="label">交差</div>
            </div>
          </div>
        </div>
      </div>

      <div className="viewer-layout">
        <div className="chart-pane">
          <div className="chart-scroll" ref={scrollRef}>
            <div
              className="chart-inner"
              style={{ width: LANE_W * 4, height: totalH }}
            >
              {/* 小節線・拍線・小節番号 */}
              {Array.from({ length: chart.measures.length + 1 }, (_, m) => (
                <div key={`m${m}`}>
                  <div
                    className="measure-line"
                    style={{ top: m * 4 * PX_PER_BEAT + NOTE_SIZE / 2 }}
                  />
                  {m < chart.measures.length && (
                    <span
                      className="measure-num"
                      style={{ top: m * 4 * PX_PER_BEAT + NOTE_SIZE / 2 + 4 }}
                    >
                      {m + 1}
                    </span>
                  )}
                  {m < chart.measures.length &&
                    [1, 2, 3].map((b) => (
                      <div
                        key={b}
                        className="beat-line"
                        style={{ top: (m * 4 + b) * PX_PER_BEAT + NOTE_SIZE / 2 }}
                      />
                    ))}
                </div>
              ))}

              {/* フリーズ/ロールのボディ */}
              {chart.holds.map((h, i) => (
                <div
                  key={`h${i}`}
                  className="hold-body"
                  style={{
                    left: h.panel * LANE_W + (LANE_W - NOTE_SIZE) / 2 + 6,
                    top: h.startBeat * PX_PER_BEAT + NOTE_SIZE / 2,
                    width: NOTE_SIZE - 12,
                    height: (h.endBeat - h.startBeat) * PX_PER_BEAT,
                    background: h.roll ? "#ff9f43" : "#2ecc71",
                  }}
                />
              ))}

              {/* 地雷 */}
              {chart.mines.map((m, i) => (
                <div
                  key={`mine${i}`}
                  className="mine"
                  style={{
                    left: m.panel * LANE_W + (LANE_W - NOTE_SIZE) / 2,
                    top: m.beat * PX_PER_BEAT,
                    width: NOTE_SIZE,
                    height: NOTE_SIZE,
                    fontSize: NOTE_SIZE * 0.6,
                  }}
                  title="地雷 (踏まない)"
                >
                  ✕
                </div>
              ))}

              {/* ノート本体 */}
              {chart.events.map((ev, i) => {
                const step = footsteps[i];
                return ev.panels.map((p) => {
                  const foot = step.feet[p];
                  return (
                    <div
                      key={`${i}-${p}`}
                      className={`note${i === current ? " current" : ""}`}
                      style={{
                        left: p * LANE_W + (LANE_W - NOTE_SIZE) / 2,
                        top: ev.row.beat * PX_PER_BEAT,
                        width: NOTE_SIZE,
                        height: NOTE_SIZE,
                      }}
                      onClick={() => go(i)}
                      title={`${ev.row.measure + 1}小節目 / ${
                        foot === "L" ? "左足" : foot === "R" ? "右足" : "-"
                      }`}
                    >
                      <Arrow
                        size={NOTE_SIZE}
                        rotation={ARROW_ROTATIONS[p]}
                        color={QUANT_COLORS[ev.row.quant] ?? "#9aa3b5"}
                      />
                      {foot && (
                        <span
                          className="foot-badge"
                          style={{ background: FOOT_COLORS[foot] }}
                        >
                          {foot}
                        </span>
                      )}
                      {step.crossover && step.feet[p] && !step.jump && (
                        <span
                          className="note-flag"
                          style={{ background: "#705f2a", color: "#ffe9a3" }}
                        >
                          交差
                        </span>
                      )}
                      {step.jack && (
                        <span
                          className="note-flag"
                          style={{ background: "#703a2a", color: "#ffc9b6" }}
                        >
                          縦連
                        </span>
                      )}
                    </div>
                  );
                });
              })}
            </div>
          </div>
        </div>

        <div className="side-pane">
          <div className="card">
            <h2>足の位置 (パネルビュー)</h2>
            <Pad
              leftPos={curStep?.leftPos ?? 0}
              rightPos={curStep?.rightPos ?? 3}
              stepping={curEvent?.panels ?? []}
              feet={curStep?.feet ?? [null, null, null, null]}
            />
            <div className="controls">
              <button className="secondary" onClick={() => go(0)}>
                ⏮
              </button>
              <button className="secondary" onClick={() => go(current - 1)}>
                ◀ 前
              </button>
              <span className="pos">
                {footsteps.length > 0 ? current + 1 : 0} / {footsteps.length}
              </span>
              <button className="secondary" onClick={() => go(current + 1)}>
                次 ▶
              </button>
            </div>
            <input
              type="range"
              min={0}
              max={Math.max(0, footsteps.length - 1)}
              value={current}
              onChange={(e) => go(Number(e.target.value))}
            />
            {curEvent && curStep && (
              <div className="event-info">
                <div>
                  {curEvent.row.measure + 1}小節目 —{" "}
                  {curEvent.panels
                    .map(
                      (p) =>
                        `${["←", "↓", "↑", "→"][p]} ${
                          curStep.feet[p] === "L"
                            ? "左足"
                            : curStep.feet[p] === "R"
                            ? "右足"
                            : ""
                        }`
                    )
                    .join(" + ")}
                </div>
                <div className="tags">
                  {curStep.jump && <span className="tag jump">ジャンプ</span>}
                  {curStep.jack && <span className="tag jack">縦連 (同じ足)</span>}
                  {curStep.crossover && (
                    <span className="tag crossover">交差 (体を捻る)</span>
                  )}
                </div>
              </div>
            )}
            <p className="hint" style={{ marginTop: 12 }}>
              ← / → キーまたは J / K でも操作できます。譜面のノートをクリックするとその位置へジャンプします。
            </p>
          </div>
          <div className="card">
            <p className="hint">
              このページのURLをそのままXなどに貼ると、この譜面のプレビュー画像付きで共有できます。
            </p>
            <p style={{ marginTop: 10 }}>
              <a href="/">別の譜面を入力する</a>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Pad({
  leftPos,
  rightPos,
  stepping,
  feet,
}: {
  leftPos: number;
  rightPos: number;
  stepping: number[];
  feet: (Foot | null)[];
}) {
  return (
    <div className="pad">
      {PAD_LAYOUT.flat().map((panel, i) => {
        if (panel === null) return <div key={i} className="pad-cell" />;
        const hasL = leftPos === panel;
        const hasR = rightPos === panel;
        const isStepping = stepping.includes(panel);
        const activeClass = isStepping
          ? feet[panel] === "L"
            ? " active-L"
            : feet[panel] === "R"
            ? " active-R"
            : " active-LR"
          : "";
        return (
          <div key={i} className={`pad-cell pad-panel${activeClass}`}>
            <span className="pad-arrow">
              <Arrow
                size={40}
                rotation={ARROW_ROTATIONS[panel]}
                color="#5a6390"
              />
            </span>
            {hasL && (
              <span
                className={`foot-marker${isStepping && feet[panel] === "L" ? " stepping" : ""}`}
                style={{
                  background: FOOT_COLORS.L,
                  left: hasR ? 4 : undefined,
                }}
              >
                L
              </span>
            )}
            {hasR && (
              <span
                className={`foot-marker${isStepping && feet[panel] === "R" ? " stepping" : ""}`}
                style={{
                  background: FOOT_COLORS.R,
                  right: hasL ? 4 : undefined,
                }}
              >
                R
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
