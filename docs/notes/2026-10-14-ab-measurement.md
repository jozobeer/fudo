# fudo と dsh の同一タスク A/B（2026-10-14、長いタスクは 2026-10-15）

4 つのコーディングタスクを fudo と dsh に同じ文面で投げ、それぞれのセッションログからツール呼び出し回数・失敗した edit の数・読み直しの回数・turn 数・compaction の回数を数えた。判定はワークスペースのファイルだけを見る（モデルの自己申告は使わない）。

## 条件

- 実行者: `bun run scripts/ab/run.ts`（リポジトリのルートから）。タスクは `fudo:scripts/ab/tasks.ts`、計数は `fudo:scripts/ab/metrics.ts`、dsh の経路は `fudo:scripts/ab/dsh-provider.patch.yml`。
- モデルは両ハーネスとも Ollama Cloud の `deepseek-v4.1-flash`（fudo は自前の OpenAI 互換 adapter、dsh は pi-ai 経由で同じ baseURL・同じモデル名）。fudo は `~/.config/fudo/secrets.env` の鍵を自分で読み、dsh は harness が同じ鍵を環境に渡す。
- 1 セル（ハーネス × タスク）を 3 回繰り返した。合計 24 走、タイムアウトは短いタスクが 300 秒/走、`fix-rules` が 1,200 秒/走。
- compaction の発火点は両ハーネスとも 16,000 トークンにそろえた（fudo は `fudo:scripts/ab/run.ts` の patch で window 20,000 / headroom 4,000、dsh は patch で window 52,768 / headroom 4,000。dsh は出力予約 32,768 も差し引く）。そろえる前は fudo が 62,464（既定 window 128,000）、dsh が 163,840 で、長いタスクでは設定の違いだけで fudo が先に圧縮していた。短いタスクのリクエストは最大で fudo 5,174 / dsh 10,352 トークンで、どちらの線にも届かない。
- タスク:
  1. `fix-add` — `src/math.ts` の `add` が引き算になっているので足し算に直す。
  2. `write-notes` — `# Notes` 見出しと `status: ready` の行を持つ `notes.md` を作る。
  3. `rename-function` — `fetchValue` を `readValue` に、`src/` 全体で改名する。
  4. `fix-rules` — `src/rules/` の 48 ファイルのうち、ヘッダの説明と食い違う 12 個のルール関数を直す（`fudo:scripts/ab/rules-task.ts`）。判定はワークスペースのルールを乱数入力で実行し、判定側の参照実装と比べる。
- 計数の定義: tool calls は `tool/call` の数、failed edits は edit の結果がエラーだった数、re-reads は同じセッションで既に読んだパスをもう一度 read した数、turns は `turn/start` の数、compactions は要約を書いた回数（fudo は `compaction/checkpoint`、dsh は `compaction/summary`）。

## 結果: 短いタスク（3 回の幅と平均）

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
- したがって、この 3 タスク・n=3 の範囲では **ハーネス由来の系統差は観測されなかった**。

## 結果: 長いタスク（fix-rules、2026-10-15）

| harness | task | runs | counted | done | tool calls | turns | failed edits | re-reads | compactions |
|---|---|---|---|---|---|---|---|---|---|
| fudo | fix-rules | 3 | 3 | 3 | 84-95 (88.7) | 1 | 0 | 13-26 (18.7) | 2-10 (6.3) |
| dsh | fix-rules | 3 | 3 | 3 | 55-112 (83.3) | 1 | 0 | 12-44 (25.0) | 10-16 (12.3) |

走ごとのリクエストの入力トークン（provider の usage。dsh は input + cacheRead）と、要約が書かれた位置（C）:

```
fudo-1: 3880 4318 4719 8607 14402 C 15324 C 15848 C 16282 C 16832 C 17537 C 17198 C 20797 C 21379 C 15495 C 9248 … 14827
fudo-2: 3880 4322 5670 13419 C 15637 C 16189 C 16765 C 17116 C 17522 C 11219 … 15035 C 10665 … 14246
fudo-3: 3880 4324 9176 10728 11177 13750 16334 C 7767 … 16666 C 10468 … 12900
dsh-1:  8586 10222 10681 11770 13680 C 14473 C … 23733 C 25681 C 25899 C C 15078 C 14985 C 14862
dsh-2:  8586 10222 10709 13909 15841 C 14759 C 14040 16410 C … 15574 C 16235
dsh-3:  8586 9105 11417 14954 C 16636 C 13623 C … 15640 C 14305 C 15136
```

- **完了は両方 3/3、失敗 edit は両方 0**。どの走も compaction を経たうえで 12 個すべてを直した。この範囲では、compaction がタスクの完了を壊すことは観測されなかった。
- **compaction の回数は dsh の方が多い**（fudo 2〜10、dsh 10〜16 で幅が重ならない）。ただし回数の大半は空回りである。両ハーネスとも、要約の直後のリクエストが線の少し下（約 15,000）までしか縮まず、次の step でまた発火する。縮みきったのは fudo-3 の 1 回目（16,334 → 7,767）と fudo-1 の終盤くらいである。
- **空回りの仕組み（fudo）**: fudo は末尾 12 メッセージを残し（`DEFAULT_COMPACT_KEEP_LAST`）、その手前の 8 件前後だけを要約する。要約は前の要約を含めて書き直されるので、fudo-1 では 3,708 字から 9,395 字へ育つ。システムプロンプト + 要約 + 末尾 12 件で約 15,000 になり、線の下に戻れない。保持がメッセージ数で決まり、圧縮後の大きさを線の下に収める目標を持たないことが原因である。
- **dsh の方が多い理由は未確認**。dsh の初回リクエストは 8,586 トークンで fudo（3,880）の 2 倍あり、線までの余裕が小さいことは数字から言えるが、それが回数の差をどれだけ説明するかは切り分けていない。
- **tool calls と re-reads はばらつきに埋もれている**。dsh は 55〜112、re-reads 12〜44 と幅が大きく、平均の差は走間の幅より小さい。
- 16,000 は長さを縮めた線である。実際の窓（fudo 62,464 / dsh 163,840）では、線に対して保持分と要約が小さくなるので空回りは起きにくいと見込むが、測っていない。

## 計数の訂正（同じログの数え直し）

最初の集計は dsh の re-reads を 0 と数えていた。dsh の read は引数を `file_path` に、fudo は `path` に置くのに、計数が `path` だけを見ていたためである（行動ではなく計測の不具合）。`fudo:scripts/ab/metrics.ts` を両方の綴りを読むように直し、`scripts/ab/metrics.test.ts` に dsh 綴りの回帰を足した。上の表は同じ 18 走のログを数え直した結果で、モデルは走らせ直していない（ログは `.tmp/ab-2026-10-14/runs/<harness>-<task>-<n>/` に退避してある。`run.ts` は実行のたびに `.tmp/ab` を消す）。

## 再実行

```
bun run scripts/ab/run.ts                      # 1 回ずつ
FUDO_AB_REPEATS=3 bun run scripts/ab/run.ts    # 3 回ずつ（上の表）
FUDO_AB_ROUTE=ollama-cloud/qwen3-coder:480b bun run scripts/ab/run.ts
FUDO_AB_TASKS=fix-rules FUDO_AB_REPEATS=3 bun run scripts/ab/run.ts   # 長いタスクだけ
```

- 成果物: `.tmp/ab/runs/<harness>-<task>-<n>/` に workspace、セッションログ（fudo は `sessions/session.v1.jsonl`、dsh は `dsh-home/sessions/**/session.v4.jsonl.zstd`）が残る。
- 環境変数: `FUDO_AB_REPEATS`（既定 1）、`FUDO_AB_ROUTE`（既定 `ollama-cloud/deepseek-v4.1-flash`）、`FUDO_AB_TIMEOUT_MS`（既定 300000。タスクが自分の値を持てばそちら）、`FUDO_AB_TASKS`（カンマ区切りのタスク名。既定は全部）。

## 限界

- n=3、モデル 1 つ。どのタスクも 1 turn で終わり、edit の失敗は起きなかった。多 turn と subagent は測っていない。
- 長いタスクは発火点を 16,000 に縮めて測った。実際の窓の大きさでの compaction は測っていない。
- ツールセットは両ハーネスで同じではない（dsh は `present`・`herdr` なども持つ）。プロンプトと作業ディレクトリだけを揃えた比較である。
- モデルの出力は非決定的で、幅は上の表のとおり。平均の差を主張するには走数を増やす必要がある。
