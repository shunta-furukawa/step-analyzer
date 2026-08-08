"use client";

// クライアント例外時の表示。Nextのデフォルトの無情報な画面ではなく、
// エラーメッセージを見せて報告・復帰できるようにする。
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="container">
      <div className="card">
        <h2>エラーが発生しました</h2>
        <p className="error" style={{ wordBreak: "break-all" }}>
          {error.message || String(error)}
        </p>
        <div className="form-row">
          <button onClick={() => reset()}>再試行</button>
          <button className="secondary" onClick={() => window.location.reload()}>
            再読み込み
          </button>
        </div>
      </div>
    </main>
  );
}
