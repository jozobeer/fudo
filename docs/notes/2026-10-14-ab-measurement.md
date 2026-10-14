# fudo と dsh の同一タスク A/B（2026-10-14）

3 つのコーディングタスクを fudo と dsh に同じ文面で投げ、それぞれのセッションログからツール呼び出し回数・失敗した edit の数・読み直しの回数・turn 数を数えた。判定はワークスペースのファイルだけを見る（モデルの自己申告は使わない）。

## 条件

- 実行者: `bun run scripts/ab/run.ts`（リポジトリのルートから）。タスクは `fudo:scripts/ab/tasks.ts`、計数は `fudo:scripts/ab/metrics.ts`、dsh の経路は `fudo:scripts/ab/dsh-provider.patch.yml`。
- モデルは両ハーネスとも Ollama Cloud の `deepseek-v4.1-flash`（fudo は自前の OpenAI 互換 adapter、dsh は pi-ai 経由で同じ baseURL・同じモデル名）。fudo は `~/.config/fudo/secrets.env` の鍵を自分で読み、dsh は harness が同じ鍵を環境に渡す。
- 1 セル（ハーネス × タスク）を 3 回繰り返した。合計 18 走、タイムアウト 300 秒/走。
- タスク:
  1. `fix-add` — `src/math.ts` の `add` が引き算になっているので足し算に直す。
  2. `write-notes` — `# Notes` 見出しと `status: ready` の行を持つ `notes.md` を作る。
  3. `rename-function` — `fetchValue` を `readValue` に、`src/` 全体で改名する。
- 計数の定義: tool calls は `tool/call` の数、failed edits は edit の結果がエラーだった数、re-reads は同じセッションで既に読んだパスをもう一度 read した数、turns は `turn/start` の数。

## 結果（3 回の幅と平均）

`counted` は数値の出た走の数で、幅と平均はその走だけから出る。

| harness | task | runs | counted | done | tool calls | turns | failed edits | re-reads |
|---|---|---|---|---|---|---|---|---|
| fudo | fix-add | 3 | 3 | 3 | 3-4 (3.3) | 1 | 0 | 1 |
| dsh | fix-add | 3 | 3 | 3 | 3-4 (3.7) | 1 | 0 | 1 |
| fudo | write-notes | 3 | 3 | 3 | 2-3 (2.3) | 1 | 0 | 0 |
| dsh | write-notes | 3 | 3 | 3 | 2-4 (3.0) | 1 | 0 | 0 |
| fudo | rename-function | 3 | 3 | 3 | 7-14 (10.3) | 1 | 0 | 0-2 (1.3) |
| dsh | rename-function | 3 | 3 | 3 | 8-12 (10.0) | 1 | 0 | 0-2 (0.7) |

走ごとの値（参考）:

| harness | task | run 1 | run 2 | run 3 |
|---|---|---|---|---|
| fudo | fix-add | 4 calls / 1 re-read | 3 / 1 | 3 / 1 |
| dsh | fix-add | 3 / 1 | 4 / 1 | 4 / 1 |
| fudo | write-notes | 3 / 0 | 2 / 0 | 2 / 0 |
| dsh | write-notes | 2 / 0 | 4 / 0 | 3 / 0 |
| fudo | rename-function | 10 / 2 | 7 / 0 | 14 / 2 |
| dsh | rename-function | 10 / 0 | 12 / 2 | 8 / 0 |

## 差の説明

- **完了と turn 数に差は無い**。6 セルすべて 3/3 完了、どの走も 1 turn。3 タスクは 1 turn で終わる大きさなので、turn 数はハーネスの差を写さない。
- **失敗 edit は両方 0**。どちらの edit も一発で当たっており、この 3 タスクでは edit の当たり外れが差にならない。
- **tool calls の差は走ごとのばらつきに埋もれている**。rename-function は fudo が 7〜14、dsh が 8〜12 で、平均の差（10.3 対 10.0）より各ハーネス内の幅の方が大きい。n=3 でこの幅では、平均の 0.3 回を「dsh の方が少ない」と読む根拠は無い。
- **読み直しの型は同じ**。fix-add は両方とも「read → edit → read」で、最後の read が同じパスの 2 回目になる（1 re-read）。rename-function の 0〜2 回は、改名後に両ファイルを読み直して確認した走だけに出る（fudo 2/3 走、dsh 1/3 走。n=3 では区別できない）。fudo は 1 走で `bash(git diff)` を挟んでから読み直し、dsh は 1 走で編集前に `ls -R` を重ねた——どちらも同じ確認行動の別表現で、頻度の差ではない。
- したがって、この 3 タスク・n=3 の範囲では **ハーネス由来の系統差は観測されなかった**。差が出るとすれば長いタスク（多 turn・edit 失敗・compaction 発火）で、そこはこの A/B の外である。

## 計数の訂正（同じログの数え直し）

最初の集計は dsh の re-reads を 0 と数えていた。dsh の read は引数を `file_path` に、fudo は `path` に置くのに、計数が `path` だけを見ていたためである（行動ではなく計測の不具合）。`fudo:scripts/ab/metrics.ts` を両方の綴りを読むように直し、`scripts/ab/metrics.test.ts` に dsh 綴りの回帰を足した。上の表は同じ 18 走のログを数え直した結果で、モデルは走らせ直していない（ログは `.tmp/ab/runs/<harness>-<task>-<n>/` に残っている）。

## 再実行

```
bun run scripts/ab/run.ts                      # 1 回ずつ
FUDO_AB_REPEATS=3 bun run scripts/ab/run.ts    # 3 回ずつ（上の表）
FUDO_AB_ROUTE=ollama-cloud/qwen3-coder:480b bun run scripts/ab/run.ts
```

- 成果物: `.tmp/ab/runs/<harness>-<task>-<n>/` に workspace、セッションログ（fudo は `sessions/session.v1.jsonl`、dsh は `dsh-home/sessions/**/session.v4.jsonl.zstd`）が残る。
- 環境変数: `FUDO_AB_REPEATS`（既定 1）、`FUDO_AB_ROUTE`（既定 `ollama-cloud/deepseek-v4.1-flash`）、`FUDO_AB_TIMEOUT_MS`（既定 300000）。

## 限界

- n=3、モデル 1 つ、1 turn で終わる 3 タスク。長いセッション・edit の失敗・compaction・subagent は測っていない。
- ツールセットは両ハーネスで同じではない（dsh は `present`・`herdr` なども持つ）。プロンプトと作業ディレクトリだけを揃えた比較である。
- モデルの出力は非決定的で、幅は上の表のとおり。平均の差を主張するには走数を増やす必要がある。
