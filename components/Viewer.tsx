"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ARROW_ROTATIONS,
  FOOT_COLORS,
  QUANT_COLORS,
  assignFeet,
  parseCompact,
  statsOf,
  tickOf,
  type Foot,
} from "@/lib/chart";
import { parseOverrides, serializeOverrides, toggleNote } from "@/lib/edit";
import Arrow from "./Arrow";

// パッド上のパネル配置: [row][col] → パネル番号 or null
const PAD_LAYOUT: (number | null)[][] = [
  [null, 2, null],
  [0, null, 3],
  [null, 1, null],
];

const EDIT_RESOLUTIONS = [4, 8, 12, 16, 24];

export default function Viewer({
  compact: initialCompact,
  title,
  bpm,
  overrides: initialOverrides,
}: {
  compact: string;
  title?: string;
  bpm?: string;
  overrides?: string;
}) {
  const [compact, setCompact] = useState(initialCompact);
  const [overrides, setOverrides] = useState<Map<number, Foot>>(() =>
    parseOverrides(initialOverrides)
  );
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [editMode, setEditMode] = useState(false);
  const [editRes, setEditRes] = useState(16);
  const [narrow, setNarrow] = useState(false);
  const [copied, setCopied] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const beatRef = useRef(0);

  // 画面幅に応じて譜面の描画サイズを切り替える (スマホ縦持ち最優先)
  useEffect(() => {
    const update = () => setNarrow(window.innerWidth < 560);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const pxPerBeat = narrow ? 52 : 72;
  const noteSize = narrow ? 28 : 40;
  const laneW = narrow ? 36 : 52;

  const parsed = useMemo(() => {
    try {
      return { chart: parseCompact(compact), error: null };
    } catch (e) {
      return { chart: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [compact]);

  const chart = parsed.chart;
  const footsteps = useMemo(
    () => (chart ? assignFeet(chart.events, overrides) : []),
    [chart, overrides]
  );
  const stats = useMemo(() => statsOf(footsteps), [footsteps]);

  // 編集や足指定をURLへ反映 (このままコピーで共有できる)
  useEffect(() => {
    const qs = new URLSearchParams();
    qs.set("n", compact);
    if (title) qs.set("t", title);
    if (bpm) qs.set("b", bpm);
    if (overrides.size > 0) qs.set("f", serializeOverrides(overrides));
    window.history.replaceState(null, "", `/?${qs.toString()}`);
  }, [compact, overrides, title, bpm]);

  const clamp = useCallback(
    (i: number) => Math.max(0, Math.min(footsteps.length - 1, i)),
    [footsteps.length]
  );

  const go = useCallback(
    (i: number) => {
      const idx = clamp(i);
      setCurrent(idx);
      if (chart && chart.events[idx]) beatRef.current = chart.events[idx].row.beat;
    },
    [clamp, chart]
  );

  // キーボード操作 (←/→ or J/K、スペースで再生/停止)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)
        return;
      if (e.key === "ArrowRight" || e.key === "j") {
        e.preventDefault();
        setPlaying(false);
        go(current + 1);
      } else if (e.key === "ArrowLeft" || e.key === "k") {
        e.preventDefault();
        setPlaying(false);
        go(current - 1);
      } else if (e.key === " ") {
        e.preventDefault();
        setPlaying((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, current]);

  // 自動再生: BPMに合わせて譜面をスクロールし、足を進める
  useEffect(() => {
    if (!playing || !chart) return;
    const bpmN = Number(bpm) > 0 ? Number(bpm) : 120;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      beatRef.current += (bpmN / 60) * dt * speed;
      if (beatRef.current >= chart.totalBeats) {
        beatRef.current = chart.totalBeats;
        setPlaying(false);
      }
      let idx = -1;
      for (let k = 0; k < chart.events.length; k++) {
        if (chart.events[k].row.beat <= beatRef.current + 1e-6) idx = k;
        else break;
      }
      if (idx >= 0) setCurrent((c) => (c !== idx ? idx : c));
      const el = scrollRef.current;
      if (el) el.scrollTop = beatRef.current * pxPerBeat - el.clientHeight * 0.4;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, chart, bpm, speed, pxPerBeat]);

  // 手動操作時に現在のイベントが見えるようにスクロール
  useEffect(() => {
    if (playing || !chart || !scrollRef.current) return;
    const ev = chart.events[current];
    if (!ev) return;
    const el = scrollRef.current;
    el.scrollTo({
      top: ev.row.beat * pxPerBeat - el.clientHeight / 2 + noteSize,
      behavior: "smooth",
    });
  }, [current, chart, playing, pxPerBeat, noteSize]);

  const copyUrl = async () => {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

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

  const totalH = chart.totalBeats * pxPerBeat + noteSize;
  const curStep = footsteps[current];
  const curEvent = chart.events[current];
  const curTick = curEvent ? tickOf(curEvent.row.beat) : null;
  const curOverride = curTick !== null ? overrides.get(curTick) : undefined;

  const setOverride = (foot: Foot | null) => {
    if (curTick === null) return;
    const next = new Map(overrides);
    if (foot === null) next.delete(curTick);
    else next.set(curTick, foot);
    setOverrides(next);
  };

  const onNoteClick = (evIdx: number, ev: (typeof chart.events)[number], panel: number) => {
    if (editMode) {
      setPlaying(false);
      setCompact(toggleNote(compact, ev.row.measure, ev.row.idx, ev.row.total, panel));
    } else {
      setPlaying(false);
      go(evIdx);
    }
  };

  return (
    <div>
      <div className="card head-card">
        <div className="head-row">
          <div>
            <div className="chart-title">
              {title || "無題の譜面"}
              {bpm && <span className="bpm">BPM {bpm}</span>}
            </div>
            <div className="legend">
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
                <span className="dot" style={{ background: QUANT_COLORS[12] }} /> 12分
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

      <div className="toolbar">
        <button
          className={editMode ? "" : "secondary"}
          onClick={() => {
            setPlaying(false);
            setEditMode(!editMode);
          }}
        >
          {editMode ? "✎ 編集中" : "✎ 編集"}
        </button>
        {editMode && (
          <select value={editRes} onChange={(e) => setEditRes(Number(e.target.value))}>
            {EDIT_RESOLUTIONS.map((r) => (
              <option key={r} value={r}>
                {r}分で配置
              </option>
            ))}
          </select>
        )}
        <span className="toolbar-spacer" />
        <button className="secondary" onClick={copyUrl}>
          {copied ? "コピーしました" : "URLをコピー"}
        </button>
      </div>

      <div className="viewer-layout">
        <div className="chart-pane">
          <div className="chart-scroll" ref={scrollRef}>
            <div className="chart-inner" style={{ width: laneW * 4, height: totalH }}>
              {/* 小節線・拍線・小節番号 */}
              {Array.from({ length: chart.measures.length + 1 }, (_, m) => (
                <div key={`m${m}`}>
                  <div
                    className="measure-line"
                    style={{ top: m * 4 * pxPerBeat + noteSize / 2 }}
                  />
                  {m < chart.measures.length && (
                    <span
                      className="measure-num"
                      style={{ top: m * 4 * pxPerBeat + noteSize / 2 + 4 }}
                    >
                      {m + 1}
                    </span>
                  )}
                  {m < chart.measures.length &&
                    [1, 2, 3].map((b) => (
                      <div
                        key={b}
                        className="beat-line"
                        style={{ top: (m * 4 + b) * pxPerBeat + noteSize / 2 }}
                      />
                    ))}
                </div>
              ))}

              {/* 編集モードの配置グリッド */}
              {editMode &&
                chart.measures.map((_, mi) =>
                  Array.from({ length: editRes }, (_, r) => {
                    const beat = mi * 4 + (r / editRes) * 4;
                    const cellH = Math.min(noteSize, (4 * pxPerBeat) / editRes - 1);
                    return [0, 1, 2, 3].map((p) => (
                      <div
                        key={`e${mi}-${r}-${p}`}
                        className="edit-cell"
                        style={{
                          left: p * laneW + (laneW - noteSize) / 2,
                          top: beat * pxPerBeat + noteSize / 2 - cellH / 2,
                          width: noteSize,
                          height: cellH,
                        }}
                        onClick={() => {
                          setPlaying(false);
                          setCompact(toggleNote(compact, mi, r, editRes, p));
                        }}
                      />
                    ));
                  })
                )}

              {/* フリーズ/ロールのボディ */}
              {chart.holds.map((h, i) => (
                <div
                  key={`h${i}`}
                  className="hold-body"
                  style={{
                    left: h.panel * laneW + (laneW - noteSize) / 2 + 6,
                    top: h.startBeat * pxPerBeat + noteSize / 2,
                    width: noteSize - 12,
                    height: (h.endBeat - h.startBeat) * pxPerBeat,
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
                    left: m.panel * laneW + (laneW - noteSize) / 2,
                    top: m.beat * pxPerBeat,
                    width: noteSize,
                    height: noteSize,
                    fontSize: noteSize * 0.6,
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
                  const hasOverride = overrides.has(tickOf(ev.row.beat));
                  return (
                    <div
                      key={`${i}-${p}`}
                      className={`note${i === current && !editMode ? " current" : ""}`}
                      style={{
                        left: p * laneW + (laneW - noteSize) / 2,
                        top: ev.row.beat * pxPerBeat,
                        width: noteSize,
                        height: noteSize,
                      }}
                      onClick={() => onNoteClick(i, ev, p)}
                    >
                      <Arrow
                        size={noteSize}
                        rotation={ARROW_ROTATIONS[p]}
                        color={QUANT_COLORS[ev.row.quant] ?? "#9aa3b5"}
                      />
                      {foot && (
                        <span
                          className={`foot-badge${hasOverride ? " pinned" : ""}`}
                          style={{ background: FOOT_COLORS[foot] }}
                        >
                          {foot}
                        </span>
                      )}
                      {step.crossover && step.feet[p] && !step.jump && (
                        <span className="note-flag flag-cross">交差</span>
                      )}
                      {step.jack && (
                        <span className="note-flag flag-jack">縦連</span>
                      )}
                    </div>
                  );
                });
              })}
            </div>
          </div>
        </div>

        <div className="side-pane">
          <div className="card pad-card">
            <Pad
              leftPos={curStep?.leftPos ?? 0}
              rightPos={curStep?.rightPos ?? 3}
              stepping={curEvent?.panels ?? []}
              feet={curStep?.feet ?? [null, null, null, null]}
            />
            <div className="controls">
              <button
                className="secondary"
                onClick={() => {
                  setPlaying(false);
                  go(0);
                  beatRef.current = 0;
                }}
                title="最初に戻る"
              >
                ⏮
              </button>
              <button
                onClick={() => {
                  if (!playing && curEvent) beatRef.current = curEvent.row.beat;
                  if (!playing && current >= footsteps.length - 1) {
                    go(0);
                    beatRef.current = 0;
                  }
                  setPlaying(!playing);
                }}
                title="再生 / 停止 (スペースキー)"
              >
                {playing ? "⏸ 停止" : "▶ 再生"}
              </button>
              <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
                <option value={0.5}>0.5×</option>
                <option value={0.75}>0.75×</option>
                <option value={1}>1×</option>
              </select>
            </div>
            <div className="controls">
              <button className="secondary" onClick={() => { setPlaying(false); go(current - 1); }}>
                ◀ 前
              </button>
              <span className="pos">
                {footsteps.length > 0 ? current + 1 : 0} / {footsteps.length}
              </span>
              <button className="secondary" onClick={() => { setPlaying(false); go(current + 1); }}>
                次 ▶
              </button>
            </div>
            <input
              type="range"
              min={0}
              max={Math.max(0, footsteps.length - 1)}
              value={current}
              onChange={(e) => {
                setPlaying(false);
                go(Number(e.target.value));
              }}
            />
            {curEvent && curStep && (
              <div className="event-info">
                <div>
                  {curEvent.row.measure + 1}小節目 —{" "}
                  {curEvent.panels
                    .map(
                      (p) =>
                        `${["←", "↓", "↑", "→"][p]}${
                          curStep.feet[p] === "L"
                            ? "左"
                            : curStep.feet[p] === "R"
                            ? "右"
                            : ""
                        }`
                    )
                    .join(" ")}
                </div>
                {curEvent.panels.length === 1 && (
                  <div className="override-row">
                    <span className="override-label">この足で踏む:</span>
                    <button
                      className={`ov-btn${curOverride === "L" ? " active-l" : ""}`}
                      onClick={() => setOverride(curOverride === "L" ? null : "L")}
                    >
                      左
                    </button>
                    <button
                      className={`ov-btn${curOverride === "R" ? " active-r" : ""}`}
                      onClick={() => setOverride(curOverride === "R" ? null : "R")}
                    >
                      右
                    </button>
                    {curOverride && (
                      <button className="ov-btn" onClick={() => setOverride(null)}>
                        自動に戻す
                      </button>
                    )}
                  </div>
                )}
                <div className="tags">
                  {curStep.jump && <span className="tag jump">ジャンプ</span>}
                  {curStep.jack && <span className="tag jack">縦連 (同じ足)</span>}
                  {curStep.crossover && (
                    <span className="tag crossover">交差 (体を捻る)</span>
                  )}
                  {curStep.doubleStep && (
                    <span className="tag jack">踏み替え</span>
                  )}
                </div>
              </div>
            )}
            {overrides.size > 0 && (
              <div className="override-summary">
                手動指定 {overrides.size}件
                <button className="ov-btn" onClick={() => setOverrides(new Map())}>
                  全て解除
                </button>
              </div>
            )}
          </div>
          <div className="card hint-card">
            <p className="hint">
              ノートのL/Rバッジ付近をタップで選択、「この足で踏む」で起点を固定して再計算。
              編集モード中はグリッドをタップしてノーツを追加/削除できます。
              このページのURLをコピーすれば、編集・足指定込みで共有できます。
            </p>
            <p style={{ marginTop: 8 }}>
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
                size={36}
                rotation={ARROW_ROTATIONS[panel]}
                color="#5a6390"
                detail={false}
              />
            </span>
            {hasL && (
              <span
                className={`foot-marker${isStepping && feet[panel] === "L" ? " stepping" : ""}`}
                style={{ background: FOOT_COLORS.L, left: hasR ? 2 : undefined }}
              >
                L
              </span>
            )}
            {hasR && (
              <span
                className={`foot-marker${isStepping && feet[panel] === "R" ? " stepping" : ""}`}
                style={{ background: FOOT_COLORS.R, right: hasL ? 2 : undefined }}
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
