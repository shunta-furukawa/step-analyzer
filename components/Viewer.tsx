"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ARROW_ROTATIONS,
  FOOT_COLORS,
  QUANT_COLORS,
  assignFeet,
  facingColor,
  parseCompact,
  statsOf,
  tickOf,
  type Foot,
} from "@/lib/chart";
import { buildClapTrackUrl, setPlaybackAudioSession } from "@/lib/clap";
import { compressCompact } from "@/lib/codec";
import { parseOverrides, serializeOverrides, toggleNote } from "@/lib/edit";
import {
  beatAtTime,
  bpmAtBeat,
  buildTimeline,
  extractTimingFromSM,
  normalizeParam,
  parseBpmParam,
  parseStopsParam,
  sanitizeTimingInput,
  timeAtBeat,
} from "@/lib/timing";
import { listSmCharts, normalizeNotesInput, type SmChartInfo } from "@/lib/url";
import { ARROW_PATH, ARROW_VIEWBOX } from "@/lib/arrowShape";
import Arrow from "./Arrow";

const EDIT_RESOLUTIONS = [4, 8, 12, 16, 24];
const HISPEED_OPTIONS = [0.5, 0.75, 1, 1.5, 2, 3];
const SPEED_OPTIONS = [0.25, 0.5, 0.75, 1];

// URLパラメータの値を選択肢のうち最も近いものに丸める
function parseChoice(v: string | undefined, options: number[], def: number): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return def;
  let best = def;
  let dist = Infinity;
  for (const o of options) {
    const d = Math.abs(o - n);
    if (d < dist) {
      dist = d;
      best = o;
    }
  }
  return best;
}
// フルスクリーンモードのステップゾーン位置 (譜面エリア上端からの中心距離)
const RECEPTOR_Y = 90;

// 背景色のデフォルト (DDR WORLDミントグリーン)
const DEFAULT_BG = "29d6a2";

export default function Viewer({
  compact: initialCompact,
  title: initialTitle,
  bpm: initialBpm,
  stops: initialStops,
  overrides: initialOverrides,
  hispeed: initialHispeed,
  speed: initialSpeed,
  bg: initialBg,
}: {
  compact: string;
  title?: string;
  bpm?: string;
  stops?: string;
  overrides?: string;
  hispeed?: string;
  speed?: string;
  bg?: string;
}) {
  const [compact, setCompact] = useState(initialCompact);
  const [title, setTitle] = useState(initialTitle ?? "");
  const [bpm, setBpm] = useState(() => normalizeParam(initialBpm ?? ""));
  const [stops, setStops] = useState(() => normalizeParam(initialStops ?? ""));
  const [showTiming, setShowTiming] = useState(false);
  const [overrides, setOverrides] = useState<Map<number, Foot>>(() =>
    parseOverrides(initialOverrides)
  );
  const [dirty, setDirty] = useState(false);
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(() => parseChoice(initialSpeed, SPEED_OPTIONS, 1));
  const [hispeed, setHispeed] = useState(() =>
    parseChoice(initialHispeed, HISPEED_OPTIONS, 1)
  );
  const [muted, setMuted] = useState(false);
  const [bgColor, setBgColor] = useState(() =>
    initialBg && /^[0-9a-fA-F]{6}$/.test(initialBg) ? initialBg.toLowerCase() : DEFAULT_BG
  );
  const [editMode, setEditMode] = useState(false);
  const [editRes, setEditRes] = useState(16);
  const [showText, setShowText] = useState(false);
  const [fs, setFs] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const [copied, setCopied] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const beatRef = useRef(0);
  const timeRef = useRef(0);
  // 仮想化: 描画するビート範囲 (画面内 + バッファ)
  const [viewBeats, setViewBeats] = useState({ a: 0, b: 120 });
  const clapTrackRef = useRef<{ key: string; el: HTMLAudioElement; url: string } | null>(
    null
  );
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  // 背景色をページ全体とブラウザUI (theme-color) に反映
  useEffect(() => {
    document.documentElement.style.setProperty("--page-bg", `#${bgColor}`);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", `#${bgColor}`);
  }, [bgColor]);

  // 画面幅に応じて譜面の描画サイズを切り替える (スマホ縦持ち最優先)
  useEffect(() => {
    const update = () => setNarrow(window.innerWidth < 560);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const fsLane =
    typeof window !== "undefined"
      ? Math.min(96, Math.floor((window.innerWidth - 16) / 4))
      : 80;
  const pxPerBeat = (fs ? fsLane * 1.4 : narrow ? 52 : 72) * hispeed;
  const noteSize = fs ? fsLane - 10 : narrow ? 28 : 40;
  const laneW = fs ? fsLane : narrow ? 36 : 52;

  const parsed = useMemo(() => {
    try {
      return { chart: parseCompact(compact), error: null };
    } catch (e) {
      return { chart: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [compact]);

  const chart = parsed.chart;
  const footsteps = useMemo(
    () => (chart ? assignFeet(chart.events, overrides, chart.holds) : []),
    [chart, overrides]
  );
  const stats = useMemo(() => statsOf(footsteps), [footsteps]);

  // ソフラン・停止のタイミングデータ
  const bpms = useMemo(() => parseBpmParam(bpm), [bpm]);
  const stopList = useMemo(() => parseStopsParam(stops), [stops]);
  const timeline = useMemo(
    () => (chart ? buildTimeline(bpms, stopList, chart.totalBeats) : []),
    [chart, bpms, stopList]
  );
  const hasSofran = bpms.length > 1 || stopList.length > 0;

  // 譜面が長い場合はdeflate圧縮したdパラメータを使い、URLを短くする。
  // "," と ":" はクエリ値として合法なのでエンコードせずそのまま残す
  // (共有経路での二重エンコードによる変速情報の消失を防ぐ)
  const buildUrl = useCallback(async () => {
    const enc = (v: string) =>
      encodeURIComponent(v).replace(/%2C/gi, ",").replace(/%3A/gi, ":");
    const parts: string[] = [];
    const encoded = await compressCompact(compact);
    if (encoded && encoded.length < compact.length) parts.push(`d=${encoded}`);
    else parts.push(`n=${compact}`);
    if (title) parts.push(`t=${encodeURIComponent(title)}`);
    if (bpm) parts.push(`b=${enc(bpm)}`);
    if (stops) parts.push(`s=${enc(stops)}`);
    if (overrides.size > 0) parts.push(`f=${serializeOverrides(overrides)}`);
    if (hispeed !== 1) parts.push(`hs=${hispeed}`);
    if (speed !== 1) parts.push(`sp=${speed}`);
    if (bgColor !== DEFAULT_BG) parts.push(`c=${bgColor}`);
    return `/?${parts.join("&")}`;
  }, [compact, title, bpm, stops, overrides, hispeed, speed, bgColor]);

  // 編集・足指定・タイトル変更をURLへ反映 (何か触るまでは書き換えない)。
  // カラーピッカーのドラッグ等で連続変更されるため、書き込みはデバウンスする
  // (iOS SafariはreplaceStateを10秒に100回超呼ぶとSecurityErrorで落ちる)
  useEffect(() => {
    if (!dirty) return;
    let alive = true;
    const timer = setTimeout(() => {
      void buildUrl().then((url) => {
        if (!alive) return;
        try {
          window.history.replaceState(null, "", url);
        } catch {
          // 回数制限に当たっても無視 (次のデバウンス書き込みで反映される)
        }
      });
    }, 350);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [dirty, buildUrl]);

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

  // クラップトラックの準備 (譜面・タイミング・再生速度が変わったら作り直す)。
  // playbackRateで減速するとクラップ1発ごとの音まで間延びするため、
  // 速度ごとに「間隔だけ引き伸ばし、波形はそのまま」のトラックを生成し
  // 常に等速で再生する。トラック上の時刻 = 曲内時刻 / speed。
  const prepareClapTrack = useCallback(() => {
    if (!chart || timeline.length === 0) return null;
    setPlaybackAudioSession();
    const key = `${compact}|${bpm}|${stops}|${speed}`;
    if (clapTrackRef.current?.key === key) return clapTrackRef.current.el;
    if (clapTrackRef.current) {
      clapTrackRef.current.el.pause();
      URL.revokeObjectURL(clapTrackRef.current.url);
    }
    const times = chart.events.map((e) => timeAtBeat(timeline, e.row.beat) / speed);
    const accents = chart.events.map((e) => e.panels.length >= 2);
    const url = buildClapTrackUrl(
      times,
      accents,
      timeAtBeat(timeline, chart.totalBeats) / speed
    );
    const el = new Audio(url);
    el.preload = "auto";
    el.setAttribute("playsinline", "");
    clapTrackRef.current = { key, el, url };
    return el;
  }, [chart, timeline, compact, bpm, stops, speed]);

  // 再生開始 (ユーザー操作の文脈で呼ぶこと: audio.play()の許可が必要)
  const startPlayback = useCallback(() => {
    if (!mutedRef.current) {
      const el = prepareClapTrack();
      if (el) {
        try {
          el.currentTime = timeAtBeat(timeline, beatRef.current) / speed;
        } catch {
          // メタデータ未ロードでも再生側で追従する
        }
        void el.play().catch(() => {});
      }
    }
    setPlaying(true);
  }, [prepareClapTrack, timeline, speed]);

  const togglePlay = useCallback(() => {
    if (playing) setPlaying(false);
    else startPlayback();
  }, [playing, startPlayback]);

  // フルスクリーン (Short撮影) モードの出入り
  const enterFs = useCallback(() => {
    setEditMode(false);
    setShowText(false);
    setShowTiming(false);
    setFs(true);
    startPlayback();
    try {
      void document.documentElement.requestFullscreen?.();
    } catch {
      /* iOS Safariなどは非対応でOK (CSSオーバーレイで代替) */
    }
  }, [startPlayback]);

  const exitFs = useCallback(() => {
    setFs(false);
    setPlaying(false);
    try {
      if (document.fullscreenElement) void document.exitFullscreen();
    } catch {
      /* noop */
    }
  }, []);

  // fs中は背面のスクロールを止める
  useEffect(() => {
    document.body.style.overflow = fs ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [fs]);

  // キーボード操作 (←/→ or J/K、スペースで再生/停止)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      )
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
        togglePlay();
      } else if (e.key === "Escape") {
        exitFs();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, current, togglePlay, exitFs]);

  // 自動再生: タイムライン (ソフラン・停止込み) に沿って時間基準で進行。
  // 譜面スクロール・足の動き・クラップ音をすべて時刻→拍の変換で同期する。
  useEffect(() => {
    if (!playing || !chart || timeline.length === 0) return;
    // 現在の拍位置から時刻を復元して再開
    timeRef.current = timeAtBeat(timeline, beatRef.current);
    // クラップトラック: 再生中は音声側をマスタークロックにする
    // (iOSの画面収録でrAFがスロットルされても音と同期が保たれる)。
    // トラックは速度込みでレンダリング済みなので常に等速再生
    const track = !mutedRef.current ? prepareClapTrack() : null;
    if (track) {
      if (Math.abs(track.currentTime * speed - timeRef.current) > 0.05) {
        try {
          track.currentTime = timeRef.current / speed;
        } catch {
          // メタデータ未ロード時は無視
        }
      }
      if (track.paused) void track.play().catch(() => {});
    }
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      if (track && !track.paused && track.readyState >= 2) {
        timeRef.current = track.currentTime * speed;
      } else {
        timeRef.current += dt * speed;
      }
      beatRef.current = beatAtTime(timeline, timeRef.current);
      if (beatRef.current >= chart.totalBeats - 1e-9) {
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
      if (el) {
        // fs時はステップゾーンに現在ビートが重なるよう合わせる
        el.scrollTop = fs
          ? beatRef.current * pxPerBeat + noteSize / 2 - RECEPTOR_Y
          : beatRef.current * pxPerBeat - el.clientHeight * 0.4;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      if (track) track.pause();
    };
  }, [playing, chart, timeline, speed, pxPerBeat, fs, noteSize, muted, prepareClapTrack]);

  // 仮想化: スクロール位置から描画対象のビート範囲を更新
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !chart) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const a = el.scrollTop / pxPerBeat - 8;
      const b2 = (el.scrollTop + el.clientHeight) / pxPerBeat + 8;
      setViewBeats((v) =>
        Math.abs(v.a - a) > 2 || Math.abs(v.b - b2) > 2 ? { a, b: b2 } : v
      );
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [pxPerBeat, chart]);

  // 手動操作時に現在のイベントが見えるようにスクロール
  useEffect(() => {
    if (playing || !chart || !scrollRef.current) return;
    const ev = chart.events[current];
    if (!ev) return;
    const el = scrollRef.current;
    el.scrollTo({
      top: fs
        ? ev.row.beat * pxPerBeat + noteSize / 2 - RECEPTOR_Y
        : ev.row.beat * pxPerBeat - el.clientHeight / 2 + noteSize,
      behavior: "smooth",
    });
  }, [current, chart, playing, pxPerBeat, noteSize, fs]);

  const copyUrl = async () => {
    const url = await buildUrl();
    await navigator.clipboard.writeText(window.location.origin + url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (!chart) {
    return (
      <div className="card">
        <h2>譜面を読み込めませんでした</h2>
        <p className="error">{parsed.error}</p>
        <p style={{ marginTop: 12 }}>
          <a href="/">トップに戻る</a>
        </p>
      </div>
    );
  }

  const totalH = chart.totalBeats * pxPerBeat + noteSize;
  const curStep = footsteps[current];
  const curEvent = chart.events[current];
  const curTick = curEvent ? tickOf(curEvent.row.beat) : null;
  const curOverride = curTick !== null ? overrides.get(curTick) : undefined;
  const facing = curStep?.facing ?? 0;

  const setOverride = (foot: Foot | null) => {
    if (curTick === null) return;
    const next = new Map(overrides);
    if (foot === null) next.delete(curTick);
    else next.set(curTick, foot);
    setOverrides(next);
    setDirty(true);
  };

  const applyEdit = (next: string) => {
    setPlaying(false);
    setCompact(next);
    setDirty(true);
  };

  return (
    <div className={fs ? "viewer-fs" : undefined}>
      <div className="bg-picker-wrap">
        {bgColor !== DEFAULT_BG && (
          <button
            className="secondary bg-reset"
            onClick={() => {
              setBgColor(DEFAULT_BG);
              setDirty(true);
            }}
            title="デフォルト色に戻す"
          >
            ↺
          </button>
        )}
        <input
          type="color"
          className="bg-picker"
          value={`#${bgColor}`}
          onChange={(e) => {
            setBgColor(e.target.value.slice(1).toLowerCase());
            setDirty(true);
          }}
          title="背景色をカスタマイズ"
        />
      </div>
      <div className="card head-card">
        <div className="head-row">
          <div style={{ minWidth: 0 }}>
            <div className="chart-title">
              {editingTitle ? (
                <input
                  type="text"
                  className="title-input"
                  value={title}
                  autoFocus
                  placeholder="タイトルを入力"
                  onChange={(e) => {
                    setTitle(e.target.value);
                    setDirty(true);
                  }}
                  onBlur={() => setEditingTitle(false)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") setEditingTitle(false);
                  }}
                />
              ) : (
                <button className="title-btn" onClick={() => setEditingTitle(true)}>
                  {title || "無題の譜面"} <span className="edit-pen">✎</span>
                </button>
              )}
              <span className="bpm">
                BPM{" "}
                <input
                  type="text"
                  inputMode="decimal"
                  className="bpm-input"
                  style={hasSofran ? { width: 116 } : undefined}
                  value={bpm}
                  placeholder="120"
                  onChange={(e) => {
                    setBpm(sanitizeTimingInput(e.target.value));
                    setDirty(true);
                  }}
                />
                {hasSofran && <span className="sofran-chip">変速</span>}
              </span>
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
              <span className="chip">
                <span className="facing-legend">
                  <span style={{ background: "rgba(255,92,168,0.5)" }} />
                  <span style={{ background: "rgba(255,92,168,0.2)" }} />
                  <span style={{ background: "rgba(56,189,248,0.2)" }} />
                  <span style={{ background: "rgba(56,189,248,0.5)" }} />
                </span>
                背景=体の向き (左←→右)
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
            <div className="stat">
              <div className="num">{stats.doubleSteps}</div>
              <div className="label">踏み替え</div>
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
          ✎ {editMode ? "編集中" : "編集"}
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
        <button className="secondary" onClick={() => setShowText(!showText)}>
          {narrow ? "テキスト" : "テキスト入力"}
        </button>
        <button
          className={hasSofran && !showTiming ? "" : "secondary"}
          onClick={() => setShowTiming(!showTiming)}
        >
          変速
        </button>
        <select
          value={hispeed}
          onChange={(e) => {
            setHispeed(Number(e.target.value));
            setDirty(true);
          }}
          title="ハイスピ (縦縮尺)"
        >
          {HISPEED_OPTIONS.map((h) => (
            <option key={h} value={h}>
              HS {h}×
            </option>
          ))}
        </select>
        <span className="toolbar-spacer" />
        <button className="secondary" onClick={copyUrl}>
          {copied ? "✓ コピー済" : narrow ? "コピー" : "URLをコピー"}
        </button>
      </div>

      {editMode && (
        <p className="hint edit-hint">
          グリッドをタップでノーツを追加、ノーツをタップで削除。結果は即URLに反映されます。
        </p>
      )}

      {showTiming && (
        <div className="card text-import">
          <PanelHead title="変速・停止">
            ソフラン (途中変速) と停止を設定できます。拍はSMの <code>#BPMS</code> /{" "}
            <code>#STOPS</code> と同じ0起点のビート単位 (1小節=4拍) です。
            SMファイルごと「テキスト入力」に貼り付けると自動で取り込まれます。
          </PanelHead>
          <div className="form-row">
            <label className="timing-label">
              BPM変化 (初期BPM,拍:BPM,…)
              <input
                type="text"
                value={bpm}
                placeholder="130,32:650,64:130"
                onChange={(e) => {
                  setBpm(sanitizeTimingInput(e.target.value));
                  setDirty(true);
                }}
              />
            </label>
            <label className="timing-label">
              停止 (拍:秒,…)
              <input
                type="text"
                value={stops}
                placeholder="48:0.5,52:0.25"
                onChange={(e) => {
                  setStops(sanitizeTimingInput(e.target.value));
                  setDirty(true);
                }}
              />
            </label>
          </div>
        </div>
      )}

      {showText && (
        <TextImport
          compact={compact}
          onApply={(next, timing) => {
            applyEdit(next);
            setOverrides(new Map());
            if (timing?.b) setBpm(timing.b);
            if (timing?.s !== undefined) setStops(timing.s);
            go(0);
            setShowText(false);
          }}
        />
      )}

      <div className="viewer-layout">
        <div className="chart-pane" onClick={fs ? togglePlay : undefined}>
          {fs && (
            <>
              <div
                className="fs-progress"
                style={{
                  width: `${chart.totalBeats > 0 ? Math.min(100, (100 * (chart.events[current]?.row.beat ?? 0)) / chart.totalBeats) : 0}%`,
                }}
              />
              <div className="fs-cover" style={{ height: RECEPTOR_Y + noteSize / 2 }}>
                <div className="fs-title">
                  <span className="fs-title-name">{title || "Step Analyzer"}</span>
                  {bpm && <span> · BPM {bpm}</span>}
                </div>
              </div>
              <div
                className="fs-receptors"
                style={{ top: RECEPTOR_Y - noteSize / 2, width: laneW * 4 }}
              >
                {[0, 1, 2, 3].map((p) => {
                  const hit = curEvent?.panels.includes(p) ?? false;
                  const foot = hit ? curStep?.feet[p] : null;
                  return (
                    <div
                      key={`${p}-${hit ? current : "idle"}`}
                      className={`receptor${hit ? " hit" : ""}`}
                      style={{ width: laneW, height: noteSize }}
                    >
                      <svg
                        width={noteSize}
                        height={noteSize}
                        viewBox={ARROW_VIEWBOX}
                        style={{ transform: `rotate(${ARROW_ROTATIONS[p]}deg)` }}
                      >
                        <path
                          d={ARROW_PATH}
                          fill={foot ? FOOT_COLORS[foot] : "rgba(255,255,255,0.05)"}
                          stroke={hit ? "#ffffff" : "#5a6390"}
                          strokeWidth={4}
                          strokeLinejoin="round"
                        />
                      </svg>
                    </div>
                  );
                })}
              </div>
              {!playing && <div className="fs-paused">▶</div>}
              <button
                className="fs-exit"
                onClick={(e) => {
                  e.stopPropagation();
                  exitFs();
                }}
              >
                ✕
              </button>
            </>
          )}
          <div className="chart-scroll" ref={scrollRef}>
            <div className="chart-inner" style={{ width: laneW * 4, height: totalH }}>
              {/* 体の向きの背景バンド: ノーツi-1→ノーツi の領域を
                  「ノーツiを踏んだときの向き」の色で塗る (これから来る捻りの予告)。
                  1ノーツ目は譜面先頭 (初期位置=正面) から塗る */}
              {chart.events.map((ev, i) => {
                const startBeat = i > 0 ? chart.events[i - 1].row.beat : 0;
                if (ev.row.beat < viewBeats.a || startBeat > viewBeats.b) return null;
                const color = facingColor(footsteps[i].facing);
                if (!color) return null;
                return (
                  <div
                    key={`fb${i}`}
                    className="facing-band"
                    style={{
                      top: startBeat * pxPerBeat + noteSize / 2,
                      height: Math.max(0, (ev.row.beat - startBeat) * pxPerBeat),
                      background: color,
                    }}
                  />
                );
              })}

              {Array.from({ length: chart.measures.length + 1 }, (_, m) => {
                if ((m + 1) * 4 < viewBeats.a || m * 4 > viewBeats.b) return null;
                return (
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
                );
              })}

              {editMode &&
                chart.measures.map((_, mi) => {
                  if ((mi + 1) * 4 < viewBeats.a || mi * 4 > viewBeats.b) return null;
                  return Array.from({ length: editRes }, (_, r) => {
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
                        onClick={() => applyEdit(toggleNote(compact, mi, r, editRes, p))}
                      />
                    ));
                  });
                })}

              {/* ソフラン・停止マーカー */}
              {bpms.slice(1).map((e, i) =>
                e.beat < chart.totalBeats ? (
                  <div
                    key={`bc${i}`}
                    className="timing-marker bpm-marker"
                    style={{ top: e.beat * pxPerBeat + noteSize / 2 }}
                  >
                    BPM {+e.bpm.toFixed(1)}
                  </div>
                ) : null
              )}
              {stopList.map((e, i) =>
                e.beat < chart.totalBeats ? (
                  <div
                    key={`st${i}`}
                    className="timing-marker stop-marker"
                    style={{ top: e.beat * pxPerBeat + noteSize / 2 }}
                  >
                    STOP {+e.sec.toFixed(2)}s
                  </div>
                ) : null
              )}

              {chart.holds.map((h, i) => (
                h.endBeat < viewBeats.a || h.startBeat > viewBeats.b ? null :
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

              {chart.mines.map((m, i) => (
                m.beat < viewBeats.a || m.beat > viewBeats.b ? null :
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

              {chart.events.map((ev, i) => {
                if (ev.row.beat < viewBeats.a || ev.row.beat > viewBeats.b) return null;
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
                      onClick={() => {
                        setPlaying(false);
                        if (editMode) {
                          applyEdit(toggleNote(compact, ev.row.measure, ev.row.idx, ev.row.total, p));
                        } else {
                          go(i);
                        }
                      }}
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
                      {step.jack && <span className="note-flag flag-jack">縦連</span>}
                      {step.doubleStep && (
                        <span className="note-flag flag-ds">踏替</span>
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
            <FootStage
              leftPos={curStep?.leftPos ?? 0}
              rightPos={curStep?.rightPos ?? 3}
              stepping={curEvent?.panels ?? []}
              feet={curStep?.feet ?? [null, null, null, null]}
              facing={facing}
              stepKey={current}
              heldFeet={curStep?.heldFeet ?? []}
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
                  if (!playing) {
                    if (current >= footsteps.length - 1) {
                      go(0);
                      beatRef.current = 0;
                    } else if (curEvent) {
                      beatRef.current = curEvent.row.beat;
                    }
                  }
                  togglePlay();
                }}
                title="再生 / 停止 (スペースキー)"
              >
                {playing ? "⏸" : "▶"}
              </button>
              <select
                value={speed}
                onChange={(e) => {
                  setSpeed(Number(e.target.value));
                  setDirty(true);
                }}
              >
                {SPEED_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}×
                  </option>
                ))}
              </select>
              <button
                className="secondary"
                onClick={() => {
                  const next = !muted;
                  setMuted(next);
                  if (!next && playing) {
                    // 再生中のミュート解除: ジェスチャ文脈でトラックを開始
                    const el = prepareClapTrack();
                    if (el) {
                      try {
                        el.currentTime = timeRef.current / speed;
                      } catch {
                        /* 未ロードなら再生側で追従 */
                      }
                      void el.play().catch(() => {});
                    }
                  }
                  if (next) clapTrackRef.current?.el.pause();
                }}
                title="クラップ音"
              >
                {muted ? "🔇" : "👏"}
              </button>
              <button
                className="secondary"
                onClick={enterFs}
                title="フルスクリーン再生 (撮影モード)"
              >
                ⛶
              </button>
            </div>
            <div className="controls">
              <button
                className="secondary"
                onClick={() => {
                  setPlaying(false);
                  go(current - 1);
                }}
              >
                ◀ 前
              </button>
              <span className="pos">
                {footsteps.length > 0 ? current + 1 : 0} / {footsteps.length}
              </span>
              <button
                className="secondary"
                onClick={() => {
                  setPlaying(false);
                  go(current + 1);
                }}
              >
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
                          curStep.feet[p] === "L" ? "左" : curStep.feet[p] === "R" ? "右" : ""
                        }`
                    )
                    .join(" ")}
                  {facing !== 0 && (
                    <span className="facing-label">
                      {" "}
                      体の向き {facing > 0 ? "右" : "左"}
                      {Math.abs(facing)}°
                    </span>
                  )}
                  {hasSofran && (
                    <span className="cur-bpm"> ♩={+bpmAtBeat(bpms, curEvent.row.beat).toFixed(1)}</span>
                  )}
                </div>
                {curEvent.panels.length === 2 && (
                  <div className="override-row">
                    <span className="override-label">踏む足:</span>
                    {(["L", "R"] as const).map((opt) => {
                      const [a, b] = curEvent.panels;
                      const arrows = ["←", "↓", "↑", "→"];
                      return (
                        <button
                          key={opt}
                          className={`ov-btn${curOverride === opt ? " active" : ""}`}
                          onClick={() => setOverride(curOverride === opt ? null : opt)}
                        >
                          {arrows[a]}
                          <span style={{ color: opt === "L" ? "var(--foot-l)" : "var(--foot-r)" }}>
                            {opt}
                          </span>
                          ・{arrows[b]}
                          <span style={{ color: opt === "L" ? "var(--foot-r)" : "var(--foot-l)" }}>
                            {opt === "L" ? "R" : "L"}
                          </span>
                        </button>
                      );
                    })}
                    {curOverride && (
                      <button className="ov-btn" onClick={() => setOverride(null)}>
                        自動に戻す
                      </button>
                    )}
                  </div>
                )}
                {curEvent.panels.length === 1 && (
                  <div className="override-row">
                    <span className="override-label">踏む足:</span>
                    <button
                      className={`ov-btn foot-l${curOverride === "L" ? " active-l" : ""}`}
                      onClick={() => setOverride(curOverride === "L" ? null : "L")}
                    >
                      L 左
                    </button>
                    <button
                      className={`ov-btn foot-r${curOverride === "R" ? " active-r" : ""}`}
                      onClick={() => setOverride(curOverride === "R" ? null : "R")}
                    >
                      R 右
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
                    <span className="tag ds">踏み替え (スライド)</span>
                  )}
                  {curStep.heldFeet.length > 0 && (
                    <span className="tag hold">
                      フリーズ中:{" "}
                      {curStep.heldFeet.map((f) => (f === "L" ? "左" : "右")).join("・")}
                    </span>
                  )}
                </div>
              </div>
            )}
            {overrides.size > 0 && (
              <div className="override-summary">
                手動指定 {overrides.size}件
                <button className="ov-btn" onClick={() => { setOverrides(new Map()); setDirty(true); }}>
                  全て解除
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ===== パネル見出し (?アイコンで説明をトグル表示) =====

function PanelHead({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="panel-head">
      <h2>{title}</h2>
      <button
        className={`help-btn${open ? " open" : ""}`}
        onClick={() => setOpen(!open)}
        aria-label="ヘルプ"
        type="button"
      >
        ?
      </button>
      {open && <p className="hint panel-help-text">{children}</p>}
    </div>
  );
}

// ===== テキスト入力パネル =====

function TextImport({
  compact,
  onApply,
}: {
  compact: string;
  onApply: (next: string, timing?: { b?: string; s?: string }) => void;
}) {
  const [text, setText] = useState(() =>
    compact
      .split("-")
      .map((m) => (m.match(/.{4}/g) ?? []).join("\n"))
      .join("\n,\n")
  );
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [choices, setChoices] = useState<SmChartInfo[] | null>(null);
  const [excluded, setExcluded] = useState(0);

  // 選んだ譜面 (またはテキスト全体) を読み込む。タイミングは常にファイル全体から
  const applyChart = (noteText: string) => {
    try {
      const result = normalizeNotesInput(noteText);
      if (result.warning) setWarning(result.warning);
      const timing = extractTimingFromSM(text);
      onApply(result.compact, timing);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const apply = () => {
    setError(null);
    setWarning(null);
    setChoices(null);
    setExcluded(0);
    const charts = listSmCharts(text);
    if (charts.length > 1) {
      // 複数譜面入りのファイル: シングルだけ列挙して選ばせる
      const singles = charts.filter((c) => !/double|couple|routine/i.test(c.type));
      setExcluded(charts.length - singles.length);
      if (singles.length === 0) {
        setError("シングル (4パネル) の譜面が見つかりませんでした");
        return;
      }
      if (singles.length === 1) {
        applyChart(singles[0].notes);
        return;
      }
      setChoices(singles);
      return;
    }
    applyChart(text);
  };

  return (
    <div className="card text-import">
      <PanelHead title="テキスト入力">
        SM/SSCファイルの <code>#NOTES</code> 以下のノートデータ (小節を <code>,</code> 区切り、
        1行4文字) を貼り付けて読み込めます。ファイル全体を貼ると{" "}
        <code>#BPMS</code> / <code>#STOPS</code> (ソフラン・停止) も自動で取り込みます。
      </PanelHead>
      <textarea value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
      <div className="form-row">
        <button onClick={apply}>この内容を読み込む</button>
      </div>
      {choices && (
        <div className="chart-choices">
          <p className="hint" style={{ flexBasis: "100%" }}>
            複数の譜面が見つかりました。読み込む譜面を選んでください
            {excluded > 0 && ` (シングル以外の${excluded}譜面は除外)`}:
          </p>
          {choices.map((c, i) => (
            <button
              key={i}
              className="secondary"
              onClick={() => applyChart(c.notes)}
            >
              {c.difficulty || `譜面${i + 1}`}
              {c.meter && ` (${c.meter})`}
            </button>
          ))}
        </div>
      )}
      {error && <p className="error">{error}</p>}
      {warning && <p className="warning">{warning}</p>}
    </div>
  );
}

// ===== 3Dフットステージ =====

// 3x3グリッド上のパネル中心座標 (単位: セル)
const STAGE_CENTERS = [
  { x: 0.5, y: 1.5 },
  { x: 1.5, y: 2.5 },
  { x: 1.5, y: 0.5 },
  { x: 2.5, y: 1.5 },
];

const STAGE_LAYOUT: (number | null)[][] = [
  [null, 2, null],
  [0, null, 3],
  [null, 1, null],
];

function FootStage({
  leftPos,
  rightPos,
  stepping,
  feet,
  facing,
  stepKey,
  heldFeet,
}: {
  leftPos: number;
  rightPos: number;
  stepping: number[];
  feet: (Foot | null)[];
  facing: number;
  stepKey: number;
  heldFeet: Foot[];
}) {
  const same = leftPos === rightPos;
  const lc = STAGE_CENTERS[leftPos];
  const rc = STAGE_CENTERS[rightPos];
  const lx = lc.x + (same ? -0.22 : 0);
  const rx = rc.x + (same ? 0.22 : 0);
  const midX = (STAGE_CENTERS[leftPos].x + STAGE_CENTERS[rightPos].x) / 2;
  const midY = (STAGE_CENTERS[leftPos].y + STAGE_CENTERS[rightPos].y) / 2;
  const lStepping = stepping.includes(leftPos) && feet[leftPos] === "L";
  const rStepping = stepping.includes(rightPos) && feet[rightPos] === "R";

  // facing はアルゴリズムが追跡している連続回転角なのでそのまま使える
  const rot = facing;

  return (
    <div className="stage3d">
      <div className="scene">
        <div className="floor">
          {STAGE_LAYOUT.flat().map((panel, i) => {
            if (panel === null) return <div key={i} className="floor-cell" />;
            const isStepping = stepping.includes(panel);
            const f = feet[panel];
            const cls = isStepping
              ? f === "L"
                ? " active-L"
                : f === "R"
                ? " active-R"
                : " active-LR"
              : "";
            return (
              <div key={i} className={`floor-cell floor-panel${cls}`}>
                <span className="pad-arrow">
                  <Arrow size={30} rotation={ARROW_ROTATIONS[panel]} color="#5a6390" detail={false} />
                </span>
              </div>
            );
          })}

          {/* 体の向きインジケータ (両足の中間に表示) */}
          <div
            className="facing-marker"
            style={{
              left: `${(midX / 3) * 100}%`,
              top: `${(midY / 3) * 100}%`,
              transform: `translate(-50%, -50%) rotate(${rot}deg)`,
            }}
          >
            ▲
          </div>

          {/* 足 */}
          <div
            className="foot3d"
            style={{
              left: `${(lx / 3) * 100}%`,
              top: `${(lc.y / 3) * 100}%`,
              transform: `translate(-50%, -50%) rotate(${rot}deg)`,
            }}
          >
            <div className="foot3d-shadow" />
            <div
              key={lStepping ? `s${stepKey}` : "idle"}
              className={`foot3d-body${lStepping ? " hop" : ""}${heldFeet.includes("L") ? " held" : ""}`}
              style={{ background: FOOT_COLORS.L }}
            >
              L
            </div>
          </div>
          <div
            className="foot3d"
            style={{
              left: `${(rx / 3) * 100}%`,
              top: `${(rc.y / 3) * 100}%`,
              transform: `translate(-50%, -50%) rotate(${rot}deg)`,
            }}
          >
            <div className="foot3d-shadow" />
            <div
              key={rStepping ? `s${stepKey}` : "idle"}
              className={`foot3d-body${rStepping ? " hop" : ""}${heldFeet.includes("R") ? " held" : ""}`}
              style={{ background: FOOT_COLORS.R }}
            >
              R
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
