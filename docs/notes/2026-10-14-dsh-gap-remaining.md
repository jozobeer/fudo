# DSH との差を埋めるための残りリスト（2026-10-14 夜）

同日の [dsh のギャップ表](2026-10-14-dsh-gap-backlog.md)の31項目はすべて実装・検証済み。本ファイルはその後の実測で残った差分を列挙する。優先度は付けない。上から依存関係の順に片付ける。

- `dsh:` は DSH リポジトリ（`/Users/hondazn/git/github.com/hondazn/deepseek-harness`）のルートからのパス。
- `fudo:` はこのリポジトリのルートからのパス。
- 実測は 2026-10-14 22:50 時点。`bun run check` は 742 pass / 1 skip / 0 fail（743 テスト / 189 ファイル）。

## 実装度（重み付き 約75%）

| 層 | 重み | 実装度 | 主な残り |
|---|---|---|---|
| 核・実行機構 | 15% | 95% | なし（ログの忠実性は回復済み） |
| モデルに見える文脈 | 30% | 65% | runtime context は 4 種で充足（実測）、compaction に閾値と要約がない |
| ツール実行面 | 20% | 80% | 説明文が DSH の 1/3（edit と検索は充足） |
| 自律性・委譲 | 20% | 85% | repeat リマインダーが未配線、workflow に編成の表現力がない |
| 安全・耐久 | 10% | 65% | 圧縮・lease・export・検索がない |
| UI・提示・検証 | 5% | 40% | 記録が 2 件、coverage/doc/重複 gate がない |

## 0. 作ったのに効いていない（先に片付ける）

- [x] **repeat リマインダーの配線**（実測で既に閉じていた）。`installRepeatReminders` は `fudo:apps/cli/src/index.ts:644` で agent ごとに `tools/post-execute`（prepend）へ登録され、結果を組む前に他の listener を通す。登録 0 箇所という前回の実測は誤りで、テストだけでなく出荷経路に載っている。受け入れ: e2e `fudo:apps/cli/tests/repeat-reminder-e2e.test.ts` が同じ `todo_write` を3回呼び、3回目の結果にリマインダが載り、その次のリクエスト本文にも入ることを観測する。

## 1. モデルに見える文脈（層2）

- [x] **runtime context の残り2種**（実測で既に閉じていた）。`builtinContexts` は cwd と時刻だけだが、`fudo:packages/core/safety/src/plugin.ts:64` の `policyLayerWithContexts` が同じ registry に `approval` と `sandbox` を order 20/21 で登録するので、出荷構成の snapshot は 4 種である。受け入れ: e2e `fudo:apps/cli/tests/runtime-context-e2e.test.ts` が `cwd:`・`time:`・`approval: workspace-write`・`sandbox: seatbelt` の4行を確かめ、`working_directory` で cwd が変わったときに snapshot が1枚だけ増えることを観測する。
- [x] **compaction の閾値**。`meterOf`（`fudo:packages/core/session/src/token-meter.ts`）が推定した次リクエストのトークン量を、`contextWindow × thresholdRatio` と `contextWindow - headroomTokens` の小さい方と比べ、越えたときだけ `recordCompaction` が動く（既定 0.8 / 65,536 / 128,000）。contextWindow は profile の agent-loop config か、adapter の `LlmCapabilities.contextWindow` から取る（`fudo:packages/llm/llm/src/types.ts`）。予算内では reasoning も落とさず、そのまま送る。受け入れ: e2e `fudo:apps/cli/tests/compaction-e2e.test.ts` の「a conversation with room left is sent untouched」が同じ履歴・同じ prune price で budget だけを変え、予算内は compaction イベント 0 件・元の文がそのまま、超過時だけ置き換わることを示す。
- [x] **compaction の要約**。閾値を越えると、retention の外の範囲を補助 LLM 呼び出し（同じ route、指示を末尾に足し、tools を外す）で構造化要約し、`compaction/checkpoint` として `{ shadowedSeqs, shadowedRange, summary, provider, model }` を記録する。projection が範囲を1件の user メッセージに置き換えるので、ログの元イベントは残り、範囲は seq で辿れる。要約が空・失敗なら checkpoint を書かず、従来の `compaction/prune`（stub）が受け皿になる。checkpoint のメッセージは prune の対象外。受け入れ: `fudo:packages/core/session/tests/checkpoint.test.ts` 7本と e2e の「an old span becomes one summary the next request carries」「a summarizer that cannot answer leaves the prune as the fallback」。
- [x] **token meter**。`meterOf(events, budget)` は、最後に usage を持つ `assistant/message` の input+output を土台にし、それ以降のイベントだけを UTF-8 バイト / 4 で見積もって次リクエストの圧力とする（状態を持たず、resume でも同じ）。`source` が 'usage' か 'bytes' かを返す。受け入れ: e2e「what the provider counted is what pushes the request over」が、バイトは同じで報告 usage だけ 900+50 / 5+5 と変え、閾値を切った側だけが compaction することを示す。
- [x] **tool-result pruner と image offload**。dsh は別プラグインだが、fudo は compaction の prune 規則の中に持つ（パッケージを増やさない）。retention の外では、tool 結果の text が 8,192 字を超えたら head 4,096 字 + `[... tool result middle pruned ...]` + tail 1,024 字を残し（コードポイント単位で surrogate pair を割らない）、image ブロックは `[image offloaded: <name>; read it again with the read_image tool to see it]` に置き換える。受け入れ: `fudo:packages/core/session/tests/compaction.test.ts` の3本（head/tail 保持、価格内は無変更、画像が参照になり fold から base64 が消える）。
- [x] **AGENTS.md の候補名**。既定の候補を `AGENTS.md` / `CLAUDE.md`、ローカル上書きを `AGENTS.local.md` / `CLAUDE.local.md` にし、1 ディレクトリにつき base → local の順で読む（`fudo:packages/core/system-prompt/src/agents-md.ts`）。home は dsh と同じく `AGENTS.md` だけ。受け入れ: 単体テスト2本と e2e `fudo:apps/cli/tests/agents-md-e2e.test.ts` の「CLAUDE.md だけの作業ディレクトリ」で、内容がプロンプトに入る。

## 2. ツールの深さ（層3）

- [x] **説明文の量**。失敗からの回復手順を説明本文に書いた: read は footer が続きを言ったら offset で呼び直す、edit は no match か複数一致なら読み直して正確な文字列を引く、bash は spill されたら保存先を offset/limit で読む。write・glob・grep にも同じ 1 文を足した。あわせて `toolSchemaIssues` を入れ子の object と配列 item まで降ろし（`fudo:packages/core/tools/src/schema-check.ts`）、`fudo:packages/core/tools-tier1/tests/schema.test.ts` は tier 1 の全 tool（subagent・team・workflow・schedule・goal・plugin・exit_plan_mode を含む）を検査する。前回の「9,184 B / 108 箇所」は広い集合の数字で、既定 profile の実測は 19 tool / 45 パラメータ / 3,251 B、説明の無いパラメータは 0。受け入れ: `fudo:apps/cli/tests/tool-schema-e2e.test.ts` と上記 unit test が指摘ゼロを要求する。
- [x] **edit の CRLF とバイナリ**。`readForEdit` が NUL バイトを decode の前に拒否し、LF に正規化した本文と元の ending を返す（`fudo:packages/core/tools-tier0/src/text.ts`）。edit は編集後に `restoreLineEndings` で書き戻すので、CRLF のファイルは CRLF のまま。受け入れ: `fudo:packages/core/tools-tier0/tests/edit.test.ts` に CRLF 保持と NUL 入りファイルの拒否の2本を追加（読み直せない非 UTF-8 のファイルは従来どおり read の段で止まる）。
- [x] **glob の並び順と grep の上限**。`walkFiles` に `order: 'modified'` を足し、glob は更新時刻の古い順になった。glob / grep は既定 100 / 250 件を inline の page とし、`SEARCH_PAGE_BYTES` 30,000 の範囲で切り、超過分は `writeSpill` でセッション横のファイルに保存して locator と読み方（read の offset/limit）を返す。locator を渡す seam は `ToolRunContext.spill` で、場所は loop が持ち、何を保存するかは tool が決める。grep の一致行は 2000 字で切る。受け入れ: `fudo:packages/core/tools-tier0/tests/search.test.ts` の mtime 順・locator の2本と、e2e `fudo:apps/cli/tests/search-recovery-e2e.test.ts`（2000 件の検索で page 250 + 全量ファイル + 次のリクエストで tail を読む）。
- [x] **bash の退避通知**（実測で充足していた）。一般の退避通知 `[spilled to <path>: N lines, M bytes. Use the read tool with offset and limit to page through it.]`（`fudo:packages/core/tools/src/spill.ts`）は、dsh の `[output truncated; full output: <path>]` が持つ要素（退避先のパス・行数・読み方）をすべて含む。bash 専用の文言ではないが、モデルが次に取る行動は同じである。受け入れ: e2e `fudo:apps/cli/tests/spill-recovery-e2e.test.ts` が bash の 32 KB 超出力で通知のパスを取り、次の step でそのファイルを read して末尾を読む。違いは preview が末尾ではなく先頭であること（dsh は末尾を残す）。
- [ ] **除外したツールの方針変更**（pwsh、lsp、terminal、computer/browser、MCP resources、`present`、plugin_manager、ralph、create_worktree）。現在値: 設計文書の表で除外。変えるなら `docs/superpowers/specs/2026-10-13-fudo-kernel-design.md` の表の更新が先。

## 3. 自律性（層4）

- [ ] **repeat リマインダー**（0 と同じ）。
- [ ] **workflow の編成**。現在値: フラットなタスク配列・同時実行数・`text`/`json` の期待（`fudo:packages/core/tools-tier1/src/workflow.ts:20`）。dsh はスクリプトの hooks（`agent` / `pipeline` / `parallel` / `phase` / `log` / `args`）で任意に組める（`dsh:packages/workflow/tool-workflow/src/index.ts:161`）。受け入れ: 前段の出力を後段に渡すパイプラインが要るか要らないかを設計文書で決め、要るなら1本のテストで示す。
- [x] **goal の権限規則**。`turnHasSource` / `inHumanTurn` / `inGoalRound` を `fudo:packages/core/tools-tier1/src/goal-state.ts` に置き、最後の `turn/start` から先だけを見る。pause / resume は human source の message がある turn でだけ動き、モデルが自分で始めた round では拒否される。blocked は自動 round で `MIN_BLOCKED_ROUNDS`（3）未満なら拒否し、人間の turn があれば round 数に関係なく許す。前回の `inAutomaticRound` は「最後の user/message が goal-round か」だけを見ていたので、round の途中に steer（source: inject）が入ると閾値をすり抜けた——いまは open turn を走査する。受け入れ: unit 9 本（pause/resume の拒否、steer が入った round の blocked 拒否、人間の turn の blocked 許可）と e2e `fudo:apps/cli/tests/goal-rounds-e2e.test.ts`（実際の round で pause が拒否され、goal は paused にならない）。

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
