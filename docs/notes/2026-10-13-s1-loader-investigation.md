# S1 loader 調査メモ（2026-10-13）

## 確認できたこと（テストで固定済み）

- カーネル loader の合成は健全。`loadProfile → Layer.build → Context.get` で、提供 service が context に現れる
  （`packages/kernel/kernel/tests/loader.test.ts`）。
- 依存する側の行が提供側より先にあっても解決できる（行順に依存しない）。
- 層の Effect が別 row の層の service を読む二段構えでも通る。二依存でも通る。
- `@fudo/session` の plugin は loader 経由で `Sessions.create` まで動く
  （`packages/core/session/tests/service-layer.test.ts`）。
- `@fudo/session-jsonl` の plugin は loader 経由で実ファイルへ `session/header` を書ける
  （`packages/core/session-jsonl/tests/plugin.test.ts`）。

## 未解決

`packages/bundle/base/tests/assembly.test.ts` で 5 行
（kernel / session / session-jsonl / system-prompt / tools）をまとめて組むと、
`Context.get(context, Tools)` と `SystemPrompt` は取れるのに **`Sessions` だけ context に現れない**
（`Service not found: fudo/Sessions`）。同じ plugin 定義は自パッケージの loader テストでは通るため、
bundle テスト文脈のモジュール解決（`@fudo/session` の解決先が複数になる等）が最有力候補。

## 次の診断（1 回で終わるように）

1. `bun install` 後に `readlink packages/bundle/base/node_modules/@fudo/session` を確認し、
   `packages/core/session` と同一実体かを確かめる。
2. bundle の 5 行テストを再導入し、失敗時に `Sessions.key` / `SessionPersistenceService.key` の文字列と
   loader が組んだ row id 一覧を出力する。
3. 解決先が分かれているなら bundle の依存宣言を直す。同一なら loader の 5 行での provider 対応付けを疑い、
   最小再現（Hooks を要求する row を 2 つ置く）を作る。
