# S1 loader 調査メモ（2026-10-13、解決済み）

## 結論

`bundle/base` の 5 行アセンブリで `Sessions` が見えなかった原因は **テスト側の row id の取り違え**だった。
`profiles/base.yml` の session 行の id は `sessions`（複数形）だが、テストのフィルタが `session` を指定していたため
その行が除外され、`Sessions` は最初から組まれていなかった。loader にも plugin 定義にも欠陥はない。

## 検証済み（テストで固定）

- loader の合成は健全。提供 service は built context に現れる（`packages/kernel/kernel/tests/loader.test.ts`）。
- 行順に依存しない。二段構えの層・二依存の層も通る（同上）。
- `@fudo/session` plugin は loader 経由で `Sessions.create` まで動く（`packages/core/session/tests/service-layer.test.ts`）。
- `@fudo/session-jsonl` plugin は loader 経由で実ファイルへ `session/header` を書ける（`packages/core/session-jsonl/tests/plugin.test.ts`）。
- `bundle/base` の 5 行（kernel / sessions / session-jsonl / system-prompt / tools）を実際に読み、
  1 つの Layer に組んで `Tools` / `SystemPrompt` / `Sessions` が取れる（`packages/bundle/base/tests/assembly.test.ts`）。

## 学び

`Service not found: <key>` は「層が壊れている」とは限らない。**その service を提供する行がプロファイルに含まれているか**を先に確認する。
