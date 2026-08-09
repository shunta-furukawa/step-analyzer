// dパラメータのデコード (サーバー側専用: page.tsx / ogルートから使う)

import { inflateRawSync } from "node:zlib";

export function decompressCompact(d: string): string {
  const b64 = d.replace(/-/g, "+").replace(/_/g, "/");
  const bytes = Buffer.from(b64, "base64");
  const out = inflateRawSync(bytes).toString("utf8");
  if (!/^[012345M-]+$/.test(out)) throw new Error("不正な譜面データです");
  return out;
}
