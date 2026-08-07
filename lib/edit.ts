// GUIによるノーツ編集: コンパクト形式の譜面文字列に対するトグル操作。

import type { Foot } from "./chart";

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
        } else if (ch === "3") {
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
 */
export function toggleNote(
  compact: string,
  mIdx: number,
  resRow: number,
  res: number,
  panel: number
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
  expanded[target] = setChar(expanded[target], panel, cur === "0" ? "1" : "0");

  measures[mIdx] = reduceRows(expanded);
  cleanupHolds(measures);
  return measures.map((m) => m.join("")).join("-");
}

// ===== 足の手動指定 (fパラメータ) のシリアライズ =====

export function parseOverrides(f: string | undefined): Map<number, Foot> {
  const map = new Map<number, Foot>();
  if (!f) return map;
  for (const part of f.split("-")) {
    const m = part.match(/^(\d+)(L|R)$/);
    if (m) map.set(Number(m[1]), m[2] as Foot);
  }
  return map;
}

export function serializeOverrides(map: Map<number, Foot>): string {
  return Array.from(map.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([tick, foot]) => `${tick}${foot}`)
    .join("-");
}
