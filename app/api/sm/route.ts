// Webにホストされた譜面ファイル (SM/SSC) をサーバー経由で取得する中継API。
// ブラウザから直接fetchするとCORSで弾かれるため、テキストとして取得して返す。

export const runtime = "nodejs";

const MAX_BYTES = 3 * 1024 * 1024; // 3MB
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 10_000;

// 内部ネットワークへのアクセス (SSRF) を防ぐための宛先チェック
function isForbiddenHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return true;
  // IPv6
  if (h.includes(":")) return true;
  // IPv4リテラル
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
    // リダイレクトも1ホップずつ宛先を検証しながら追う
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

    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > MAX_BYTES) {
      return Response.json({ error: "ファイルが大きすぎます (3MBまで)" }, { status: 413 });
    }
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) {
      return Response.json({ error: "ファイルが大きすぎます (3MBまで)" }, { status: 413 });
    }

    const text = new TextDecoder("utf-8", { fatal: false }).decode(buf);
    // 譜面ファイルらしさを軽く確認 (HTMLページ等の誤指定に気付けるように)
    if (!/#NOTES\s*:|#BPMS\s*:/i.test(text)) {
      return Response.json(
        { error: "SM/SSC形式のデータが見つかりませんでした。.smファイル自体のURLを指定してください" },
        { status: 422 }
      );
    }
    return Response.json({ text });
  } catch (e) {
    const msg = e instanceof Error && e.name === "TimeoutError" ? "取得がタイムアウトしました" : "取得に失敗しました";
    return Response.json({ error: msg }, { status: 502 });
  }
}
