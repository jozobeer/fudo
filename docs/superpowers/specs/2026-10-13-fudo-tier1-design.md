# fudo 設計: S4 Tier 1

範囲は設計文書の分割表に従う: compaction、spill、tool call timeout、todo_write、AGENTS.md の読み込み。

## 決定

1. tool call timeout はツールの宣言に従う。ToolDefinition.timeoutMs があれば pipeline が Effect.timeout で包み、時間切れは errorResult（例: Operation timed out after '10ms'）にする。宣言が無ければ無制限。実装済み。
2. todo_write は結果をログに置く。TODO の状態を新しいサービスに持たず、ツール結果として会話に残す。実行は副作用なし。実装済み。
3. AGENTS.md は prompt のセクション。cwd から親方向へ辿り、近いファイルほど order を大きくする（結合すると具体的な指示が最後）。読み込みは loadAgentsFiles、登録は registerAgentsMd。CLI が起動時に呼ぶ。実装済み。
4. spill は判定と書き出しを分ける。planSpill(content, maxBytes, previewChars) が keep / spill を決める純関数（バイト数で判定）。書き出しは pipeline の外（セッションの隣）で行い、結果の content を preview + 参照行に差し替える。閾値は profile の行から与え、既定は無効。判定は実装済み、差し込みは未了。
5. compaction は履歴の末尾を残して先頭を畳む。要約は LLM に投げず、まずは古い tool/result の本文を spill と同じ形式の参照に置き換えるだけにする。要約の質はそのあとで上げる。

## 未了

- spill の pipeline 差し込み（makeTools のオプションとして閾値と書き出し先を受け取る形を検討。executeTool の引数が増えるため）。
- compaction の実装と、履歴長の判定（どこで長いと見なすか）。
- AGENTS.md を profile の行から無効化できるようにするか。
