// 譜面データのURL圧縮 (クライアント側エンコード)。
// dパラメータ = base64url(deflate-raw(コンパクト形式文字列))。
// デコードはサーバー側 (lib/codec-server.ts) で行う。

export function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * コンパクト形式をdeflate圧縮してURLセーフな文字列にする。
 * CompressionStream非対応のブラウザではnullを返す (nパラメータにフォールバック)。
 */
export async function compressCompact(compact: string): Promise<string | null> {
  if (typeof CompressionStream === "undefined") return null;
  try {
    const stream = new Blob([compact])
      .stream()
      .pipeThrough(new CompressionStream("deflate-raw"));
    const buf = new Uint8Array(await new Response(stream).arrayBuffer());
    return toBase64Url(buf);
  } catch {
    return null;
  }
}
