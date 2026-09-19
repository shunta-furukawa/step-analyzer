interface ChartInfo {
  cls: number | null;
  lvl: string;
  steps: number;
}

interface VideoDescriptionOptions {
  name: string;
  subtitle: string;
  bpm: string;
  shareUrl: string;
  chartA: ChartInfo;
  chartB: ChartInfo | null;
  landscape: boolean;
  landscapeSpeed: number;
  program: boolean;
}

function difficultyText(chart: ChartInfo): string {
  return chart.cls !== null || chart.lvl
    ? ` (${chart.cls !== null ? ["習", "楽", "踊", "激", "鬼"][chart.cls] : "Lv"}${chart.lvl})`
    : "";
}

/** 投稿用のタイトルと概要欄。動画と同じA/B・速度・解説設定を使う。 */
export function buildVideoDescription(o: VideoDescriptionOptions): string {
  const diffA = difficultyText(o.chartA);
  const diffB = o.chartB ? difficultyText(o.chartB) : "";
  const speed = o.landscapeSpeed === 1 ? "等倍速" : `${o.landscapeSpeed}倍速`;
  const program = o.landscape && o.program && !o.chartB;
  const subject = o.chartB ? ` A${diffA} vs B${diffB} 足割り比較` : diffA;
  const head = o.landscape
    ? `【STEP ANALYZER】${o.name}${subject}${o.chartB ? "" : program ? " 足割りじっくり解説" : " 足割り再生"} (${speed})`
    : `【STEP ANALYZER】${o.name}${subject} #Shorts`;
  const details = o.chartB
    ? [
        `♩=${o.bpm}`,
        `A${diffA} / ${o.chartA.steps}ステップ`,
        `B${diffB} / ${o.chartB.steps}ステップ`,
      ]
    : [`♩=${o.bpm}${diffA} / ${o.chartA.steps}ステップ`];
  const body = o.chartB
    ? [
        `DDRの2つの譜面の足割りをA/Bで並べて比較し、${o.landscape ? speed : "等倍速"}で同時再生しています。`,
        "A・Bそれぞれの譜面と足の動きを見比べられます。",
      ]
    : o.landscape
      ? [
          `DDRの譜面をどちらの足で踏むか (足割り) を自動解析し、${speed}で再生しています。`,
          ...(program ? ["注目ポイントでは解説コメントが表示されます。"] : []),
        ]
      : [
          "DDRの譜面をどちらの足で踏むか (足割り) を自動解析して再生しています。",
          "じっくり見たい人向けの0.5倍速解説版は関連動画からどうぞ。",
        ];
  return [
    head,
    "",
    `${o.name}${o.subtitle ? ` / ${o.subtitle}` : ""}`,
    ...details,
    "",
    ...body,
    "",
    o.chartB ? "A/Bの譜面と足割りをブラウザで比較する:" : "譜面と足割りをブラウザで見る:",
    o.shareUrl,
    "",
    o.landscape
      ? "#DDR #DanceDanceRevolution #StepAnalyzer"
      : "#DDR #DanceDanceRevolution #Shorts #StepAnalyzer",
  ].join("\n");
}
