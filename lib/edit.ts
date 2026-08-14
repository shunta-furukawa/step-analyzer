// GUIによるノーツ編集: コンパクト形式の譜面文字列に対するトグル操作。

import { parseCompact, type FootOverride } from "./chart";

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

function lcm(a: number, b: number): number {
  return (a * b) / gcd(a, b);
}

function splitRows(m: string): string[] {
  const rows: string[] = [];
  for (let i = 0; i < m.length; i += 4) rows.push(m.slice(i, i + 4));
  return rows;
}

// 空行しかない細かい行を間引いて小節の行数を最小化する (最低4行)
function reduceRows(rows: string[]): string[] {
  let r = rows;
  let changed = true;
  while (changed) {
    changed = false;
    for (const d of [2, 3]) {
      if (r.length % d === 0 && r.length / d >= 4) {
        let ok = true;
        for (let i = 0; i < r.length; i++) {
          if (i % d !== 0 && r[i] !== "0000") {
            ok = false;
            break;
          }
        }
        if (ok) {
          r = r.filter((_, i) => i % d === 0);
          changed = true;
          break;
        }
      }
    }
  }
  return r;
}

// フリーズの頭と尻尾の整合性を取る (孤児の尻尾は削除、二重の頭はタップ化)
function cleanupHolds(measures: string[][]): void {
  for (let c = 0; c < 4; c++) {
    let open = false;
    for (const rows of measures) {
      for (let i = 0; i < rows.length; i++) {
        const ch = rows[i][c];
        if (ch === "2" || ch === "4") {
          if (open) rows[i] = setChar(rows[i], c, "1");
          else open = true;
        } else if (ch === "3" || ch === "6") {
          // 6 = 終端+空打ち。孤児になったら終端ごと消す (3と同じ扱い)
          if (open) open = false;
          else rows[i] = setChar(rows[i], c, "0");
        }
      }
    }
  }
}

function setChar(row: string, i: number, ch: string): string {
  return row.slice(0, i) + ch + row.slice(i + 1);
}

/**
 * 指定位置のノーツをトグルする。
 * @param mIdx 小節番号
 * @param resRow 解像度res上での行番号 (0 <= resRow < res)
 * @param res 小節あたりの行数としての解像度 (4/8/12/16/24 または小節の元解像度)
 * @param panel 0=←, 1=↓, 2=↑, 3=→
 * @param ch 置くノーツ文字 (通常 "1"、フリーズ中のセルには "5"=空打ち)
 */
export function toggleNote(
  compact: string,
  mIdx: number,
  resRow: number,
  res: number,
  panel: number,
  ch: "1" | "5" = "1"
): string {
  const measures = compact.split("-").map(splitRows);
  const rows = measures[mIdx];
  if (!rows) return compact;

  const L = lcm(rows.length, res);
  const f = L / rows.length;
  const expanded: string[] = [];
  for (let i = 0; i < L; i++) {
    expanded.push(i % f === 0 ? rows[i / f] : "0000");
  }
  const target = resRow * (L / res);
  const cur = expanded[target][panel];
  // フリーズ終端は消すと終わりを失うため削除不可。代わりに
  // タップで「3 (終端) ⇔ 6 (終端+空打ち)」をトグルする
  if (cur === "3") {
    expanded[target] = setChar(expanded[target], panel, "6");
  } else if (cur === "6") {
    expanded[target] = setChar(expanded[target], panel, "3");
  } else {
    expanded[target] = setChar(expanded[target], panel, cur === "0" ? ch : "0");
  }

  measures[mIdx] = reduceRows(expanded);
  cleanupHolds(measures);
  return measures.map((m) => m.join("")).join("-");
}

/**
 * 指定行のショックアロー (MMMM) をトグルする。
 * 置く場合はその行のノーツを上書きする (踏めない行なので共存しない)。
 */
export function toggleShock(
  compact: string,
  mIdx: number,
  resRow: number,
  res: number
): string {
  const measures = compact.split("-").map(splitRows);
  const rows = measures[mIdx];
  if (!rows) return compact;

  const L = lcm(rows.length, res);
  const f = L / rows.length;
  const expanded: string[] = [];
  for (let i = 0; i < L; i++) {
    expanded.push(i % f === 0 ? rows[i / f] : "0000");
  }
  const target = resRow * (L / res);
  // フリーズ終端 (3/6) を含む行への上書きは、終端を失わせるため許可しない
  if (expanded[target] !== "MMMM" && /[36]/.test(expanded[target])) return compact;
  expanded[target] = expanded[target] === "MMMM" ? "0000" : "MMMM";

  measures[mIdx] = reduceRows(expanded);
  cleanupHolds(measures);
  return measures.map((m) => m.join("")).join("-");
}

/**
 * フリーズアローを配置する。始点 (aM, aRow) から終点 (bM, bRow) まで、
 * 小節をまたいでもよい。範囲に重なる同列の既存フリーズ・ノーツは置き換える。
 * 始点と終点が同じセルなら何もしない (キャンセル扱い)。
 * @param res 解像度 (resRowはこの解像度上の行番号)
 */
export function placeHoldRange(
  compact: string,
  aM: number,
  aRow: number,
  bM: number,
  bRow: number,
  res: number,
  panel: number
): string {
  const beatOf = (m: number, row: number) => m * 4 + (row / res) * 4;
  let startBeat = beatOf(aM, aRow);
  let endBeat = beatOf(bM, bRow);
  if (Math.abs(startBeat - endBeat) < 1e-9) return compact;
  if (startBeat > endBeat) [startBeat, endBeat] = [endBeat, startBeat];

  // 範囲に重なる同列の既存フリーズは頭・尻尾ごと消す対象に含める
  let clearFrom = startBeat;
  let clearTo = endBeat;
  try {
    for (const h of parseCompact(compact).holds) {
      if (h.panel !== panel) continue;
      if (h.endBeat < startBeat - 1e-9 || h.startBeat > endBeat + 1e-9) continue;
      clearFrom = Math.min(clearFrom, h.startBeat);
      clearTo = Math.max(clearTo, h.endBeat);
    }
  } catch {
    return compact;
  }

  const measures = compact.split("-").map(splitRows);
  for (let m = 0; m < measures.length; m++) {
    const rows = measures[m];
    const L = lcm(rows.length, res);
    const f = L / rows.length;
    const expanded: string[] = [];
    for (let i = 0; i < L; i++) expanded.push(i % f === 0 ? rows[i / f] : "0000");

    let touched = false;
    for (let i = 0; i < L; i++) {
      const beat = m * 4 + (i / L) * 4;
      const inClear = beat >= clearFrom - 1e-9 && beat <= clearTo + 1e-9;
      if (!inClear) continue;
      let ch = "0";
      if (Math.abs(beat - startBeat) < 1e-9) ch = "2";
      else if (Math.abs(beat - endBeat) < 1e-9) ch = "3";
      if (expanded[i][panel] !== ch) {
        expanded[i] = setChar(expanded[i], panel, ch);
        touched = true;
      }
    }
    if (touched) measures[m] = reduceRows(expanded);
  }
  cleanupHolds(measures);
  return measures.map((mm) => mm.join("")).join("-");
}

// ===== 足の手動指定 (fパラメータ) のシリアライズ =====

export function parseOverrides(f: string | undefined): Map<number, FootOverride> {
  const map = new Map<number, FootOverride>();
  if (!f) return map;
  for (const part of f.split("-")) {
    // LL/RR = 2枚抜き (ジャンプを片足で取る)。C/CL/CR = ショックの中央空打ち
    const m = part.match(/^(\d+)(CL|CR|C|LL|RR|L|R)$/);
    if (m) map.set(Number(m[1]), m[2] as FootOverride);
  }
  return map;
}

export function serializeOverrides(map: Map<number, FootOverride>): string {
  return Array.from(map.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([tick, foot]) => `${tick}${foot}`)
    .join("-");
}

// ===== 注目ノーツ (hlパラメータ) のシリアライズ =====
// 「この踏み方を見て!」と共有したいノーツのtickを - 区切りで持つ

export function parseHighlights(h: string | undefined): Set<number> {
  const out = new Set<number>();
  if (!h) return out;
  for (const part of h.split("-")) {
    const n = Number(part);
    if (Number.isInteger(n) && n >= 0) out.add(n);
  }
  return out;
}

export function serializeHighlights(hl: Set<number>): string {
  return [...hl].sort((a, b) => a - b).join("-");
}

// ===== 注目ノーツのコメント (hcパラメータ) =====
// tick:テキスト を , 区切りで持つ。テキストはbase64url (英数と-_のみ) なので、
// クエリが途中で1回デコードされても区切り文字と衝突しない。
// 日本語は%エンコード (9文字/字) よりbase64url (約4文字/字) の方が短い

function textToB64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64ToText(s: string): string {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export function parseComments(h: string | undefined): Map<number, string> {
  const out = new Map<number, string>();
  if (!h) return out;
  for (const part of h.split(",")) {
    const i = part.indexOf(":");
    if (i <= 0) continue;
    const tick = Number(part.slice(0, i));
    if (!Number.isInteger(tick) || tick < 0) continue;
    try {
      const text = b64ToText(part.slice(i + 1));
      if (text) out.set(tick, text);
    } catch {
      // 壊れたエントリは無視
    }
  }
  return out;
}

export function serializeComments(m: Map<number, string>): string {
  return [...m.entries()]
    .filter(([, t]) => t.trim().length > 0)
    .sort((a, b) => a[0] - b[0])
    .map(([tick, t]) => `${tick}:${textToB64(t.trim())}`)
    .join(",");
}
