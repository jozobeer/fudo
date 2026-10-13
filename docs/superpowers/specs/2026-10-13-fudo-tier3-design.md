# fudo 設計: S6 Tier 3

範囲は設計文書の分割表に従う: subagent（fork を含む）、jobs、goal、workflow（PTC）、working-directory。

## 前提（S1 から S5 までで使えるもの）

- ツールは ToolDefinition で宣言し、依存（sandbox や Ask など）は構築時に注入する。
- 子 agent は Agents.create で作れる。親子はセッションの並置で表す（subagent ツールで実装済み）。
- 承認と質問は session に残るイベント（safety/approval/*, interaction/ask/*）と Deferred で扱う。
- ログは JSONL。イベント型は SessionEventMap への宣言マージと registerSessionEventSchemas で足す。

## 決定

1. **working-directory はイベントで表す。** session/cwd の変更を session/cwd/changed として記録し、agent loop は「最後の変更、無ければ session/header」を現在の cwd として使う。ツール context の cwd もそれに従う。ツール側は working_directory ツール（needs: []）で、変更先がワークスペース外なら拒否する。
2. **jobs はセッションに紐づくプロセスの表。** 起動は bash の非同期版（needs: exec、承認は bash と同じ）。出力は退避と同じくファイルに書き、job_id で引く。プロセスは Scope に結びつけ、セッション終了で止める。
3. **goal は目標の記録。** 新しいサービスを作らず、tool/result としてログに残す（todo_write と同じ方針）。継続ラウンドのような自動再開は v1 では持たない。
4. **workflow（PTC）は「同じ turn で複数のツールを並べる」に留める。** isConcurrencySafe が真の連続呼び出しを並列に実行する（S1 で保留にした項目）。コードを書く/実行する新しい DSL は v1 では持たない。
5. **subagent の fork は、親の履歴を子に渡す形で表す。** 子のセッションを親のイベントから派生させて作り、cwd と route を引き継ぐ。

## 進め方

1 は S1 の拡張（イベント 1 種と loop の cwd 解決）で済むため最初にやる。次に 4（並列実行）、3（goal）、2（jobs）、最後に 5（fork）。

## 実装の記録

- subagent: packages/core/tools-tier1/src/subagent.ts（makeSubagentTool(agents, route)）。CLI は subagents: true のとき登録する。
