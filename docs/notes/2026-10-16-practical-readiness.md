# 実用レベルに引き上げるための検討（2026-10-16）

Web UI を DSH 並みにする作業と並行して、それ以外に何が要るかを整理した。優先度を付ける。上から順に片付ける。

- `dsh:` は DSH（deepseek-ai/deepseek-harness、86a4022、2026-10-15）のルートからのパス。
- `jzh:` はこのリポジトリのルートからのパス。
- 「実測」はこの日に一時テストを書いて走らせた結果（テストは消した）。「コード読み」は走らせていない。

## 実用の定義

作者が日常の主力コーディングエージェントとして、主に Web UI から使える状態を指す。次の 4 つを満たすこと。

| 条件 | 中身 |
|---|---|
| 安全 | ブラウザや他プロセスから乗っ取られない。sandbox が既定で効く |
| 取り消せる | 1 turn が何を変えたかを見られ、turn 前の状態に戻せる |
| 止まらない | 一時的な provider 障害や長い応答で turn が死なない |
| UI で完結する | 新規・再開・切替・モデル選択・承認が UI の中で済む |

他人への配布は定義に含めない（P2 の「配布」で扱う）。

## 結論

1. P0 の 4 件を、Web UI の機能を広げるより先に直す。どれも実測かコード読みで確かめた欠陥で、規模は小さい。とくに WebSocket の Origin 未検査は、UI が markdown やファイルプレビューを描くほど攻撃面が広がる。
2. 「DSH 並み」をパッケージの並びではなく日常ループの並びとして定義し直す。DSH の `dsh:packages/client/` は 60 を超える UI パッケージを持つ。全部を追うと終わらない。
3. 実用性を最も上げるのは 2 つの基盤である。ターン単位のワークスペーススナップショット（差分レビュー・巻き戻し・fork が共有する）と、複数セッションを持つサーバ。Web UI のサイドバーや変更ファイルのカードは、この 2 つが無いと作れない。
4. [Web 設計](../superpowers/specs/2026-10-13-jozo-harness-web-design.md)の 2 つの決定（Web は 1 セッション固定、提示層はカードを持たない）は DSH 並みの UI と両立しない。実装より先に spec を改訂する。doc gate はリンク切れしか見ないので、意味の食い違いは自動では見つからない。

## P0: 実測で確かめた欠陥

| # | 項目 | 確かめたこと | 影響 | 対処 | 規模 |
|---|---|---|---|---|---|
| 1 | WebSocket の Origin 未検査 | 実測。`Origin: https://evil.example` の接続が開き、`submit` が host に届いた。`jzh:apps/web/src/server/serve.ts:53` は `/ui` への要求を無条件に upgrade する。CSP も無い | 開いているどのページからも、ポートを探して submit と approve を送れる。agent は bash を持つので RCE になる。OpenCode の CVE-2026-22812（CVSS 8.8）と同じ類型 | Origin と Host を `127.0.0.1:<port>` / `localhost:<port>` に限る。起動ごとのトークンを URL の fragment で渡し、最初のメッセージで検証する。CSP `default-src 'self'` を付ける | S |
| 2 | 応答のストリーミングが無い | 実測。最初のチャンクを書いてから 800ms 後に閉じる本文で、最初のチャンクが届いたのは 803ms 後だった。`jzh:packages/llm/llm-openai/src/adapter.ts:122` が `response.text()` で全量を読んでから decode する | 実 provider では `live` テキストが伸びない。体感の待ち時間が応答全体の長さになる。コード読みでは、`AbortSignal.timeout` が本文の読み取りにも掛かるので、生成が続いていても 300 秒を超える応答は TIMEOUT で落ちる。`Effect.tryPromise` が中断の signal を使わないので、cancel しても HTTP 要求は止まらず課金が続く | `response.body` を逐次 decode する。無応答タイマーはチャンクごとに戻す。fiber の中断で fetch を abort する | S〜M |
| 3 | 一時障害の再試行が無い | コード読み。`agent/request-error` の waterfall（`jzh:packages/core/agent-loop/src/runner.ts:344`）に、出荷構成で登録するものが無い | 429・5xx・transport の 1 回で turn が error で終わる | 出荷構成に listener を入れる。上限つき指数 backoff と jitter（DSH の `dsh:packages/llm/llm-retry` は既定で 5 回、500ms〜10s）。再試行をログに記録して UI に「再試行 2/5」を出す | S |
| 4 | read_image の結果がモデルに届かない | 実測。image ブロックだけの tool 結果が、wire 上で `"content":""` になった。adapter は `images: 'none'`（`jzh:packages/llm/llm-openai/src/plugin.ts:35`）で、`textOf` が image を捨てる | モデルは「画像を見せる」と説明された tool を呼び、空の結果を受け取る。失敗として扱われない | 当面は `images: 'none'` の adapter では read_image を登録しない。画像対応は P2 の provider 拡張でやる。Chat Completions の tool role は画像を運べないので、後続の user メッセージに載せる形になる | S |

## P1: 日常ループ（Web UI 作業の前提になる backend）

| # | 項目 | 今 | 参考 | 提案 | 規模 |
|---|---|---|---|---|---|
| 5 | ターンのスナップショット（差分・巻き戻し） | 無い。巻き戻しは手で git を使う | Claude Code の `/rewind`（コードだけ・会話だけ・両方を戻す。追跡するのは file tool の編集だけで、bash の変更は戻らない）。OpenCode の `/undo` `/redo`（git で管理する）。Codex app の review pane（最後の turn・未コミットの範囲で差分を見て、hunk 単位で revert し、行コメントを次の指示にする）。DSH の `dsh:packages/deliverables/workspace-changes`（turn の開始と終了で git snapshot を取り、変更ファイルと行数をカードにする） | 作業ツリーとは別の GIT_DIR に、turn の開始時と終了時の tree を記録する。変更ファイルの一覧、差分、turn 前への restore を出す。bash による変更も捕まえるので、Claude Code より取りこぼしが少ない。会話の巻き戻しは、ログを書き換えず、指定 seq から fork した新しいセッションとして作る。巨大なファイルと .gitignore の対象は除く | M |
| 6 | 複数セッションのサーバ | `jzh web` は起動時の 1 セッションだけを配る。購読のたびに全履歴を送り直す（`jzh:packages/ui/host/src/index.ts:85`） | DSH の `dsh:packages/api/session-controller`、`dsh:packages/client/ui-sidebar`、`dsh:packages/session/session-turn-outline` | サーバ内に session controller を置く（一覧・新規・開く・再開・アーカイブ、セッションごとの cwd、idle な agent の破棄）。protocol にセッション単位の RPC と版を足す。履歴は turn 単位で切って送り、古い方は要求されたときに読む | M〜L |
| 7 | 実行時の操作 | コマンドは `/help` と `/status` だけ。走行中の入力は次の turn に積まれる | Claude Code・Codex・DSH はどれもモデル・権限・plan mode を UI から切り替えられる | モデルと effort の切替、preset の切替、plan mode のオンオフ、`/compact`、`/new` を足す。走行中の入力は、既存の `inject`（次の step に入る）と「次の turn に積む」を選べるようにする | M |
| 8 | 承認の記憶 | 1 回の呼び出しかぎりで、記憶しない（`jzh:packages/core/safety/src/approval.ts:26`） | Claude Code の permission rules、Codex の prefix rule | 先に測る。自分のログで、turn あたりの `safety/approval/requested` を数える。多ければ、セッション内で有効なコマンド接頭辞とパスの規則を足す。既定は今のまま記憶しない。承認が多すぎると、利用者は `full` に逃げる。そちらの方が危ない | M |
| 9 | 表示の忠実さ | 本文は plain text。tool の結果は 1 行目を 200 字で切る（`jzh:packages/ui/view/src/conversation.ts:62`）。reasoning は描かない。描画はチャンクのたびに会話全体の `innerHTML` を置き換える（`jzh:apps/web/client/main.ts:32`） | DSH の `dsh:packages/client/ui-chat`（reasoning の折り畳み、作業詳細の表示モード）、`dsh:packages/client/ui-trajectory`（token・所要時間の検査） | markdown を描く（sanitize したうえで）。コードを強調表示する。reasoning を折り畳んで出す。tool の引数と結果を、ログから全文で展開できるようにする。context メーター・token・所要時間を出す。描画は、ブロックを key で識別して差分だけ更新する形に変える。今の全置換は、長い会話ではチャンクごとに O(n) かかり、選択範囲と開閉状態も消す | M |
| 10 | 通知と入力欄 | 無い | Claude Code・Codex の @ファイル補完、スラッシュコマンドのパレット、画像の貼り付け | 承認・質問・turn 終了でブラウザ通知を出す。@ファイル補完、コマンドのパレットを足す。画像の貼り付けは #4 と P2 の provider 拡張の後 | S〜M |

## P2: 届く範囲を広げる

| # | 項目 | 中身 | 規模 |
|---|---|---|---|
| 11 | provider | DeepSeek 直結（prefix cache が自動で効く）、Anthropic のネイティブ API（cache_control・画像・thinking）、OpenAI の Responses API（reasoning を tool ループの間で持ち越す）。`encodeMessage` は reasoning ブロックも捨てる。thinking モードで reasoning を返し戻す必要がある provider があるかは要確認。context window と単価を持つモデル目録を作り、#9 の費用表示に使う | M〜L |
| 12 | 実行中の turn の再開 | クラッシュの時点で走っていた turn を、ログから続ける。DSH は `dsh:packages/session/session-checkpoint-policy` で、モデル要求と副作用のある tool の前に永続化する | S〜M |
| 13 | subagent を有効にするフラグ | 実装はあるが、CLI から有効にする手段が無い（`jzh:apps/cli/src/index.ts:372`） | S |
| 14 | 配布 | `jzh web` の静的ファイルはソースからの相対パス（`jzh:apps/web/src/server/serve.ts:12`）なので、compile したバイナリでは配れない。dist を埋め込み、起動時にブラウザを開く | S |
| 15 | Linux の sandbox | 既定の seatbelt は macOS 専用で、Linux では起動が失敗する。Linux やクラウドのコンテナで走らせるときだけ要る。DSH は `dsh:packages/sandbox/sandbox-local` で bwrap と Landlock を使う | M |

## DSH にあっても持たないもの

| もの | 理由 |
|---|---|
| plugin market とインストーラ UI、デスクトップアプリ、i18n、telemetry とフィードバック評価、Python SDK、ACP、remote access と peer、dock レイアウト | ローカルの利用者 1 人には効かない。保守する面だけが増える |
| サイドバーのブラウザと端末 | ブラウザのタブと手元の端末で足りる |
| 並列 worktree の編成（Conductor・Codex app の型） | #5 と #6 が入ってから考え直す |

## 実用の判定

| 観点 | 判定 |
|---|---|
| 安全 | 他オリジンの接続と、トークンの無い接続を拒否するテスト |
| 止まらない | 429 を 2 回返してから成功する replay で、turn が完了する。最初の token までの時間をログに残す |
| 取り消せる | edit と bash の `mv` を含む turn の後、restore で作業ツリーが turn 前とバイト単位で一致する |
| 日常の使用 | 2 週間使い、ログから数える: error で終わった turn の率、turn あたりの承認数、手で git revert した回数、compaction の回数。閾値は作者が決める |
| タスク | 自分のリポジトリから取った 20 タスク程度の成功率を、Claude Code・Codex の同じタスクと比べる。今の A/B は、小さい 4 タスクで DSH と同等だと示しただけである。結果はモデル（いまは deepseek-v4.1-flash）に強く依存するので、#11 の方が UI より効く可能性がある |

## 改訂が要る決定

| 文書 | 決定 | 理由 |
|---|---|---|
| [Web 設計](../superpowers/specs/2026-10-13-jozo-harness-web-design.md) | Web は起動時の 1 セッションだけを購読し、一覧と切り替えは持たない | #6 と DSH 並みのサイドバーに反する |
| 同上 | 提示層はカードを持たない | 書かれた見直し条件（1 行では追えない）に当たる。#5 の差分と #9 の展開が要る |
| `jzh:packages/core/safety/src/approval.ts` | 承認は記憶しない | #8 で測った結果しだい |

## 順番

P0 の #1〜#4 → #5 → #6 → #7 と #9（Web UI の作業と並行）→ 測ってから #8 → P2。規模は Claude が実装する前提の大まかな目安で、S は 1 日未満、M は 2〜5 日、L は 1〜2 週。

## 参考

- Claude Code の checkpointing: https://code.claude.com/docs/en/checkpointing
- OpenCode の TUI（`/undo` `/redo` `/share`）: https://opencode.ai/docs/tui/
- Codex app の review: https://developers.openai.com/codex/app/review
- CVE-2026-22812（OpenCode の認証なしローカルサーバ）: https://advisories.gitlab.com/npm/opencode-ai/CVE-2026-22812/
