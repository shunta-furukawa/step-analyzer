// ソフラン (途中変速) と停止 (STOP) のタイミング計算。
// bパラメータ: "150" または "130,32:650,64:130" (先頭=初期BPM、以降 拍:BPM)
// sパラメータ: "48:0.5,52:0.25" (拍:秒)
// 拍はSMの#BPMS/#STOPSと同じ0起点のビート単位。

export interface BpmChange {
  beat: number;
  bpm: number;
}

export interface Stop {
  beat: number;
  sec: number;
}

export function parseBpmParam(b: string | undefined): BpmChange[] {
  const def = [{ beat: 0, bpm: 120 }];
  if (!b) return def;
  const out: BpmChange[] = [];
  for (const part of b.split(",")) {
    const seg = part.trim();
    if (!seg) continue;
    if (seg.includes(":")) {
      const [bs, vs] = seg.split(":");
      const beat = Number(bs);
      const bpm = Number(vs);
      if (Number.isFinite(beat) && beat >= 0 && Number.isFinite(bpm) && bpm > 0)
        out.push({ beat, bpm });
    } else {
      const bpm = Number(seg);
      if (Number.isFinite(bpm) && bpm > 0) out.push({ beat: 0, bpm });
    }
  }
  if (out.length === 0) return def;
  if (!out.some((e) => e.beat === 0)) out.unshift({ beat: 0, bpm: out[0].bpm });
  out.sort((a, b2) => a.beat - b2.beat);
  const ded: BpmChange[] = [];
  for (const e of out) {
    const last = ded[ded.length - 1];
    if (last && last.beat === e.beat) ded[ded.length - 1] = e;
    else ded.push(e);
  }
  return ded;
}

export function parseStopsParam(s: string | undefined): Stop[] {
  if (!s) return [];
  const out: Stop[] = [];
  for (const part of s.split(",")) {
    const seg = part.trim();
    if (!seg || !seg.includes(":")) continue;
    const [bs, vs] = seg.split(":");
    const beat = Number(bs);
    const sec = Number(vs);
    if (Number.isFinite(beat) && beat >= 0 && Number.isFinite(sec) && sec > 0)
      out.push({ beat, sec });
  }
  out.sort((a, b) => a.beat - b.beat);
  return out;
}

const fmt = (n: number) => String(+n.toFixed(3));

export function serializeBpmParam(bpms: BpmChange[]): string {
  if (bpms.length === 0) return "";
  return [fmt(bpms[0].bpm), ...bpms.slice(1).map((e) => `${fmt(e.beat)}:${fmt(e.bpm)}`)].join(
    ","
  );
}

export function serializeStopsParam(stops: Stop[]): string {
  return stops.map((s) => `${fmt(s.beat)}:${fmt(s.sec)}`).join(",");
}

export function bpmAtBeat(bpms: BpmChange[], beat: number): number {
  let cur = bpms[0]?.bpm ?? 120;
  for (const e of bpms) {
    if (e.beat <= beat + 1e-9) cur = e.bpm;
    else break;
  }
  return cur;
}

// ===== タイムライン (時刻⇔拍の区分線形変換) =====

export interface TimingSeg {
  move: boolean; // false = 停止中
  t0: number;
  t1: number;
  beat0: number;
  beat1: number;
  bpm: number;
}

export function buildTimeline(
  bpms: BpmChange[],
  stops: Stop[],
  totalBeats: number
): TimingSeg[] {
  const points = Array.from(
    new Set(
      [...bpms.map((e) => e.beat), ...stops.map((e) => e.beat)].filter(
        (b) => b > 0 && b < totalBeats
      )
    )
  ).sort((a, b) => a - b);

  const segs: TimingSeg[] = [];
  let t = 0;
  let beat = 0;
  let bpm = bpms[0]?.bpm ?? 120;

  const advanceTo = (target: number) => {
    if (target > beat) {
      const dt = ((target - beat) * 60) / bpm;
      segs.push({ move: true, t0: t, t1: t + dt, beat0: beat, beat1: target, bpm });
      t += dt;
      beat = target;
    }
  };

  for (const pt of points) {
    advanceTo(pt);
    const chg = bpms.find((e) => e.beat === pt);
    if (chg) bpm = chg.bpm;
    const stop = stops.find((e) => e.beat === pt);
    if (stop) {
      segs.push({ move: false, t0: t, t1: t + stop.sec, beat0: beat, beat1: beat, bpm: 0 });
      t += stop.sec;
    }
  }
  advanceTo(totalBeats);
  if (segs.length === 0)
    segs.push({ move: true, t0: 0, t1: 0, beat0: 0, beat1: 0, bpm });
  return segs;
}

export function beatAtTime(segs: TimingSeg[], time: number): number {
  if (time <= 0) return segs[0].beat0;
  for (const s of segs) {
    if (time < s.t1) {
      if (!s.move) return s.beat0;
      return s.beat0 + ((time - s.t0) * s.bpm) / 60;
    }
  }
  return segs[segs.length - 1].beat1;
}

// その拍に「最初に到達する」時刻を返す (停止開始拍のノーツは停止前に鳴る)
export function timeAtBeat(segs: TimingSeg[], beat: number): number {
  if (beat <= segs[0].beat0) return segs[0].t0;
  for (const s of segs) {
    if (s.move && beat <= s.beat1 + 1e-9 && beat >= s.beat0) {
      return s.t0 + ((beat - s.beat0) * 60) / s.bpm;
    }
  }
  return segs[segs.length - 1].t1;
}

// ===== SMファイルからの#BPMS/#STOPS抽出 =====

export function extractTimingFromSM(text: string): { b?: string; s?: string } {
  const result: { b?: string; s?: string } = {};
  const bm = text.match(/#BPMS\s*:\s*([^;]*);/i);
  if (bm) {
    const entries: BpmChange[] = [];
    for (const part of bm[1].split(",")) {
      const m = part.trim().match(/^([\d.]+)\s*=\s*([\d.]+)$/);
      if (m) entries.push({ beat: Number(m[1]), bpm: Number(m[2]) });
    }
    if (entries.length > 0) {
      entries.sort((a, b) => a.beat - b.beat);
      result.b = serializeBpmParam(entries);
    }
  }
  const sm = text.match(/#STOPS\s*:\s*([^;]*);/i);
  if (sm) {
    const entries: Stop[] = [];
    for (const part of sm[1].split(",")) {
      const m = part.trim().match(/^([\d.]+)\s*=\s*([\d.]+)$/);
      if (m) entries.push({ beat: Number(m[1]), sec: Number(m[2]) });
    }
    if (entries.length > 0) result.s = serializeStopsParam(entries);
  }
  return result;
}
