# DSH との挙動差バックログ（2026-10-14）

2026-10-14 の監査（fudo と DSH の4領域比較）で確認した差分の全項目。優先度は付けない。上から依存関係の順に片付ける。

- `dsh:` は DSH リポジトリ（`/Users/hondazn/git/github.com/hondazn/deepseek-harness`）のルートからのパス。
- `fudo:` はこのリポジトリのルートからのパス。
- 証拠はすべてソースの読み取りによる。fudo の `bun run check` は監査時に実行していない。

## 監査時点の測定値

| 指標 | fudo | dsh |
|---|---|---|
| base profile の plugin 行 | 12 | 94（web-app は別に 87 行） |
| 既定で登録されるツール名 | 14（条件付きで最大 18） | 27（base のみ） |
| ツール説明の文面 | 1,102 B | 27,194 B（自動生成カタログ 139 KB を除く） |
| prompt section の登録 | 0（AGENTS.md の 1 本のみ） | 34 本 / 31 ファイル |
| 記録済みセッション fixture | 1 | 227 シナリオ / 1,555 ファイル |
| session 系パッケージ | 2 | 24（v0→v4 の migration 4 段） |
| 重み付き実装度 | 36% | — |

## A. モデルに見える文脈・プロンプト

- [x] **A1 prompt 本文**。fudo は section 登録が 0 本で、AGENTS.md が無ければ system prompt は空文字になる（`fudo:packages/core/agent-loop/src/runner.ts:192`）。dsh は identity と、可視ツールに応じて条件分岐する guidance を 34 本登録する（`dsh:packages/core/system-prompt/src/index.ts:446`、`dsh:packages/shell/tool-bash/src/index.ts:251`）。受け入れ: エージェントの identity とツールの使い分け（read を cat の代わりに、など）がモデルに届く。
  - 実装（2026-10-14）: `@fudo/system-prompt` の layer が builtin の 2 section を持つ。`fudo:identity`（order 0、1 行の自己紹介と作業姿勢）と `fudo:tool-guidance`（order 100）で、guidance は `AssembleContext.tools` に入った可視ツール名だけを表から引き、該当が無ければ空文字になる（空 section は render で落とす）。`build()` が可視ツールを渡すので、plan-mode のような ToolRestriction 下では隠れたツールの guidance も出ない。plugin config の `includeHarnessIdentity` / `includeToolGuidance` で個別に切れる。AGENTS.md は従来どおり order 900 で後ろに付く。
  - 検証: `packages/core/system-prompt/tests/builtin.test.ts`（identity 単独、可視ツールだけの guidance、未知ツールの除外、config の on/off、service layer）と `apps/cli/tests/prompt-e2e.test.ts`（実 CLI 経路で `system/message` に identity と read / bash の guidance が入り、profile に無い tier1 の `todo_write` が入らないことをログで確認）。
- [x] **A2 runtime context**。fudo は `source: 'runtime-context'` を型に持つだけで生産者がいない（`fudo:packages/core/session/src/events.ts:29`）。dsh は cwd（必須）・sandbox mode・承認ポリシー・時刻（10分ごと更新）を durable な user メッセージとして記録する（`dsh:packages/core/agent-loop/src/runtime-context.ts:113`、`dsh:packages/context/time-context/src/index.ts:112`）。受け入れ: 値が変わったら新しい snapshot がログに足され、モデルがワークスペースのパスと現在の権限を推測なしに知れる。
  - 実装（2026-10-14）: dsh と同じく runtime context の registry を `@fudo/system-prompt` に置いた（`context(entry)` / `contexts()` / `runtimeContext(subject)`）。service layer が既定で `cwd`（order 10）と `time`（order 30、10 分バケット）を登録し、`@fudo/safety` が `approval`（order 20）と `sandbox`（order 21）を登録する（safety 行は `requires: [SystemPrompt]` になった）。agent loop は各 step の前に snapshot を描画し、ログの最新の `user/message{source:'runtime-context'}` と違うときだけ append する。記録順は `system/message` → snapshot → 入力で、restart/resume では既存 snapshot と比較するので繰り返さない。
  - 検証: `packages/core/system-prompt/tests/runtime-context.test.ts`（順序・空の除外・duplicate-context・scope 解除・cwd/time の既定）、`packages/core/session/tests/runtime-context.test.ts`（最新 snapshot の読み戻し）、`apps/cli/tests/runtime-context-e2e.test.ts`（実 CLI 経路。2 turn で snapshot は 2 件、working_directory の変更で 1 件増え、変化の無い turn では増えない。ログ順と `deriveMessages` の順序も確認）。
  - 決定: 時刻は UTC の ISO instant を 10 分ごとのバケットで出す（dsh の turn/step 入り文面とローカル TZ 表示までは写していない）。更新間隔の config 化は未決。
  - 影響: `@fudo/safety` を単独で使う profile は system-prompt 行を欠くと起動に失敗する（同梱 profile は満たす）。
- [x] **A3 AGENTS.md の探索と予算**。fudo は AGENTS.md を cwd から根へ一度読むだけ（`fudo:packages/core/system-prompt/src/agents-md.ts:25`）。dsh は CLAUDE.md と `.local` 変種、dshHome/agentsHome、`.git` を起点にした探索、64 KiB の描画予算と打ち切り通知、内容ハッシュでの重複排除、read/write/edit が触ったファイルに応じた入れ子ファイルの再読込を持つ（`dsh:packages/context/agent-instructions/src/config.ts:12`、`render.ts:292`）。受け入れ: 入れ子の `packages/foo/AGENTS.md` がモデルに届き、巨大なファイルは予算内で切り詰められ、その事実が通知される。
  - 実装（2026-10-14）: `loadAgentsFiles(cwd, options)` を書き直した。探索は `.git` を持つプロジェクト根（無ければ FS 根）から cwd までで、根を超えて上へは読まない。`names`（既定 AGENTS.md）、`home`（`agentsHome`、既定 `~/.fudo`）を持つ。内容の trim 一致で重複排除し、1 MiB 超は読まずに omitted に名前を残す。`agentsMdSections` は 64 KiB 予算で、収まる分は丸ごと、最初に収まらないファイルは文字境界で切り、以降は omitted にして、その事実を `agents-md:budget` section（order 900-1）でモデルに通知する。`nestedAgentsFiles` が read/write/edit の触ったパスから根までを浅い順に調べ、未読込のファイルを `user/message{source:'inject'}` として注入する（CLI の `installNestedAgentsMd`、tools/post-execute listener）。
  - 検証: `packages/core/system-prompt/tests/agents-md.test.ts`（根の境界・home 先行・重複排除・source 上限・予算の切り詰めと notice・入れ子探索）、`packages/core/agent-loop/tests/loop.test.ts`（ツール実行中に積んだ inject が次の step の request 前に user/message として入る）、`apps/cli/tests/agents-md-e2e.test.ts`（実 CLI 経路で、入れ子ファイルが 2 番目の request に届く・1 番目には届かない、巨大ファイルは notice つきで 65536 B 以下に切られ末尾マーカーが届かない、home が workspace より先に出る）、`bun run check` 509 pass / 0 fail。
  - 学び: 実装前の仮説「注入は既存の inject 経路で届く」は外れた。runner の step ループは `loop([])` と空入力を渡しており、turn 途中の steer / inject を一度も claim していなかった（pending のまま次の turn まで残り、その間の step は入力なしで空振りする）。カーネル設計の「steer が届いていれば次の step へ」に合わせ、step 境界で `inbox.claim(false)` するよう直した。system/message を turn 先頭だけに記録する `opening` フラグも同時に導入した。
  - 未確認: `~/.fudo/AGENTS.md` の配線は `runCommand` に `agentsHome` を渡す e2e で確認したが、`main()`（bin.ts が実ホームを渡す経路）では未実走。dsh の `CLAUDE.md` / `.local` 変種は既定では読まない（`names` で追加できるが CLI からは未露出）。
- [x] **A4 skill**。fudo は名前の正規表現だけで SKILL.md を読み、同梱 profile は roots を渡さないので既定で無効（`fudo:packages/core/tools-tier1/src/skill.ts:23`、`plugin.ts:22`）。dsh は fronts 5系統の roots、frontmatter の検証、`<available_skills>` カタログの durable 配布と更新、オンデマンド読み込み、ユーザー起動を持つ（`dsh:packages/skill/skill-filesystem/src/index.ts:244`、`dsh:packages/skill/tool-skill/src/index.ts:256`）。受け入れ: モデルが skill の存在を一覧で知り、該当するものを読める。
  - 実装（2026-10-14）: `@fudo/tools-tier1` に `skills.ts` を足した。`parseSkillDocument` は YAML frontmatter の `name` と `description` を必須にし、`name` は安全な正規表現だけを通す（検証に通らないファイルは「skill ではない」ので、後段は再検査しない）。`discoverSkills` は root 順に走査し、同じ名前は先の root が勝ち、欠けた root や壊れたファイルは黙って落とす。`renderSkillCatalog` が `<available_skills>` の一覧文を組む。探索先は `skillRoots` が workspace `<cwd>/.fudo/skills` → 設定 `skills`（`~` を展開）→ fudo home `<home>/skills` の順に組む（既定で有効になり、同梱 profile に roots が無くても効く）。`skill` tool は roots を受け取り、呼び出しのたびに発見し直して一致する本文（frontmatter を除く）を返すので、一覧と tool がずれない。カタログは source `skill-catalog` の user/message としてログに残り、`agent/pre-step` が「ログの最新と違うときだけ」そのターンの入力の先頭に差し込む。turn ごとに再発見するので、実行中に足した skill は次のターンに届く。
  - session 側: `USER_MESSAGE_SOURCES` を唯一の出所にし、session の schema と agent の inbox schema が `Schema.Literals` をそこから導出する。`lastSkillCatalog` は `lastMessageFrom(events, source)` の薄い包み。
  - 検証: `packages/core/tools-tier1/tests/skills.test.ts`（frontmatter 必須・引用符・root 優先・重複排除・一覧文の1行化と上限）、`skill.test.ts`（本文を返す・検証に落ちたファイルは読めない・不明な名前は候補を列挙）、`packages/core/session/tests/skill-catalog.test.ts`（source のデコードと最新カタログの読み戻し）、`packages/core/agent-loop/tests/loop.test.ts`（pre-step の `enter(messages)` が claim 済み入力の前に並ぶ）、`apps/cli/tests/skill-catalog-e2e.test.ts` 3 本（workspace と home の全 root が一覧に出て tool が本文を返す・カタログは1回だけ durable・実行中に足した skill が次のターンに届く・skill が無ければ何も配らない）、`bun run check` 530 pass / 0 fail。
  - 学び: (1) turn-stopping で `inject` すると `whenIdle` が返らない。inbox に pending が残るのに runner は wake 待ちで、次の turn が来ないため。カーネル設計が持っていた `agent/pre-step` の `enter(messages)` が実装に無かったので、そこを実装して配布経路を切り替えた。(2) tool が生ファイルを返すと frontmatter がモデルに届く。カタログがメタデータ、tool が本文、という分担に合わせた。(3) user/message の source 一覧が 3 箇所に写されており、source を足したときに agent の inbox schema だけ古いまま残って実行時に落ちた。1 つの const から導出に変えた。
  - 未確認: dsh の user-invocation（利用者起動）と disable-model-invocation 相当は未実装。探索名は AGENTS.md と同じく `SKILL.md` のみで、バンドル skill は持たない。子 agent も同じ探索先から自分のカタログを配る実装だが、subagent 経路での実走は未確認。
- [ ] **A5 compaction**。fudo は reasoning を落とし 32 KB 超の text を 120 文字のスタブに置き換えるだけの機械的処理で、常時適用され、ログに何も残らない（`fudo:packages/core/session/src/compaction.ts:18`、`runner.ts:169`）。dsh は閾値で発火し（context の 0.8、headroom 65,536、retention 0.16、モデル別 override）、補助 LLM の構造化要約を checkpoint メッセージとしてログに残し、開始/終了マーカーと隠れた seq 範囲を記録する（`dsh:packages/compaction/compaction-basic/src/config.ts:20`、`summarizer.ts:31`）。受け入れ: ログだけから実際に送った内容を再構成できる。
- [ ] **A6 spill**。fudo は 32 KB 超を `tmpdir()/fudo-spill/<callId>.txt` へ書き、後始末をせず、read の結果も対象になる（`fudo:packages/core/tools/src/spill.ts:66`、`runner.ts:50`）。dsh はトークン予算で判定し、回収手順つきの locator を返し、read は対象外にし、0700 の管理領域に置いて掃除する（`dsh:packages/spill/spill-policy/src/index.ts:108`）。受け入れ: 退避された本文にモデルが自力で戻れる。
- [ ] **A7 projection seam**。fudo は未知のイベント型を無言で捨て（`default: []`）、実運用で projection を1本も登録していない（`fudo:packages/core/session/src/derive.ts:29`、`runner.ts:169`）。dsh は投影の無いイベント型で読み込みを失敗させる（`dsh:packages/core/session/src/surface.ts:516`）。受け入れ: プラグインが足したイベントが黙って消えず、実際に使う projection が1本以上ある。
- [ ] **A8 request/header の忠実性**。fudo は provider/model/params だけを毎 step 無条件に書く（`fudo:packages/core/session/src/events.ts:56`）。dsh は組み立て済みのツール schema、reason と series、ツール差分の developer メッセージ、request/context を記録し、同値なら書かず、任意の prefix をログから再構成できる（`dsh:packages/core/session/src/types.ts:234`）。受け入れ: あるリクエストにどのツール schema が渡ったかをログから復元できる。

## B. ツール実行面

- [ ] **B1 ツール説明とパラメータ説明**。fudo は全ツールでパラメータ説明がゼロ、説明は1文（read 87 B 対 dsh 419 B＋141 B、bash 84 B 対 923 B＋191 B）。受け入れ: 各ツールの用途・使い分け・引数の意味がモデルに届く。
- [ ] **B2 read**。fudo は 2000 行の既定だけで、打ち切りを EOF と区別できず、行長・バイトの上限もない（`fudo:packages/core/tools-tier0/src/read.ts:43`）。dsh は行長とバイトの上限、打ち切りフッターと offset 案内、EOF 越えのエラー、非 UTF-8 の拒否を持つ（`dsh:packages/fs/tool-fs/src/read-render.ts:11`）。受け入れ: モデルが「まだ続きがある」と分かる。
- [ ] **B3 write / edit**。fudo は未読ファイルを黙って上書きし、陳腐化も CRLF もバイナリも見ない（`fudo:packages/core/tools-tier0/src/write.ts:44`、`edit.ts:51`）。dsh は未読・陳腐化を拒否して読み直しを促し、CRLF を正規化し、失敗時はファイルを変えない（`dsh:packages/fs/fs-observation-policy/src/index.ts:65`）。受け入れ: 外部変更を踏み潰さない。
- [ ] **B4 glob / grep**。fudo は Bun.Glob と JS 正規表現で、ignore もバイナリ除外も並び順もなく、超過分は捨てる（`fudo:packages/core/tools-tier0/src/glob.ts:30`、`grep.ts:83`）。dsh は ripgrep 相当で、ignore 尊重・バイナリ除外・上限超過分の退避 locator を持つ（`dsh:packages/fs/tool-fs-search/src/grep.ts:113`）。受け入れ: node_modules とバイナリを掘らず、結果の全量に手が届く。
- [ ] **B5 bash**。fudo は timeout が一切なく、exit code はエラー文字列に埋まり、打ち切り先も告げない（`fudo:packages/core/tools-tier0/src/bash.ts:42`）。dsh は既定120秒/最大600秒、`[exit code: N]` マーカー、退避先つきの打ち切り通知、背景実行を持つ（`dsh:packages/shell/tool-bash/src/render.ts:11`）。受け入れ: ハングせず、失敗が失敗として読める。
- [ ] **B6 欠けているツール**。pwsh、`job_list`、subagent 制御（send_message / interrupt_agent / list_agents / wait_agent）、subagent_fork、list_subagent_models、exit_plan_mode、present、lsp、workflow、MCP resources、session query 5種、schedule 4種、terminal 6種、computer/browser use、plugin_manager、str_replace_editor、ralph、create_worktree、team_*。

## C. 自律性・委譲

- [ ] **C1 goal**。fudo の `goal` は引数をログに返すだけ（`fudo:packages/core/tools-tier1/src/goal.ts:17`）。dsh は目標を durable に畳み、継続ラウンドでプロンプトを注入し、blocked を N ラウンド未満では拒否する（`dsh:packages/goal/goal-round-driver/src/index.ts:166`）。受け入れ: 目標がセッションをまたいで持続し、自動で次のラウンドが走る。
- [ ] **C2 schedule**。dsh は create/list/update/delete と cron/daily/weekly/every を持ち、期限到達で `followup` する（`dsh:packages/schedule/tool-schedule/src/index.ts:446`）。fudo に時間の概念はない。
- [ ] **C3 workflow / PTC**。dsh はスクリプトで子エージェントを扇状に走らせ、schema で結果を検証し、失敗項目を null に落とす（`dsh:packages/workflow/tool-workflow/src/index.ts:161`）。fudo は1 step 内の並列ツール呼び出しだけ（`fudo:packages/core/agent-loop/src/batch.ts:1`）。
- [ ] **C4 guards**。fudo は monotonic guard の seam を持つが production に1本も登録していない（`fudo:packages/core/tools/src/pipeline.ts:96`）。dsh は繰り返し呼び出しの検出（閾値 3/5/8）と宣言 timeout の強制を持つ（`dsh:packages/guard/repeat-tool-reminder/src/index.ts:36`）。
- [ ] **C5 commands**。dsh はモデルの turn を消費しないコマンドレジストリを持ち、`command/run`・`command/done` として記録する（`dsh:packages/interaction/commands/src/index.ts:61`）。fudo は CLI のサブコマンドのみ。
- [ ] **C6 preset**。dsh はセッション単位で構成（ツール世界）を選び、最初の turn の前に固定する（`dsh:packages/preset/agent-preset-registry/src/index.ts:341`）。fudo の「preset」は権限レベルの別名で、構成はプロセス全体で1つ。
- [ ] **C7 extensions**。dsh のモデルは承認下で自分のプラグインを入れ替えられる（`dsh:packages/boot/plugin-manager/src/tools.ts:20`）。fudo の構成は起動時に凍結される。
- [ ] **C8 agent teams**。dsh は roster・task board・inbox を持つ（`dsh:packages/experimental/tool-agent-team/src/index.ts:175`）。
- [ ] **C9 subagent の seam**。fudo は route を構築時に固定した fire-and-forget の子を1つ作るだけ（`fudo:packages/core/tools-tier1/src/subagent.ts:56`）。dsh は provider を差し替えられ（fresh / fork / 他製品への委譲）、継続可能な子を選べる（`dsh:packages/subagent/tool-subagent-control/src/index.ts:29`）。

## D. 安全・耐久

- [ ] **D1 承認の fail-closed 化**。fudo は answerer が無いと `Deferred.await` で永久に待つ（`fudo:packages/core/safety/src/approval.ts:29`。CLI は `denyApproval` を配線しているので同梱経路は拒否になる）。dsh は不在も例外も `unavailable` → 拒否に正規化し、1回限りの escalation を持つ（`dsh:packages/interaction/user-approval/src/index.ts:285`）。受け入れ: seam の既定が「拒否」であり、「停止」ではない。
- [ ] **D2 sandbox の既定**。fudo は `config.sandbox ?? 'none'` で、同梱 profile は sandbox キーを書かないため既定は無制限（`fudo:packages/core/safety/src/plugin.ts:21`、`packages/bundle/base/profiles/base.yml`）。dsh は backend 不在なら `SANDBOX_UNAVAILABLE` で実行しない（`dsh:packages/sandbox/sandbox/src/index.ts:125`）。受け入れ: 既定で制限が効くか、少なくとも制限なしが明示選択になる。fudo の seatbelt 実装自体は dsh より強いので、有効化を既定にする道が近い。
- [ ] **D3 fs seam と封じ込め**。fudo はツールが `node:fs` を直呼びし、封じ込めは `relative()` の字句比較（`fudo:packages/core/tools-tier0/src/write.ts:18`）。dsh は書き込みを1つの seam に通し、canonical な同一性検査で symlink を弾く（`dsh:packages/fs/fs-sandbox/src/index.ts:122`）。受け入れ: 書き込み経路が1本で、symlink で抜けられない。
- [ ] **D4 session の耐久性**。fudo は `formatVersion=1` 以外を読み込み拒否し、切れた末尾の修復・圧縮・lease・export・検索がない（`fudo:packages/core/session-jsonl/src/index.ts:67`）。dsh は v0→v4 の migration、修復、zstd、flock、ZIP export、FTS 検索を持つ（`dsh:packages/session/session-format-v0-to-v1`、`dsh:packages/session-query/session-query/src/index.ts:153`）。受け入れ: 古いログを捨てずに読める。
- [ ] **D5 settings / credentials / identity / telemetry**。fudo は config.yaml と secrets.env のみ（`fudo:apps/cli/src/config.ts:16`）。dsh は設定の seam、資格情報の優先順位、匿名 id、mount するまで送らない OTLP を持つ。

## E. UI・提示・検証

- [ ] **E1 presentation の実配線**。fudo の `presentCall`/`presentResult` はテストからしか呼ばれず、TUI と Web は 200 文字で切った素のテキストを出す（`fudo:packages/core/tools/src/types.ts:107`、`fudo:packages/ui/view/src/conversation.ts:62`）。dsh は presenters・ノードレジストリ・locale 所有の文言でカード/差分を描く（`dsh:packages/client/ui-conversation/src/client/contract/conversation.ts:203`）。
- [ ] **E2 画面**。セッション一覧とブラウズ、設定ページ、デスクトップ、SDK/ACP。fudo の `list()` は CLI/TUI/Web から一度も呼ばれていない（`fudo:packages/core/session/src/sessions.ts:83`）。
- [ ] **E3 検証機構**。fudo の記録 fixture は SSE 1 本、coverage 閾値・doc gate・重複 gate・i18n・real-API lane は無い（`fudo:packages/test-support/replay/src/index.ts:9`、`package.json:13`）。dsh は 227 シナリオをキー無しで出荷構成のまま再生し、ファイル単位 100% coverage を gate する（`dsh:vitest.snapshot.config.ts:32`、`dsh:vitest.config.ts:381`）。受け入れ: 退行が記録の再生で捕まる。

## 未確認

- dsh の TUI はこのチェックアウトに無い。外部に別途あるかは未確認。
- dsh の入れ子 sandbox の検出と再実行は確認できなかった。
- fudo の `bun run check` は監査時に実行していない。
- テスト数は文書の記載（418 ケース / 130 ファイル）と grep（466 / 135）がずれている。
- 設計文書が意図的に外した項目（Cordis、HMR、Desktop/SDK/ACP、二言語ドキュメント、telemetry、credentials サービス、plugin-manager、typert、session migration）は、着手前に設計文書の更新を伴う。
