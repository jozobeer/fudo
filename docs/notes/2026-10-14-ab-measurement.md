# fudo と dsh の同一タスク A/B（2026-10-14）

3 つのコーディングタスクを fudo と dsh に同じ文面で投げ、それぞれのセッションログからツール呼び出し回数・失敗した edit の数・読み直しの回数・turn 数を数える。判定はワークスペースのファイルだけを見る（モデルの自己申告は使わない）。

- 実行者: `bun run scripts/ab/run.ts`（リポジトリのルートから）。タスクは `fudo:scripts/ab/tasks.ts`、計数は `fudo:scripts/ab/metrics.ts`、ログの読み方は fudo が `session.v1.jsonl`、dsh が `session.v4.jsonl.zstd`。
- fudo の route: `ollama-cloud/deepseek-v4.1-flash`（`FUDO_AB_ROUTE` で変える）。dsh は `~/.dsh` の headless profile と資格情報を使う（workspace 内に複製した DSH_HOME 経由）。
- 実行時刻: 2026-10-14 23:30 JST 頃。1 タスク = 1 ラウンド、タイムアウト 300 秒。

## 結果

| harness | task | done | tool calls | failed edits | re-reads | turns | exit | note |
|---|---|---|---|---|---|---|---|---|
| fudo | fix-add | yes | 3 | 0 | 1 | 1 | 0 | |
| dsh | fix-add | no | 0 | 0 | 0 | 1 | 1 | AUTH: stored key rejected |
| fudo | write-notes | yes | 3 | 0 | 0 | 1 | 0 | |
| dsh | write-notes | no | 0 | 0 | 0 | 1 | 1 | AUTH: stored key rejected |
| fudo | rename-function | yes | 12 | 0 | 2 | 1 | 0 | |
| dsh | rename-function | no | 0 | 0 | 0 | 1 | 1 | AUTH: stored key rejected |

## fudo の数値が示すこと

- 3 タスクとも、1 turn・失敗 edit 0 で完了した。読み直しは fix-add で 1 回、rename-function で 2 回で、どちらも編集の前に今の内容を確かめ直した分である。
- rename-function の 12 回は、2 ファイルの書き換えと、その後の確認（読み直し・検索）を含む。fix-add / write-notes の 3 回は「対象を読む → 書く → 確かめる」の最小形である。
- この数値だけでは「fudo が dsh より良い」とは言えない。turn 数もツール数も、モデル・タスク・ログの粒度に依存する。比較の主張は下表が両方埋まってからにする。

## dsh 側が止まっている理由（未完了の受入）

dsh の 3 走はどれも、モデルに届く前に資格情報で止まった:

```
dsh: AUTH: Authentication Fails, Your api key: ****ci1Q is invalid
```

- `~/.dsh/.credentials.yaml` に入っているキーを provider が拒否している。dsh の headless profile は Messages 互換の `llm-deepseek` を使うので、fudo が使っている Ollama Cloud のキー（OpenAI 互換）は代わりにならない。
- 出たログは 1 turn（失敗した turn）だけで、ツール呼び出しは 0。したがって dsh 側の数値はまだ存在しない。
- 解除の条件: 有効な DeepSeek の資格情報を用意し（`dsh auth` / credentials サービス、または `DEEPSEEK_API_KEY` を環境に置く）、`bun run scripts/ab/run.ts` をもう一度走らせる。harness と計数は `fudo:scripts/ab/metrics.test.ts` で両形式とも検証済みなので、キーが入れば表が埋まる。

## 再実行

```
bun run scripts/ab/run.ts
FUDO_AB_ROUTE=ollama-cloud/qwen3-coder:480b bun run scripts/ab/run.ts
```

成果物は `.tmp/ab/runs/<harness>-<task>/` に残る（workspace とセッションログ）。表をこの文書に貼り、差があれば「どの列が、どのツール呼び出しの形から来たか」をログに当たって書く。
