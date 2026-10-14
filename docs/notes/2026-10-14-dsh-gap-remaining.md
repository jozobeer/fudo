# DSH との差を埋めるための残りリスト（2026-10-14 夜）

同日の [dsh のギャップ表](2026-10-14-dsh-gap-backlog.md)の31項目はすべて実装・検証済み。本ファイルはその後の実測で残った差分を列挙する。優先度は付けない。上から依存関係の順に片付ける。

- `dsh:` は DSH リポジトリ（`/Users/hondazn/git/github.com/hondazn/deepseek-harness`）のルートからのパス。
- `fudo:` はこのリポジトリのルートからのパス。
- 実測は 2026-10-14 22:50 時点。`bun run check` は 742 pass / 1 skip / 0 fail（743 テスト / 189 ファイル）。

## 実装度（重み付き 約75%）

| 層 | 重み | 実装度 | 主な残り |
|---|---|---|---|
| 核・実行機構 | 15% | 95% | なし（ログの忠実性は回復済み） |
| モデルに見える文脈 | 30% | 65% | runtime context が 2/4、compaction に閾値と要約がない |
| ツール実行面 | 20% | 80% | 説明文が DSH の 1/3、edit の CRLF・バイナリ未対応 |
| 自律性・委譲 | 20% | 85% | repeat リマインダーが未配線、workflow に編成の表現力がない |
| 安全・耐久 | 10% | 65% | 圧縮・lease・export・検索がない |
| UI・提示・検証 | 5% | 40% | 記録が 2 件、coverage/doc/重複 gate がない |

## 0. 作ったのに効いていない（先に片付ける）

- [ ] **repeat リマインダーの配線**。`fudo:packages/core/tools-tier1/src/repeat-reminder.ts` は実装とテストがあるが、`tools/pre-execute` にも `tools.guard(` にも登録がない（production の利用はゼロ、テストのみ）。モデルは同じ呼び出しを繰り返し続ける。現在値: 登録 0 箇所。受け入れ: 同じツール・同じ引数が3回続いたとき、次のリクエストにリマインダーが入ることを e2e で観測する。

## 1. モデルに見える文脈（層2）

- [ ] **runtime context の残り2種**。`fudo:packages/core/system-prompt/src/builtin.ts:116` の `builtinContexts` は cwd と時刻だけを返す。dsh は sandbox mode と承認ポリシーも同じ snapshot に入れる（`dsh:packages/sandbox/sandbox-policy/src/index.ts:142`、`dsh:packages/interaction/user-approval/src/index.ts:163`）。現在値: 2 種。受け入れ: runtime-context メッセージに `sandbox:` と `approval:` の行が入り、値が変わったときだけ新しい snapshot が足される。
- [ ] **compaction の閾値**。`fudo:packages/core/session/src/compaction.ts` は閾値を持たず、毎リクエスト reasoning を落として 32 KB 超を 120 字のスタブに置き換える。dsh は context の 0.8（headroom 65,536、retention 0.16、モデル別 override）で発火する（`dsh:packages/compaction/compaction-basic/src/config.ts:20`）。現在値: 常時適用。受け入れ: 予算内では何も置き換えず、超えたときだけ置き換わることをテストで示す。
- [ ] **compaction の要約**。dsh は補助 LLM の構造化要約を checkpoint メッセージとしてログに残す（`dsh:packages/compaction/compaction-basic/src/summarizer.ts:31`）。fudo は機械的な stub のみ。受け入れ: 古い範囲が要約1件に置き換わり、置き換えた範囲がログから辿れる。
- [ ] **token meter**。dsh は usage を畳んでルートごとの予算に対する残量を持ち、compaction の入力にする（`dsh:packages/token-meter`）。fudo は usage を `assistant/message` に記録するだけ。受け入れ: 残量が閾値を切ったことが compaction の発火条件になる。
- [ ] **tool-result pruner と image offload**。dsh は古い tool 結果の専用間引きと画像の参照化を別プラグインで持つ（`dsh:packages/compaction/tool-result-pruner`、`dsh:packages/compaction/compaction-image-offload`）。
- [ ] **AGENTS.md の候補名**。`fudo:packages/core/system-prompt/src/agents-md.ts:31` の `names` は既定で AGENTS.md のみ。dsh は CLAUDE.md と `.local` 変種も既定の候補にする（`dsh:packages/context/agent-instructions/src/config.ts:12`）。現在値: 1 名。受け入れ: CLAUDE.md だけを置いたディレクトリで、その内容がプロンプトに入る。

## 2. ツールの深さ（層3）

- [ ] **説明文の量**。現在値: ツール説明 9,184 B とパラメータ説明 108 箇所（dsh は 27,194 B、パラメータは全数）。受け入れ: 失敗からの回復手順（edit は読み直し、read は offset で続き、bash は退避先を読む）が説明本文に書かれている。
- [ ] **edit の CRLF とバイナリ**。現在値: どちらの扱いも無い（`fudo:packages/core/tools-tier0/src/edit.ts` に該当なし）。dsh は CRLF を正規化しバイナリを読む前に拒否する（`dsh:packages/fs/fs-local/src/fsio.ts:733`）。受け入れ: CRLF のファイルを編集しても改行が変わらない。バイナリは編集前にエラーになる。
- [ ] **glob の並び順と grep の上限**。現在値: 名前順・200 件で打ち切り。dsh は更新時刻順・250 件で、超過分は退避して locator を返す（`dsh:packages/fs/tool-fs-search/src/glob.ts:25`、`grep.ts:29`）。受け入れ: 上限を超えた検索で全量への手がかりが返る。
- [ ] **bash の退避通知**。現在値: spill 一般の通知。dsh は `[output truncated; full output: <path>]` を返し、読み方（offset/limit）まで書く（`dsh:packages/shell/tool-bash/src/render.ts:11`）。
- [ ] **除外したツールの方針変更**（pwsh、lsp、terminal、computer/browser、MCP resources、`present`、plugin_manager、ralph、create_worktree）。現在値: 設計文書の表で除外。変えるなら `docs/superpowers/specs/2026-10-13-fudo-kernel-design.md` の表の更新が先。

## 3. 自律性（層4）

- [ ] **repeat リマインダー**（0 と同じ）。
- [ ] **workflow の編成**。現在値: フラットなタスク配列・同時実行数・`text`/`json` の期待（`fudo:packages/core/tools-tier1/src/workflow.ts:20`）。dsh はスクリプトの hooks（`agent` / `pipeline` / `parallel` / `phase` / `log` / `args`）で任意に組める（`dsh:packages/workflow/tool-workflow/src/index.ts:161`）。受け入れ: 前段の出力を後段に渡すパイプラインが要るか要らないかを設計文書で決め、要るなら1本のテストで示す。
- [ ] **goal の権限規則**。現在値: `create/edit/pause/resume/complete/blocked` をどの turn からでも動かせる（`fudo:packages/core/tools-tier1/src/goal.ts:14`）。dsh は pause/resume を人間の turn に限り、`blocked` を N ラウンド未満では拒否する（既定3、`dsh:packages/goal/tool-goal/src/authority.ts:100`）。受け入れ: モデルだけの turn から pause/resume ができない。blocked は規定ラウンド未満で拒否される。

## 4. 耐久（層5）

- [ ] **session の読み出し機構**。現在値: JSONL の生読み、破損末尾の修復、v0→v1 の移行まで（`fudo:packages/core/session-jsonl/src/repair.ts`、`upgrade.ts`）。dsh は v0→v4 の連鎖、zstd 圧縮、flock lease、ZIP export、FTS5 の検索と trace を持つ（`dsh:packages/session-query/session-query/src/index.ts:153`）。受け入れ: 1万イベントのログで一覧が1秒未満で返り、検索が全走査なしで引ける。
- [ ] **複数 consumer**。現在値: UI host の fan-out のみ（`fudo:packages/ui/host/src/index.ts`）。dsh は `Observation.retain()` で複数の読み手が同じログを購読する（`dsh:packages/session-query/src/observation.ts:17`）。
- [ ] **除外した基盤**（telemetry、identity、settings UI、credentials サービス）。方針変更は設計文書の更新が先。

## 5. 検証機構（層6）

- [ ] **記録の corpus**。現在値: 2 件（`fudo:apps/cli/tests/snapshots/`）。dsh は 227 シナリオ / 1,555 ファイルをキー無しで再生する（`dsh:vitest.snapshot.config.ts:32`）。受け入れ: 主要経路（tool 失敗、承認拒否、compaction 発火、resume、subagent）がそれぞれ1本以上の記録で再生される。
- [ ] **coverage 閾値**。現在値: `test:coverage` があるだけ（`fudo:package.json:13`）。受け入れ: 閾値を下回ると `bun run check` が落ちる。
- [ ] **doc gate・重複検出・real-API lane**。現在値: いずれも無し。real-API は鍵が無ければ skip する形で足す。
- [ ] **提示層**。現在値: tool の1行要約を記録し、TUI と Web が同じ view で描く。dsh はノードレジストリでカード・差分・markdown を描く（`dsh:packages/client/ui-conversation/src/client/contract/conversation.ts:203`）。受け入れの判断: v1 でカードが要るかを設計文書に書く。

## 6. 挙動の実測（未着手）

- [ ] **同一タスクの A/B**。fudo と dsh で同じコーディングタスクを走らせ、ツール呼び出し回数・失敗した edit の数・読み直しの回数・turn 数を数える。現在値: 未実施。受け入れ: 3 タスク × 2 ハーネスで数値が出て、差の説明がつく。ここが埋まるまで「良い動き」の主張は未証明のままである。

## 未確認

- dsh 側の `token-meter` と `tool-result-pruner` の発火条件は、設定の既定値まで読んでいない。
- fudo の compaction が実運用の長さで期待どおり縮むかは、e2e の assert までで実測していない。
- `bun run check` の所要時間は 9.17 秒（テストのみ）。CI は無い。
