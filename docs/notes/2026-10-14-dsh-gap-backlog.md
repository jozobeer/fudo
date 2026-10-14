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
- [x] **A5 compaction**。fudo は reasoning を落とし 32 KB 超の text を 120 文字のスタブに置き換えるだけの機械的処理で、常時適用され、ログに何も残らない（`fudo:packages/core/session/src/compaction.ts:18`、`runner.ts:169`）。dsh は閾値で発火し（context の 0.8、headroom 65,536、retention 0.16、モデル別 override）、補助 LLM の構造化要約を checkpoint メッセージとしてログに残し、開始/終了マーカーと隠れた seq 範囲を記録する（`dsh:packages/compaction/compaction-basic/src/config.ts:20`、`summarizer.ts:31`）。受け入れ: ログだけから実際に送った内容を再構成できる。
  - 実装（2026-10-14）: 刈った事実をログに残し、送る内容とログを同じものにした。
    - session に `compaction/prune` イベントを足した（`shadowedSeqs` / `shadowedRange` / `shadowedBytes` / `replacements` = seq ごとの置換 content）。schemas にも登録し JSONL から復号できる。
    - `deriveMessages` は記録済みの prune を畳み込みに適用する（`deriveMessagesWithSeqs` が seq を保つ）。runner は送信直前に `compactMessages` を当てるのをやめ、`pruneFor` の決定を先にログへ記録してから `deriveMessages` の結果を送る。これで「送った内容 = ログから導ける内容」が構造的に一致する。
    - `pruneFor` は純関数。retention（既定 12）の外で `maxBytes`（既定 32000）を超える text block をスタブに置き換える決定を返す。reasoning の削除も記録対象。`system/message` はプロンプトの枠なので刈らない。記録済みの seq は二度刈らない（冪等）。
    - `compactMessages` は本番の消費者が消えたので削除した。
    - 閾値は profile の `@fudo/agent-loop` 行の config（`keepLast` / `maxBytes`）で変えられる（runner の `DEFAULT_*` 定数埋め込みをやめた）。
  - 検証: 単体 `packages/core/session/tests/compaction.test.ts`（短い履歴では何もしない／shadowedSeqs・range・価格／置換が頭と価格を保つ／reasoning 削除も記録／system/message は刈らない／derive が置換を適用／二度刈らない／置換以外は不変／JSONL 復号と不正データの拒否）と、e2e `apps/cli/tests/compaction-e2e.test.ts`（7 turn の後で `deriveMessages(opened.events)` の先頭 N 件がそのターンに実際に送った `request.messages` と完全一致＝受け入れ条件そのもの。prune イベントがログにある。profile 行の `keepLast/maxBytes` で刈られる）。`bun run check` 538 pass / 0 fail。
  - 学び: (1) 置換後 content を記録する設計では、スタブ自体が `maxBytes` を超えると二度刈りになる。RED テストが露見させ、記録済み seq を外す規則で冪等にした。(2) 既存実装は `system/message` も刈り得た（巨大な AGENTS.md があると system prompt がスタブに化ける）。枠は履歴ではないので対象外にした。(3) 復元性は unit では部分的にしか見えない。e2e で「送った配列 == ログから導いた配列」を完全一致で比較して初めて証明になる。
  - 未確認: dsh の文脈比トリガ（context の 0.8、headroom 65,536、retention 0.16、モデル別 override）と補助 LLM による構造化要約は未実装（fudo はバイト単価で発火し、要約は機械的スタブのまま）。`compaction/start` / `compaction/end` のようなライフサイクルマーカーは持たず、prune 1 種のみ。手動 compaction のコマンドも無い。
- [x] **A6 spill**。fudo は 32 KB 超を `tmpdir()/fudo-spill/<callId>.txt` へ書き、後始末をせず、read の結果も対象になる（`fudo:packages/core/tools/src/spill.ts:66`、`runner.ts:50`）。dsh はトークン予算で判定し、回収手順つきの locator を返し、read は対象外にし、0700 の管理領域に置いて掃除する（`dsh:packages/spill/spill-policy/src/index.ts:108`）。受け入れ: 退避された本文にモデルが自力で戻れる。
  - 実装（2026-10-14）:
    - `applySpill(result, {callId, tool}, options)` に変えた。`read` の結果は退避しない（読み直しが戻り道なので、隠すと戻れなくなる）。書き込みに失敗したら元の content をそのまま残す（fail-open。退避できないことで turn を落とさない）。
    - 注記に戻り道を書いた: `[spilled to <path>: N lines, M bytes. Use the read tool with offset and limit to page through it.]` の後ろに先頭プレビュー。
    - 管理領域を `@fudo/tools` の `spill-store.ts` に置いた。`<root>/<sessionId>/<callId>.txt`、ディレクトリは 0700。session ディレクトリを初めて作るときに 7 日より古い session ディレクトリを掃除する（`pruneSpills`。root 直下のファイルは session ではないので残す）。
    - runner は `<fudoHome>/spill` を使う（CLI が `AgentOptions.spillDir` を渡す。無ければ `tmpdir()/fudo-spill`）。
  - 検証: 単体 `packages/core/tools/tests/spill.test.ts`（read は退避しない／注記がパス・行数・バイト数と read/offset を含む／失敗する writer でも内容が残る）と `spill-store.test.ts`（パスと内容／0700／新 session を開くと古い session が消える／root 直下のファイルは残る／root が無くても壊れない）。e2e `apps/cli/tests/spill-recovery-e2e.test.ts`: 40 KB の bash 出力が退避され、注記のパスをモデル役の stub が `read` で読み戻して末尾マーカーを得る（＝受け入れ条件）。`<fudoHome>/spill/<sessionId>/` にファイルは 1 つ、ディレクトリは 0700、大きい `read` の結果は退避されず inline。既存の spill-e2e / spill-threshold-e2e も通る。`bun run check` 547 pass / 0 fail。
  - 学び: (1) 「戻り道を隠さない」は型では表せず、policy の除外規則でしか守れない。read の結果を退避すると、退避先を読む唯一の手段が退避対象になる。(2) 退避の適用点が pipeline と runner の 2 箇所あり、pipeline 側は spill オプションが常に空で死んでいた。次のコミットで外す。
  - 未確認: dsh のトークン予算ではなくバイト単価のまま（`maxSpillBytes`）。画像ブロックの退避、head+tail の保持、通知の省略数表記は写していない。掃除はセッションを開いたときだけで、走行中の容量上限は無い。
- [x] **A7 projection seam**。fudo は未知のイベント型を無言で捨て（`default: []`）、実運用で projection を1本も登録していない（`fudo:packages/core/session/src/derive.ts:29`、`runner.ts:169`）。dsh は投影の無いイベント型で読み込みを失敗させる（`dsh:packages/core/session/src/surface.ts:516`）。受け入れ: プラグインが足したイベントが黙って消えず、実際に使う projection が1本以上ある。
  - 実装（2026-10-14）:
    - `@fudo/session` に projection registry を置いた。`MessageProjection` はイベント型を1つ所有し（`type`）、畳み込みの途中で `(event, derived) => derived` として呼ばれる。登録は module load 時（`registerMessageProjection` / `registerLogOnlySessionEvents`）で、schemas の登録と同じ流儀。
    - `deriveMessagesWithSeqs` の判定は ①登録済み projection がある型 → projection に委譲、② core の message 4 種（system/user/assistant/tool result）→ そのまま畳む、③ log-only と宣言された型 → 何も出さない、④ どれでもない型 → `SessionError{code:'projection'}` を投げる。黙って消える経路を塞いだ。
    - core の log-only は `schemas.ts` で宣言（session/header, session/cwd/changed, turn/start・end, step/start・end, request/header, assistant/attempt, tool/call）。agent（inbox 2 種）と safety（approval 2 種、ask 2 種）も自分の events モジュールで宣言する。
    - 実際に使う projection: A5 で derive に直書きしていた prune の適用を `pruneProjection`（type `compaction/prune`）に移し、registry 経由で畳み込む。
  - 検証: `packages/core/session/tests/projections.test.ts`（未投影・未宣言の型で throw し、メッセージに型名が出る／log-only 宣言した型は throw しない／登録した projection が history を作る／同じ型を二度登録すると throw／compaction/prune が実際に使われる projection であること）と `derive.test.ts` の追加 projection 契約。既存の `compaction.test.ts` と A5 の e2e（送った配列 == ログからの derive）は projection 経由でそのまま通る。`bun run check` 552 pass / 0 fail。
  - 学び: projection の契約は「自分のイベントを丸ごと所有する」。既定の畳み込みは走らないので、projection は自分でメッセージを足す。この曖昧さはテストを書いている途中で露見した（既定の畳み込みの後に呼ばれる想定でテストを書いて落ちた）。
  - 未確認: profile からプラグインを外して再開した場合、そのプラグインのイベント型は codec の未知型拒否（S1）で先に止まる。derive の throw が e2e に出る経路は作っていない（unit のみ）。dsh の生成カタログに相当する全型一覧の機械生成は持たず、宣言は各パッケージの module load に置く。
- [x] **A8 request/header の忠実性**。fudo は provider/model/params だけを毎 step 無条件に書く（`fudo:packages/core/session/src/events.ts:56`）。dsh は組み立て済みのツール schema、reason と series、ツール差分の developer メッセージ、request/context を記録し、同値なら書かず、任意の prefix をログから再構成できる（`dsh:packages/core/session/src/types.ts:234`）。受け入れ: あるリクエストにどのツール schema が渡ったかをログから復元できる。
  - 実装（2026-10-14）:
    - `request/header` を毎 step 無条件から request series ごとに変えた。route・params・tool schema のどれかが前回と違うときだけ書き、`series`（1 起算）と `reason`（`opened` / `changed`）を記録する。すべて同じなら書かない（設計の「request series ごとに 1 件」に合わせた）。
    - header に組み立て済みの `tools: ToolSchema[]` を入れた。これで「ある request にどの tool schema が渡ったか」をログだけから復元できる。
    - `lastRequestHeader(events)` を session に足し、runner はログの最新 header と比較する（A5 と同じ「ログが唯一の記憶」）。
    - 設計文書を更新: kernel 設計の `request/header` 行に tools/series/reason と同値スキップを明記し、「dsh から外すもの」の `request/context` 行へ「組み立て済み tool schema の記録はこれに含めない（キャッシュ差分ではなく再構成のため）」と追記した。
  - 検証: 単体 `packages/core/session/tests/request-header.test.ts`（最新 header の読み戻し、tools/series の JSONL 復号、tools 欠落の拒否）と `packages/core/agent-loop/tests/loop.test.ts`（tools が変わると series 2・reason `changed`、変わらなければ 2 turn でも header は 1 件）。e2e `apps/cli/tests/request-header-e2e.test.ts`（2 turn で header 1 件、その `tools` が provider に渡った tools と JSON 一致、名前は tier0 の 6 種、ログの最新 header だけから復元できる）。`bun run check` 559 pass / 0 fail。
  - 学び: 「毎 step 書く」は設計（series ごとに 1 件）と食い違っていた。変更検知を入れると header が「その request の組立内容」を指す唯一の場所になり、A5 の「送った内容 = ログ」と同じ原則に揃う。
  - 未確認: dsh の「ツール差分の developer メッセージ」と `request/context`（メッセージ列そのものの記録）は未実装。fudo ではメッセージ列はイベント列そのもの（derive）なので別途持つ必要が無い、という判断。series は system prompt の変化では切れない（fudo は turn ごとに system/message を記録するため）。

## B. ツール実行面

- [x] **B1 ツール説明とパラメータ説明**。fudo は全ツールでパラメータ説明がゼロ、説明は1文（read 87 B 対 dsh 419 B＋141 B、bash 84 B 対 923 B＋191 B）。受け入れ: 各ツールの用途・使い分け・引数の意味がモデルに届く。
  - 実装（2026-10-14）: 同梱ツール 16 種（tier0 の 6、tier1 の todo_write / goal / ask_user / web_fetch / read_image / skill / job_start / job_output / job_kill / working_directory、テストが足す web_search と subagent）の説明を、用途と使い分けが読める文に書き直し、全パラメータに説明を付けた。Effect Schema の `annotate({ description })` を使い、`Schema.toJsonSchemaDocument` が JSON Schema の `description` として出す（値レベルの注釈だけを使う。キー注釈は `allOf` を作るので使わない）。
  - 機構: `@fudo/tools` に `toolSchemaIssues(declaration)` を足した。説明が 40 文字未満、または description の無いパラメータがあれば指摘を返す。`toolDeclaration(tool)` を公開したので、単体テストもモデルが実際に受け取った宣言も同じ規則で検査できる。
  - 検証: `packages/core/tools-tier0/tests/schema.test.ts` と `packages/core/tools-tier1/tests/schema.test.ts`（全ツールで issues が空）、e2e `apps/cli/tests/tool-schema-e2e.test.ts`（実 CLI で provider が受け取った 16 ツールの宣言が issues 空で、名前の一覧も固定）。`bun run check` 562 pass / 0 fail。
  - 学び: 説明を書くのは一度きりの作業なので、`toolSchemaIssues` という検査に落とした。以後ツールを足したときにパラメータ説明を忘れるとテストが落ちる（指示ではなく機構）。
  - 未確認: dsh の 419 B / 923 B という量は写していない（文面の濃さは測っていない）。`parameters` の JSON Schema は `additionalProperties: true` のまま（説明の付与とは別件）。MCP 由来のツールはサーバーの説明をそのまま通すので、説明が無いサーバーでは付かない。
- [x] **B2 read**。fudo は 2000 行の既定だけで、打ち切りを EOF と区別できず、行長・バイトの上限もない（`fudo:packages/core/tools-tier0/src/read.ts:43`）。dsh は行長とバイトの上限、打ち切りフッターと offset 案内、EOF 越えのエラー、非 UTF-8 の拒否を持つ（`dsh:packages/fs/tool-fs/src/read-render.ts:11`）。受け入れ: モデルが「まだ続きがある」と分かる。
  - 実装（2026-10-14）: read の結果に footer を付けた。全部読んだら `(End of file - total N lines)`、limit で切れたら `(Showing lines F-T of N. Continue with offset=T+1.)`、バイト上限で切れたら `(Output capped. Showing lines F-T. Continue with offset=T+1.)`。行長上限 2000 文字（超えた行は切り、`... (line truncated to 2000 chars)` を付ける）とバイト上限 50 KiB（`READ_MAX_BYTES`）を持ち、上限に当たっても総行数は数え切るので続きの offset が正確に出る。offset が EOF を越えていれば `invalid-arguments`（`offset N is past the end of <path> (M lines)`）、offset/limit が 1 未満も拒否、空ファイルは 0 行として正常に返す。非 UTF-8 は `TextDecoder('utf-8', { fatal: true })` で拒否する（置換文字でモデルに届けない）。A1 の prompt guidance も「footer が続きの有無を言う」に更新した。
  - 検証: `packages/core/tools-tier0/tests/read.test.ts` の 8 本（numbered と EOF footer／途中の footer と offset 案内／長い行の切り詰めと明示／EOF 越えエラー／空ファイル／非 UTF-8 拒否／バイト上限と Output capped／存在しないファイル）。`bun run check` 567 pass / 0 fail。
  - 学び: 「打ち切り」は 2 種類ある（limit に達した／バイト上限に達した）。1 つの真偽値では footer を書き分けられず、テストが露見させたので `capped` を別に持たせた。
  - 未確認: dsh の `<path><type><content>` エンベロープは写していない（fudo の結果は素のテキスト）。行番号の区切りは fudo の tab のまま。
- [x] **B3 write / edit**。fudo は未読ファイルを黙って上書きし、陳腐化も CRLF もバイナリも見ない（`fudo:packages/core/tools-tier0/src/write.ts:44`、`edit.ts:51`）。dsh は未読・陳腐化を拒否して読み直しを促し、CRLF を正規化し、失敗時はファイルを変えない（`dsh:packages/fs/fs-observation-policy/src/index.ts:65`）。受け入れ: 外部変更を踏み潰さない。
  - 実装（2026-10-14）:
    - `@fudo/tools-tier0` に `observed-files.ts` を足した。session ごとに「最後に見たときのバイト数と mtime」を覚え、`guardWrite` / `guardEdit` が現在の stat と突き合わせる。write は、存在するファイルなら「このセッションで読んでいて、かつ変わっていない」ときだけ上書きを許す（新規作成は自由）。edit は「読んでいて、変わっていない」を必須にし、未読は `read <path> before you edit it`、不在は `cannot edit <path>: it is not there`、変化は `<path> changed on disk since you read it; read it again before you write` で拒否する。拒否は書き込みの前に起きるので、失敗した edit はファイルを変えない。
    - read は成功時に観測を記録し、write/edit は成功時に自分の書き込みを観測として記録し直す（直後の編集に読み直しを要求しない）。
    - CRLF は `normalizeNewlines` で LF に正規化する（write は書き込む内容、edit は突き合わせと書き戻しの両方）。非 UTF-8 は `readUtf8` が拒否するので、edit は binary に到達できない。
    - read / write / edit は `makeReadTool(observed)` などのファクトリになり、`tier0Tools(sandbox, observed = makeObservedFiles())` が層ごとに 1 つの観測を持つ（アプリ内の全ツールで共有）。
  - 検証: `write.test.ts` 6 本（新規作成／workspace 外の拒否／未読の上書き拒否とファイル不変／読後の上書き成功／読後に外部変更 → 拒否とファイル不変／CRLF → LF）と `edit.test.ts` 6 本（一意置換／不一致・曖昧の拒否とファイル不変／全置換／未読の拒否／外部変更の拒否／非 UTF-8 は read が拒否し edit も未読として拒否・バイト列不変）、e2e `apps/cli/tests/write-guard-e2e.test.ts` 2 本（実 CLI 経路で read → write が同じ観測を共有して成功し、未読の write は拒否してファイルが変わらない）。`bun run check` 576 pass / 0 fail。
  - 学び: 「失敗してもファイルを変えない」は、拒否判定を書き込みの前段に置くことで初めて成立する。non-UTF-8 の edit がテストで露見させたのは順序の話で、guard が読了を要求するため binary は read の時点で止まる（拒否の理由が 2 段になる）。
  - 未確認: 観測の状態は sessionId ごとの Map で、agent の dispose では解放しない（プロセス内のセッション数ぶん残る）。書き込みの原子性（一時ファイル + rename）は持たず、Bun.write の 1 回書きのまま。dsh の createIfAbsent / replaceIfVersion の CAS は、fudo では stat 比較 + 単一プロセス前提で代替している。
- [x] **B4 glob / grep**。fudo は Bun.Glob と JS 正規表現で、ignore もバイナリ除外も並び順もなく、超過分は捨てる（`fudo:packages/core/tools-tier0/src/glob.ts:30`、`grep.ts:83`）。dsh は ripgrep 相当で、ignore 尊重・バイナリ除外・上限超過分の退避 locator を持つ（`dsh:packages/fs/tool-fs-search/src/grep.ts:113`）。受け入れ: node_modules とバイナリを掘らず、結果の全量に手が届く。
  - 実装（2026-10-14）:
    - 自前の walker `packages/core/tools-tier0/src/walk.ts` を足した。`node_modules` と `.git` は発見した時点で枝を切る（中を辿らない）、`.` 始まりのエントリは辿らない、workspace 直下の `.gitignore` と `.ignore` を適用する。規則は gitignore の部分集合: `#` コメント、`!` 否定（最後に一致した規則が勝つ）、末尾 `/` はディレクトリのみ、先頭 `/` と途中に `/` を含む規則は root 相対、`**/` は任意深さ、`*` は `/` を跨がず `**` は跨ぐ。
    - glob は walker が集めたファイルに `Bun.Glob#match` を当て、`limit`（既定 20000）で打ち切る。grep は同じ walker を使い、バイナリ（先頭 8 KiB に NUL があるバイト列）と UTF-8 として復号できないファイルを飛ばし、既定 20000 件で打ち切る。どちらも打ち切り時は render に `... (stopped at N ...; narrow the pattern to see the rest)` を出す。
    - 上限を「1 メッセージに載る量」より十分大きくしたので、大きい結果はツールで切られるのではなく A6 の spill に落ちる。spill ファイルを read で辿れば全量に手が届く。
  - 検証: `walk.test.ts` 7 本（node_modules・.git・隠しを辿らない／.gitignore と .ignore の適用と最後の規則が勝つ／nested pattern のアンカー／limit で止まる／NUL 判定／ディレクトリ規則は同名ファイルに効かない／ignore ファイルが無ければ規則も無い）と `search.test.ts` 7 本（sorted listing／glob は node_modules を辿らない／glob の上限フッター／grep の file:line:text／不正パターンの事前拒否／grep はバイナリと node_modules を検索しない／grep の上限フッター）、e2e `apps/cli/tests/search-recovery-e2e.test.ts`（2000 件ヒット → 結果は spill され、spill ファイルに最初と最後の一致が入り、モデルが offset で末尾を読める。spill ディレクトリは 0700）。`bun run check` 588 pass / 0 fail。
  - 学び: grep の既定上限を当初 1000 にしていたが、これは spill の 32 KiB より先に効くため「結果の全量に手が届く」を壊す。e2e がそれを露見させた（spill ファイルに最後の一致が無かった）。上限は「メッセージに載る量」より上に置き、切る場所を spill に一本化する。
  - 未確認: 入れ子の `.gitignore` は読まない（root のみ）。否定規則で無視ディレクトリの中を復活させることはできない（枝を切るため）。`.` 始まりのディレクトリも規則では復活できない。git の `.git/info/exclude` と global excludes は見ない。
- [x] **B5 bash**。fudo は timeout が一切なく、exit code はエラー文字列に埋まり、打ち切り先も告げない（`fudo:packages/core/tools-tier0/src/bash.ts:42`）。dsh は既定120秒/最大600秒、`[exit code: N]` マーカー、退避先つきの打ち切り通知、背景実行を持つ（`dsh:packages/shell/tool-bash/src/render.ts:11`）。受け入れ: ハングせず、失敗が失敗として読める。
  - 実装（2026-10-14）:
    - 時間切れを足した。`timeoutMs`（既定 120000、上限 600000、`clampTimeout`）で、時間切れになったらまず SIGTERM、5 秒後（`BASH_HARD_KILL_GRACE_MS`）に SIGKILL を送る。SIGTERM を無視するコマンドでも呼び出しが返る。
    - 失敗の読み方を dsh に合わせた。非ゼロ終了は **エラー結果ではなく**、出力に `[exit code: N]` を付けた結果として返す（コマンドが失敗したことと呼び出しが失敗したことを混ぜない）。stderr は `[stderr]` 見出しの節にし、無出力なら `(no output)`、時間切れなら `[timed out after Nms]` を exit マーカーの前に置く。sandbox がコマンドを拒否した場合だけエラー結果のまま（インフラの失敗）。
    - `renderOutput` を `bodyOf` / `markersOf` に割った（認知 9 → 3 以下）。
  - 検証: `bash.test.ts` 7 本（通常実行／sandbox が包んだ argv を実行／非ゼロ終了は `[exit code: 3]` 付きの結果で isError false／`[stderr]` 節／`(no output)`／`sleep 30` を `timeoutMs: 300` で殺し 303ms で返り `[timed out after 300ms]` を出す／`clampTimeout` の既定・上限・下限）。e2e `apps/cli/tests/bash-result-e2e.test.ts`（実 CLI 経路で、失敗したコマンドの結果がエラーではなく `[exit code: 3]` 付きでモデルに届き、2000 行の出力は spill されて通知に退避先が出て、次の呼び出しでその退避先の末尾を読める）。`bun run check` 593 pass / 0 fail。
  - 学び: 「失敗が失敗として読める」は、エラー結果にすることではなく、失敗を出力に書くことでも満たせる。むしろツール呼び出しの失敗とコマンドの失敗を分けた方が、エージェントループの再試行判断を汚さない。
  - 未確認: 時間切れの kill は直接の子（ラッパーや bash）にしか届かない。コマンドが SIGTERM を無視して孫プロセスを残す場合の後始末は sandbox 側の領分で、このチェックアウトでは確認していない。背景実行は tier1 の job_start/job_output/job_kill が担う（`bash` 自身の昇格は持たない）。
- [x] **B6 欠けているツール**。
  - 実装（2026-10-14、採用のうち 1 群目）: `job_list`。`JobsShape.list` をそのまま使い、id・実行中か・コマンドを返す。空なら `(no background jobs)`。モデルに見える宣言の一覧（e2e）も更新した。
  - 検証: `packages/core/tools-tier1/tests/job-tools.test.ts` に 1 本（2 つ起動し、1 つは走ったまま 1 つは終了 → 一覧と状態、そして空の一覧の文言）。`bun run check` 594 pass / 0 fail。
  - 実装（2026-10-14、採用のうち 2 群目）: subagent 制御の 4 つ（`list_agents` / `send_message` / `interrupt_agent` / `wait_agent`）を `packages/core/tools-tier1/src/agent-tools.ts` に足した。`list_agents` は自分自身を除いた子の id と状態、`send_message` は idle なら `followup`（次の turn を起こす）・実行中なら `steer`（次の step 境界で読ませる）、`interrupt_agent` は `cancel('parent-cancelled')`、`wait_agent` は `whenIdle` を timeout と race して「まだ動いている」を返す。自分の session id と知らない id は拒否する。CLI は `--subagents` のときだけこれらを登録する。`subagent` の結果に `[child session: <id>]` を足した（これが無いと親は子に話しかけられない）。
  - 検証: `packages/core/tools-tier1/tests/agent-tools.test.ts` 5 本（一覧は自分を出さない／idle へは followup・実行中へは steer／自分と不明な id の拒否／interrupt は parent-cancelled／wait の時間切れは still working）、`subagent.test.ts` に子の id が結果に載ることを追加。e2e `apps/cli/tests/agent-control-e2e.test.ts`（実 CLI 経路で、親が `subagent` → `list_agents` → `send_message` → `wait_agent` と進み、子のログに 2 回目の答え `child says again` が残る＝メッセージが実在の child agent に届いて turn が走った）。`bun run check` 600 pass / 0 fail。
  - 学び: `subagent` の結果が子の本文だけで id を返していなかったので、親は子を名指しできなかった。制御ツールを足して初めて、結果の形が制御の前提を満たしていないことが露見した。
  - 未確認: 実行中の子を親が interrupt/wait する経路は、親の turn が `subagent` の待ちの中でキャンセルされ、その子が動き続けている場合に限られる（REPL / TUI / Web の同一 scope 内）。同じ run の中では `subagent` が子の完了まで待つので、この経路は e2e で踏んでいない（単体テストのみ）。
  - 実装（2026-10-14、採用のうち 3 群目・最後）: `exit_plan_mode`。`@fudo/safety` の plan mode を「leave できる」形（`makePlanMode`）に置き換えた。制限は登録時に固定された allows ではなく `active()` を毎回見るので、セッションを止めずに解除でき、次の `schemas()` / `call` から workspace を変えるツールが戻る。`PLAN_MODE_TOOLS` に `exit_plan_mode` を足した。ツール本体は `@fudo/tools-tier1/src/plan.ts` で、**承認ではなく ask の seam** を使う（却下の理由を言葉で返せる必要があるため。承認 seam は boolean しか返せない）。質問は callId を id にするので `interaction/ask/*` としてログに残り、選択肢は `['approve', 'keep planning']`、`approve`（前後の空白と大小文字は無視）だけが plan mode を終わらせる。CLI は planMode が有効なときだけこのツールを登録する。
  - 検証: `packages/core/safety/tests/plan-mode.test.ts` 4 本（隠す／制限なしで全部見える／leave 後は次の call から戻る／許可リストは読み取り＋出口）、`packages/core/tools-tier1/tests/plan-tool.test.ts` 3 本（承認で leave し計画が返り、質問は callId と選択肢つき／それ以外は plan mode のままで理由を言葉で返す／空白と大小文字を無視）、e2e `apps/cli/tests/plan-mode-e2e.test.ts`（実 CLI で、step 1 の offered に `write` が無く `exit_plan_mode` があり、承認後の step 2 の offered に `write` が戻り、その書き込みが実際にファイルを作る）。`bun run check` 605 pass / 0 fail。
  - 学び: 承認（boolean）と質問（文字列）は似て非なる seam である。plan の却下は「どこを直せ」を伴うので、boolean の承認 seam に載せると理由が落ちる。どの seam に載せるかは、答えの型が決める。
  - `subagent_fork` は `subagent` の `forkSeed` が既に担っていたので、設計文書の表を「対応済み」に直した（実装は不要）。採用 3 群と除外の判定はすべて設計文書の表にあり、ここから先の残りは無い。
  - 方針（2026-10-14）: どのツールを採るかを設計文書に決めた（`docs/superpowers/specs/2026-10-13-fudo-kernel-design.md` の「dsh にあって fudo が持たないツール」表）。採用は `job_list`、subagent 制御（send_message / interrupt_agent / list_agents / wait_agent）、`subagent_fork`、`exit_plan_mode` の 4 群。除外は pwsh、list_subagent_models、present、lsp、terminal、computer/browser、plugin_manager、ralph、create_worktree、team_*、MCP resources。`workflow` はツールにせず、S6 の決定 4（同じ turn の並列ツール呼び出し）が担う。`str_replace_editor` は `edit` が対応済み。session query 5 種は D4、schedule 4 種は C2 が引き受ける。pwsh、`job_list`、subagent 制御（send_message / interrupt_agent / list_agents / wait_agent）、subagent_fork、list_subagent_models、exit_plan_mode、present、lsp、workflow、MCP resources、session query 5種、schedule 4種、terminal 6種、computer/browser use、plugin_manager、str_replace_editor、ralph、create_worktree、team_*。

## C. 自律性・委譲

- [x] **C1 goal**。fudo の `goal` は引数をログに返すだけ（`fudo:packages/core/tools-tier1/src/goal.ts:17`）。dsh は目標を durable に畳み、継続ラウンドでプロンプトを注入し、blocked を N ラウンド未満では拒否する（`dsh:packages/goal/goal-round-driver/src/index.ts:166`）。受け入れ: 目標がセッションをまたいで持続し、自動で次のラウンドが走る。
  - 実装（2026-10-14）:
    - 設計文書 S6 の決定 3 を改訂した（「自動再開は v1 では持たない」→ 持つ）。理由と形は `docs/superpowers/specs/2026-10-13-fudo-tier3-design.md` にある。
    - `goal-state.ts`: 目標の唯一の置き場は session の `goal/updated`（log-only）。`currentGoal` が最新の 1 件を畳むので、再開したセッションでも目標は生きている。ラウンド数は `user/message`（source = `goal-round`）の数から導出し、別のカウンタを持たない。`USER_MESSAGE_SOURCES` に `goal-round` を足した。
    - `goal.ts`: action 付きのツール（create / edit / pause / resume / complete / blocked）。create は objective 必須、edit は言葉と上限、pause / resume / complete は phase、blocked は理由必須で、直近の user/message が `goal-round`（自動ラウンドの中）なら 3 ラウンド未満では拒否する。phase の変更は古い blocker を落とす。
    - `goal-rounds.ts`: `goalRoundDecision(events)`（純粋）と `startGoalRound(agent)`。CLI が `agent/turn-stopping` に登録し、turn が閉じる**前**に次のラウンドを `goal-round` 来源の user/message として followup する。上限に達したらシステム判断で blocked（round-limit）。自分（`wiring.agent`）の turn だけを見る。
  - 検証: `goal-state.test.ts` 3 本（最新を畳む・無ければ undefined／ラウンドはログから数える／最小 3 ラウンド）、`goal.test.ts` 7 本（create と必須／phase の遷移／goal が無いときの拒否／blocked の理由と 3 ラウンド規則と受理／人間の stop は何ラウンドでも通る／phase 変更で blocker が消える）、`goal-rounds.test.ts` 6 本（決定の 3 通り／ラウンドを積む／上限でブロックし積まない／paused は触らない）、e2e `apps/cli/tests/goal-rounds-e2e.test.ts` 2 本（実 CLI で、create の turn が終わると自動で次ラウンドが走り、そのラウンドで complete すると 2 turn で止まる／maxGoalRounds 1 なら 2 turn で blocked になりループしない）。`bun run check` 621 pass / 0 fail。
  - 学び: 「turn が終わってから次を積む」設計は、CLI が `whenIdle` で抜ける競合を生む（idle 判定の後にラウンドが積まれると run が終わる）。turn が閉じる前に積む（turn-stopping）ことで自動継続が確実になる。
  - 未確認: 子 agent は `forkSeed` で親の goal を引き継ぐが、driver は main agent の turn だけを見るので子は自分のラウンドを回さない（子のログには active な goal が残る）。blocked の 3 ラウンド判定は「直近の user/message が `goal-round` か」で自動ラウンドを判定しており、人間が steer した直後は人間の番と見なす。上限到達時の blocked はシステム判断なので 3 ラウンド規則の対象外。
- [x] **C2 schedule**。dsh は create/list/update/delete と cron/daily/weekly/every を持ち、期限到達で `followup` する（`dsh:packages/schedule/tool-schedule/src/index.ts:446`）。fudo に時間の概念はない。
  - 実装（2026-10-14）:
    - 設計文書 S6 の範囲に schedule を足し、決定 6 を書いた（ログのイベントで表す・時計は 1 本の fiber が持つ・時間帯はプロセスのローカル 1 つ）。
    - `schedule-time.ts`: ルールは every（秒）/ daily（ローカル時刻）/ weekly（ISO 曜日 + 時刻）/ cron（5 フィールド）。`nextDue(rule, from, lastFired)` が次に来る瞬間を返し、来ない規則は undefined。cron は `*`・`a`・`a-b`・`*/n`・`a,b` を受け、日と曜日が両方制限されているときはどちらか一致（cron の流儀）。探索は日単位で最大 4 年ぶん進めてから、その日の分を走査する（`0 0 30 2 *` のような規則は 4 年で見つからず undefined になる）。
    - `schedule-state.ts`: `schedule/created` / `schedule/updated` / `schedule/deleted`（log-only）を畳む `currentSchedules` と、`schedule/fired` から最後の発火を読む `lastFiredAt`。区間の起点は作成時刻と最終発火の遅い方。発火時にモデルへ渡す文は `<schedule id="..." rule="...">` で包む。
    - `schedule.ts`: action 付きのツール（create / list / update / delete）。create はルール 1 つと prompt 必須、来ない規則は作成時に拒否、id はログから数えて `sched-N`。`USER_MESSAGE_SOURCES` に `schedule` を足した。
    - `schedule-runs.ts`: `pendingFires` / `nextFire`（純粋）と `fireSchedule`、そして `installScheduleRuns(agent, hooks, now)`。scoped fiber が「次の期限まで sleep」「schedule/* が変わったら起き直す」「期限が来たら `schedule/fired` を書いて followup」を繰り返す。起動時に期限が過ぎていれば即発火する（留守中に来た分を取りこぼさない）。
  - 検証: `schedule-time.test.ts` 10 本（every と最終発火起点／daily の今日・明日／weekly の当日と翌週／cron の毎分・固定時刻・ステップ・リスト・範囲・曜日・月日・来ない規則の拒否）、`schedule.test.ts` 6 本（create と必須と複数ルールの拒否／来ない規則の拒否／list／update と delete と不明 id／畳み込みの削除）、`schedule-runs.test.ts` 5 本（soonest first と削除済みの除外／最終発火から数える／発火の記録とプロンプト／期限が来た予定を実際に発火させる（実 Hooks レジストリ）／予定が無ければ待つだけ）、e2e `apps/cli/tests/schedule-e2e.test.ts`（実 CLI で、1 本目の run が予定を残して終わり、1.2 秒後の 2 本目の run が期限切れの予定を発火してモデルを呼び戻し、モデルが delete すると止まる）。`bun run check` 643 pass / 0 fail。
  - 学び: cron の曜日フィールドを取り違えるバグを「来ない規則」のテストが露見させた（`slice(2)` で月を曜日として読んでいた）。ありえない入力（`0 0 30 2 *`）を 1 本置くと、正例だけのテストでは見えない取り違えが出る。
  - 未確認: 時間帯はプロセスのローカル 1 つだけで、dsh のような予定ごとの IANA zone は持たない。DST の切り替えは「ローカル時刻の一致」で判定するので、春の 1 時間は飛び、秋の重複は 1 回だけ発火する。タスク 1 発の run（`fudo run "..."`）は turn が終わると終了するので、その run の中で期限が来ない予定は発火せず、次に同じセッションを開いたときに期限切れとして発火する（長く生きる REPL / TUI / Web では開いている間に発火する）。cron の `L`/`W`/`#` や名前付き月は持たない。
- [x] **C3 workflow / PTC**。dsh はスクリプトで子エージェントを扇状に走らせ、schema で結果を検証し、失敗項目を null に落とす（`dsh:packages/workflow/tool-workflow/src/index.ts:161`）。fudo は1 step 内の並列ツール呼び出しだけ（`fudo:packages/core/agent-loop/src/batch.ts:1`）。
  - 実装（2026-10-14）:
    - 設計文書 S6 の決定 4 を改訂した（「同じ turn の並列ツール呼び出しに留める」→ データで書く扇状実行のツールを足す。JS のオーケストレーションスクリプトを解釈する engine は持たない）。
    - `workflow.ts`: `tasks`（id / task / cwd? / expect? = text | json）と `concurrency`（既定 4）。各 task は `subagent` と同じく親のログから fork した子を起こし、**同時に**走らせ、1 つずつ `{id, value, error?}` を返す。子を起こせない・メッセージを取らない・expect: json の答えが JSON でない、はその項目だけが `value: null` と理由になり、run 全体は成功したまま。id の重複と空の tasks は実行前に拒否する。
    - 値は JSON（`Schema.Json`）で返るので、モデルは結果をそのまま読んで次の workflow を決められる。CLI は `--subagents` のとき subagent / agentTools と一緒に登録する。
  - 検証: `workflow.test.ts` 3 本（扇状に走らせて全部の答えを返す／JSON として読めない項目だけ null になり他は生きる／同じ id は実行前に拒否）、e2e `apps/cli/tests/workflow-e2e.test.ts`（実 CLI 経路で親 + 子 2 の 3 セッションができ、結果が `a: first` と `b: (failed: the answer is not JSON)` になる）。`bun run check` 647 pass / 0 fail。
  - 学び: Effect 4 ではエラーを握る関数が `Effect.catchCause` 系に限られ、Effect のメソッド版 `catchAll` も無い。項目ごとの失敗隔離は、エラー型を作らず `Effect.orElseSucceed` と純粋な try/catch に落とす方が素直だった。JSON 値のスキーマは Effect の `Schema.Json` がそのまま使える。
  - 未確認: dsh の JS スクリプト（ループ・分岐・逐次依存・結果の schema 言語での検証・background run と jobs 連携・run の record イベント）は持たない。ループと依存は「モデルが workflow を何度か呼ぶ」で表す。`concurrency` の既定 4 は fudo の値である。
- [x] **C4 guards**。fudo は monotonic guard の seam を持つが production に1本も登録していない（`fudo:packages/core/tools/src/pipeline.ts:96`）。dsh は繰り返し呼び出しの検出（閾値 3/5/8）と宣言 timeout の強制を持つ（`dsh:packages/guard/repeat-tool-reminder/src/index.ts:36`）。
  - 実装（2026-10-14）:
    - 設計文書（kernel の guard の節）に追記した: 出荷構成に guard は登録しない。plan-mode は restriction、承認は pre-execute の decision で足りており、いま veto すべき対象が無い。dsh の repeat-tool-reminder に当たる「同じ呼び出しの繰り返し」も **advisory** にし、拒否ではなくリマインダで知らせる（拒否にすると `job_output` の polling のような正当な繰り返しを壊す。dsh も同じ判断）。
    - `repeat-reminder.ts`: `trailingRepeat(events)` がログ末尾の同一呼び出しの連続数を数える（`tool/call` の name と arguments が同じ）。`repeatReminder` は連続数が 3/5/8 のときだけ文面を返す（3 は gentle、5 と 8 は tool・回数・引数の preview つき）。各回数は 1 回しか訪れないので、配布済みの記録を持たなくてよい。
    - `installRepeatReminders(agent, hooks)` は `tools/post-execute` を **prepend** で登録し、`next()` を先に走らせてから自分のブロックを足す。リマインダはその呼び出し自身の結果に載るので、モデルは結果と同じ息で読み、ログにも残る。sessionId で自分の agent の呼び出しだけを見る。
    - 宣言 timeout の強制は既に実装済みだった（`pipeline.ts` の `Effect.timeout`。証拠は `packages/core/tools/tests/timeout.test.ts`）。
  - 検証: `repeat-reminder.test.ts` 7 本（連続数の数え方と途切れ／閾値の前後と gentle / detailed／閾値の間の回数は黙る／閾値の一覧／実 Hooks レジストリで 3 回目の結果にリマインダが付く／他セッションと 1 回目は付かない）、e2e `apps/cli/tests/repeat-reminder-e2e.test.ts`（実 CLI 経路で同じ todo_write を 3 回呼び、3 回目の結果だけがリマインダを含み、その次のリクエストにも載る）。`bun run check` 655 pass / 0 fail。
  - 学び: waterfall の listener は `next()` を呼ばないと後続を飢えさせる。最初の実装は A3 の AGENTS.md listener（`next()` を呼ばない）の後ろに並んで**一度も走らなかった**。prepend + `next()` + merge が正しい作法で、原因はプローブ用に足した listener が同じ短絡をしていたことで判明した。
  - 未確認: A3 の `installNestedAgentsMd` は `next()` を呼ばないので、それより後に登録された post-execute listener を飢えさせる（C4 は prepend で回避した。A3 側を協調させるのは別の変更）。リマインダは main agent のセッションだけを見る（子 agent の繰り返しには出ない）。回数の数え方は「tool/call の name と arguments の完全一致」で、dsh の canonical 引数と同じ扱いである。
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
