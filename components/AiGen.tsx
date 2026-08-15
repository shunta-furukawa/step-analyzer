"use client";

// フッター右下の「AIで譜面を作成する」ボタンとモーダル。
// 要望を書いてサービスを選ぶと、URL仕様入りのプロンプトをプリフィルした
// 外部AIチャットが新しいタブで開く。

import { useState } from "react";
import { AI_SERVICES, aiPromptUrl, aiServiceIcon } from "@/lib/aiPrompt";
import { STRINGS, type Lang } from "@/lib/i18n";

export default function AiGen({ lang }: { lang: Lang }) {
  const S = STRINGS[lang];
  const [open, setOpen] = useState(false);
  const [wish, setWish] = useState("");

  return (
    <>
      <button className="secondary ai-gen-btn" onClick={() => setOpen(true)}>
        🤖 {S.aiGenBtn}
      </button>
      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>{S.aiModalTitle}</h2>
              <button className="secondary modal-close" onClick={() => setOpen(false)}>
                ✕
              </button>
            </div>
            <p className="hint opt-hint">{S.aiModalDesc}</p>
            <textarea
              className="ai-wish"
              value={wish}
              placeholder={S.aiWishPlaceholder}
              onChange={(e) => setWish(e.target.value)}
              rows={3}
            />
            <div className="ai-choice">
              {AI_SERVICES.map((sv) => (
                <a
                  key={sv.key}
                  className="ai-choice-btn"
                  href={aiPromptUrl(sv, wish)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={aiServiceIcon(sv)}
                    alt=""
                    width={22}
                    height={22}
                    onError={(e) => {
                      // アイコンが取れない環境では隠すだけ (機能には影響なし)
                      e.currentTarget.style.display = "none";
                    }}
                  />
                  <span className="ai-choice-name">{sv.label}</span>
                  <span className="ai-choice-ext">{S.aiOpenExternal} ↗</span>
                </a>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
