// 譜面の変形オプション (ミラー/レフト/ライト/ランダム)。
// すべて「列の並べ替え」として表現する: newRow[i] = row[perm[i]]。
// ランダムは選んだ並べ替えを4桁の数字 (例: "2301") としてURLに保存し再現可能にする。

// パネル: 0=←, 1=↓, 2=↑, 3=→
export const NAMED_TRANSFORMS: Record<string, number[]> = {
  // ←↔→ と ↑↔↓ を入れ替え (180度回転)
  mirror: [3, 2, 1, 0],
  // 反時計回りに90度 (↑→←, →→↑, ←→↓, ↓→→)
  left: [2, 0, 3, 1],
  // 時計回りに90度 (↑→→, ←→↑, →→↓, ↓→←)
  right: [1, 3, 0, 2],
};

const IDENTITY = [0, 1, 2, 3];

/** tr= パラメータを列並べ替えに解決する。無効・恒等ならnull */
export function parseTransform(tr: string | undefined | null): number[] | null {
  if (!tr) return null;
  if (NAMED_TRANSFORMS[tr]) return NAMED_TRANSFORMS[tr];
  if (/^[0-3]{4}$/.test(tr)) {
    const perm = [...tr].map(Number);
    if ([...perm].sort().join("") !== "0123") return null; // 置換でない
    if (perm.join("") === IDENTITY.join("")) return null;
    return perm;
  }
  return null;
}

export function invertPerm(perm: number[]): number[] {
  const inv = [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) inv[perm[i]] = i;
  return inv;
}

/** コンパクト譜面文字列の全行に列並べ替えを適用する */
export function applyTransform(compact: string, perm: number[]): string {
  return compact
    .split("-")
    .map((m) => {
      let out = "";
      for (let i = 0; i < m.length; i += 4) {
        const row = m.slice(i, i + 4);
        out += perm.map((p) => row[p] ?? "0").join("");
      }
      return out;
    })
    .join("-");
}

/** ランダム用: 恒等以外の並べ替えを1つ選んで4桁文字列で返す */
export function randomTransform(): string {
  const a = [0, 1, 2, 3];
  do {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
  } while (a.join("") === "0123");
  return a.join("");
}
