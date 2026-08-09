// 貼り付けられた譜面テキスト (SMファイルの#NOTES部分 or コンパクト形式) を
// URLに載せるコンパクト形式へ正規化する。

import { MAX_MEASURES } from "./chart";

export interface NormalizeResult {
  compact: string;
  measures: number;
  warning?: string;
}

export function normalizeNotesInput(text: string): NormalizeResult {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("譜面データを入力してください");

  // すでにコンパクト形式ならそのまま検証して返す
  if (/^[012345M-]+$/.test(trimmed) && trimmed.includes("-")) {
    return validateCompact(trimmed);
  }
  if (/^[012345M]+$/.test(trimmed) && trimmed.length % 4 === 0 && !trimmed.includes("\n")) {
    return validateCompact(trimmed);
  }

  // SMファイル形式: コメント除去 → ";" 以降切り捨て → "," で小節分割
  let body = trimmed.replace(/\/\/[^\n]*/g, "");
  // #NOTES: ヘッダ部分 (難易度などのメタ5行) が含まれていたら譜面本体だけ取り出す
  const notesIdx = body.search(/#NOTES\s*:/i);
  if (notesIdx >= 0) {
    const after = body.slice(notesIdx);
    const parts = after.split(":");
    body = parts.slice(6).join(":") || parts[parts.length - 1];
  }
  const semi = body.indexOf(";");
  if (semi >= 0) body = body.slice(0, semi);

  const measureTexts = body.split(",");
  const measures: string[] = [];
  for (const mt of measureTexts) {
    const lines = mt
      .split(/\s+/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    const rows: string[] = [];
    for (const line of lines) {
      if (!/^[0-9MKLF]+$/i.test(line)) continue; // メタ行などはスキップ
      if (line.length === 8)
        throw new Error("8パネルの譜面 (ダブル) には対応していません。4パネル (シングル) の譜面を入力してください");
      if (line.length !== 4) continue;
      // 未対応のノート種 (K/L/F など) は 0 に置換 (5=空打ちは本アプリ独自の拡張)
      rows.push(line.toUpperCase().replace(/[^012345M]/g, "0"));
    }
    if (rows.length > 0) measures.push(rows.join(""));
  }

  if (measures.length === 0)
    throw new Error("譜面データを読み取れませんでした。SMファイルの #NOTES 以下の部分を貼り付けてください");

  let warning: string | undefined;
  let result = measures;
  if (measures.length > MAX_MEASURES) {
    result = measures.slice(0, MAX_MEASURES);
    warning = `${measures.length}小節ありましたが、最初の${MAX_MEASURES}小節のみ使用します`;
  }

  return { compact: result.join("-"), measures: result.length, warning };
}

function validateCompact(compact: string): NormalizeResult {
  const parts = compact.split("-").filter((s) => s.length > 0);
  if (parts.length > MAX_MEASURES)
    throw new Error(`小節数が多すぎます (最大${MAX_MEASURES}小節)`);
  for (const [i, p] of parts.entries()) {
    if (p.length % 4 !== 0)
      throw new Error(`${i + 1}小節目の長さが4の倍数ではありません`);
  }
  return { compact: parts.join("-"), measures: parts.length };
}

// ===== SMファイル内の譜面一覧 =====

export interface SmChartInfo {
  type: string; // dance-single / dance-double など
  difficulty: string; // Beginner / Expert / Challenge など
  meter: string; // 難易度値
  notes: string; // ノートデータ本体
}

/**
 * SM/SSCファイルテキストから全譜面を列挙する。
 * SM形式 (#NOTES: type:desc:difficulty:meter:radar:notedata;) と
 * SSC形式 (#STEPSTYPE/#DIFFICULTY/#METER + #NOTES:notedata;) の両対応。
 */
export function listSmCharts(text: string): SmChartInfo[] {
  const src = text.replace(/\/\/[^\n]*/g, "");
  const out: SmChartInfo[] = [];
  const re = /#NOTES\s*:/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const start = m.index + m[0].length;
    const end = src.indexOf(";", start);
    const block = src.slice(start, end < 0 ? src.length : end);
    const parts = block.split(":");
    if (parts.length >= 6) {
      out.push({
        type: parts[0].trim(),
        difficulty: parts[2].trim(),
        meter: parts[3].trim(),
        notes: parts.slice(5).join(":"),
      });
    } else {
      // SSC形式: このブロックより前の直近のタグから拾う
      const before = src.slice(0, m.index);
      const grabLast = (tag: string): string => {
        const i = before.toUpperCase().lastIndexOf(`#${tag}`);
        if (i < 0) return "";
        const mm = before.slice(i).match(/:\s*([^;]*);/);
        return mm ? mm[1].trim() : "";
      };
      out.push({
        type: grabLast("STEPSTYPE"),
        difficulty: grabLast("DIFFICULTY"),
        meter: grabLast("METER"),
        notes: block,
      });
    }
    if (end >= 0) re.lastIndex = end;
  }
  return out;
}

export function buildShareUrl(
  base: string,
  compact: string,
  title?: string,
  bpm?: string
): string {
  const qs = new URLSearchParams();
  qs.set("n", compact);
  if (title) qs.set("t", title);
  if (bpm) qs.set("b", bpm);
  return `${base}/?${qs.toString()}`;
}
