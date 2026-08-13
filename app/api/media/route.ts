// Webにホストされた音源・画像をサーバー経由で取得する中継API。
// 動画書き出し (β) 用。ブラウザから直接fetchするとCORSで弾かれ、
// 画像はcanvasを汚染して録画できなくなるため、同一オリジンとして返す。
// サーバーは中継するだけで何も保存しない。

export const runtime = "nodejs";

const MAX_BYTES = 20 * 1024 * 1024; // 20MB (ogg音源を想定)
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 20_000;

// 内部ネットワークへのアクセス (SSRF) を防ぐための宛先チェック
function isForbiddenHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (h.includes(":")) return true;
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 127 || a === 10 || a === 0) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true;
  }
  return false;
}

function validateUrl(raw: string): URL | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (u.port && u.port !== "80" && u.port !== "443") return null;
  if (isForbiddenHost(u.hostname)) return null;
  return u;
}

// 中継してよいコンテンツタイプ (音声・画像のみ)
const ALLOWED_TYPES = /^(audio\/|image\/|application\/ogg)/i;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const raw = searchParams.get("url");
  if (!raw) {
    return Response.json({ error: "urlパラメータが必要です" }, { status: 400 });
  }

  let target = validateUrl(raw);
  if (!target) {
    return Response.json({ error: "無効なURLです (http/httpsのみ対応)" }, { status: 400 });
  }

  try {
    let res: globalThis.Response | null = null;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      res = await fetch(target.href, {
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { "user-agent": "step-analyzer/1.0" },
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) break;
        const next = validateUrl(new URL(loc, target.href).href);
        if (!next) {
          return Response.json({ error: "リダイレクト先が無効です" }, { status: 400 });
        }
        target = next;
        continue;
      }
      break;
    }
    if (!res || !res.ok) {
      return Response.json(
        { error: `取得に失敗しました (HTTP ${res?.status ?? "?"})` },
        { status: 502 }
      );
    }

    const type = res.headers.get("content-type") ?? "application/octet-stream";
    // 拡張子が音声/画像ならcontent-typeが緩くても通す (octet-stream配信対策)
    const extOk = /\.(ogg|oga|mp3|m4a|wav|png|jpe?g|webp|gif|avif)($|\?)/i.test(target.pathname);
    if (!ALLOWED_TYPES.test(type) && !extOk) {
      return Response.json({ error: "音声・画像のURLのみ対応しています" }, { status: 422 });
    }

    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > MAX_BYTES) {
      return Response.json({ error: "ファイルが大きすぎます (20MBまで)" }, { status: 413 });
    }
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) {
      return Response.json({ error: "ファイルが大きすぎます (20MBまで)" }, { status: 413 });
    }

    return new Response(buf, {
      headers: {
        "content-type": type,
        "cache-control": "private, max-age=600",
      },
    });
  } catch (e) {
    const msg =
      e instanceof Error && e.name === "TimeoutError"
        ? "取得がタイムアウトしました"
        : "取得に失敗しました";
    return Response.json({ error: msg }, { status: 502 });
  }
}
