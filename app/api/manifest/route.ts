// ページごとの動的Webアプリマニフェスト。
// 静的manifestのstart_url:"/"だとiOSの「ホーム画面に追加」で
// クエリパラメータ (=譜面データ) が失われるため、開いているページの
// クエリをそのままstart_urlに埋め込んで配る。テーマカラーも連動する。

export const runtime = "nodejs";

const DEFAULT_BG = "#29d6a2";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const qs = searchParams.toString();
  const c = searchParams.get("c");
  const cOk = c && /^[0-9a-fA-F]{6}(-[0-9a-fA-F]{6})?$/.test(c);
  const theme = cOk ? `#${c.slice(0, 6).toLowerCase()}` : DEFAULT_BG;
  const iconC = cOk ? `&c=${c.toLowerCase()}` : "";

  const manifest = {
    name: "Step Analyzer — DDR読譜トレーナー",
    short_name: "StepAnalyzer",
    description:
      "DDRの譜面の一部をURLで共有し、左右どちらの足でどのパネルを踏むべきかを可視化するツール",
    start_url: qs ? `/?${qs}` : "/",
    scope: "/",
    display: "standalone",
    background_color: theme,
    theme_color: theme,
    icons: [
      { src: `/api/icon?s=192${iconC}`, sizes: "192x192", type: "image/png" },
      { src: `/api/icon?s=512${iconC}`, sizes: "512x512", type: "image/png" },
    ],
  };

  return new Response(JSON.stringify(manifest), {
    headers: {
      "Content-Type": "application/manifest+json",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
