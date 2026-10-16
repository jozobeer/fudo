# jozo-harness 設計: Web UI を DSH レベルへ（2026-10-16）

ユーザーの指示は「まずは dsh レベルの UI を実装せよ」。対象はブラウザ UI
（[web 設計](2026-10-13-jozo-harness-web-design.md)）で、TUI は同じ
`@jozo-harness/ui-view` を読む形で追随する。DSH 側の機能棚卸しは
[DSH ブラウザ UI の機能棚卸し](../../notes/2026-10-16-dsh-web-ui-inventory.md) にある。

## 決定（2026-10-14 の「持たない」を上書きする）

- **提示層はカードと markdown を持つ**。2026-10-14 に「v1 はカードを持たない」と
  決めたときの見直し条件は「日々の使用で 1 行では足りないと感じたとき、
  markdown をそのまま読みたい場面が計測で出たとき」だった。1 行要約はログに
  残したまま、Web はそれをカードの見出しに使い、本文と markdown を描く。
- **会話の描画は Web が先**。TUI は同じブロックを読むが、折り返しと省略の仕方は
  apps/tui の中で決める。
- **DSH の作りは写さない**。React とスロットの構造ではなく、jozo-harness の
  純関数 + 文字列描画のまま、機能と情報量を DSH に寄せる。

## スライス

| # | 中身 | 状態 | 完了条件 |
|---|---|---|---|
| S1 | 会話の描画（markdown・コード・tool カード・承認/質問カード・ヘッダ） | 実装済み 2026-10-16 | 単体テストと実 Chrome の受け入れが通り、スクリーンショットが残る |
| S2 | 左サイドバーとセッションの入口（一覧・新規・切り替え） | 一覧・新規・切り替えは実装済み 2026-10-16。右サイドバーと設定導線は未着手 | ブラウザだけでセッションを選び、新しく作り、切り替えられる |
| S3 | 設定とテーマ（外観の切り替え、設定面とモデル選択） | 実装済み 2026-10-16（モデルと effort 以外のキーは未対応） | 設定ファイルを直接開かずに主要なキーを変えられる |
| S4 | 走行状態（goal・schedule・job・subagent・plan） | 実装済み 2026-10-16 | 実行中のものを会話とは別の面で見て、止められる |
| S5 | 設定（権限・プリセット・テーマ・ショートカット） | 未着手 | 設定ファイルを直接開かずに主要なキーを変えられる |

S2 は「1 プロセス = 1 セッション」を「サーバがセッション登録簿を持ち、必要なときに
1 つ開く」に変えた。protocol に `sessions` と `open` を足し、`command` と `events` は
セッション id を運ぶ。apps/cli の `runSession` は `buildSession`（1 セッションの
構築）と「それを配る」に分かれ、Web は必要になったら `buildSession` をもう一度呼ぶ。

## S2 で入れたもの（2026-10-16）

- `apps/web/src/server/sessions.ts` — セッション登録簿。最初のセッションは起動時に
  受け取り、以降は初めて要求されたときに開く。開いたセッションはサーバが止まる
  まで生きる（切り替えて戻るのが無料になる）。セッションごとに 1 つの scope を
  持ち、サーバの scope が閉じるときに一緒に閉じる。
- `apps/web/src/shared/rpc.ts` — `sessions`（一覧と初期 id）、`open`（名前つき、
  または新規）、セッション id を運ぶ `command` / `events`。
- `apps/cli/src/index.ts` — `buildSession` が layer・agent・tool・UI host を 1 単位に
  まとめ、`sessionFactoryOf` が Web のためにもう 1 つ開く。preset の不一致は
  exit code ではなく、ページに出るメッセージになった。
- `apps/web/client/*` — 左レールに一覧（名前・時刻・id の先頭と cwd の末尾）、
  New session、行のクリックで切り替え。切り替えると会話は空になり、URL は
  `?session=<id>` になる（再読込しても同じセッションに戻る）。開けなかった理由は
  ヘッダに出す。turn が終わるたびに store を読み直すので、名前の付いたセッションは
  その場で名前が出る。
- `packages/core/session` の `titleOf` / `titleOfRecord` — 「最初の user/message を
  1 行に縮める」規則の唯一の置き場。store は行を、CLI と Web はイベントを読む。
  `packages/core/session-jsonl` の `readTitle` が 64 KB の先頭からそれを探す。
- `jzh sessions` の一覧も名前を出す。

未着手は、右サイドバーと設定への導線である。

## S3 で入れたもの（テーマ、2026-10-16）

- `apps/web/client/theme.ts` — `system` / `dark` / `light` の 3 つと、`themeFrom`
  （保存値と DOM の値を同じ規則で読む）、`themeAttribute`（system は属性を書かない）。
- レールの足に 3 つのボタン。選ぶと `<html data-theme>` が変わり、`localStorage` に
  残る。再読込しても選んだ外観と、URL が指すセッションの両方が戻る。
- CSS は、属性が無いときだけ media query に従う（`:root:not([data-theme='dark'])`）。
  system のときに属性を書かないので、機械の設定に追従し続ける。

残りは、右サイドバーである。

## S3 で入れたもの（設定面、2026-10-16）

- `apps/web/src/server/settings.ts` — ページが読めるもの（`SettingsView`）と、
  変えられるもの（`models`、`setModel`）の口。エラーは `apps/web/src/server/errors.ts`
  の `WebError` に一本化した（セッションの開閉と共用）。
- RPC は `settings` / `models` / `setModel` の 3 本。`models` は provider の
  `GET /models` を叩くので、押されたときだけ走る。
- 書き込みは `jzh config set model` と同じ `runConfig` を通す。**同じファイルに同じ
  流儀で書く**ために、書き手を増やしていない。
- レールの足の `settings` で、右上にシートが開く。いま効いている model / effort /
  cwd / セッションの置き場 / 設定ファイルを読み、モデルは `List models` で一覧を
  取ってから選ぶ。**効くのは次の run から**（route は agent を作るときに決まる）ので、
  シートにもそう書いてある。
- 受け入れは、シートが開くこと・いまのモデルを出すこと・モデル一覧が無い profile で
  は失敗を文言で返すこと・閉じることを実 Chrome で確かめる。

未着手は、選択を今のセッションに効かせること（agent の route を差し替える設計が要る）、
effort や profile など他のキーの編集、右サイドバーである。

## S4 で入れたもの（goal と schedule、2026-10-16）

- ログが既に持っているものだけを、まず見せた。`goal/updated` と
  `schedule/*` は `registerLogOnlySessionEvents` でセッションに記録されている
  ので、**新しいイベントも新しい畳み方も要らない**。
- 畳み方は 1 つに保った。規則は `@jozo-harness/tools-tier1` の `currentGoal` /
  `goalRounds` / `currentSchedules` / `ruleText` / `lastFiredAt` にあり、
  同じものを使っている CLI の `/status` と Web が同じ答えを出す。UI のパッケージは
  tier1 に依存しない（node 側の重い依存をブラウザへ持ち込まないため）ので、
  **UI は畳まずに問い合わせる**: `OpenSession.runState()` を apps/cli が閉じ込め、
  RPC `state` がそれを返す。
- レールに `RUN` の面を足した。ゴールは objective・phase・ラウンド数、schedule は
  rule・prompt、無ければ "no goal"。turn が終わるたびに読み直す。

- job はログに無い（メモリ上の台帳である）。台帳は `buildSession` が 1 つ作り、
  `ProfileWiring` 経由で tier1 のツールに渡す。**同じ台帳**を `OpenSession.runState()`
  が読んで UI に渡すので、`job_list` が見せるものとレールが見せるものは同じである。
  UI に届くのは id・コマンド・実行中かで、出力は持たない（読みたければ `job_output`）。

- 問い（plan の提示を含む）は **会話の中のブロック**になった。以前は notice とカードの
  二重に出て、plan のような長い文は 1 段落に潰れていた。いまは
  `{ kind: 'ask', id, question, options, answer }` として尋ねた場所に残り、質問は
  markdown として描かれ、答えは「answered: …」になる。答える口（選択肢のボタンと
  Enter）は、その問いがまだ待っている間だけ出す。TUI も同じブロックを読む。

- job は押すと開く。右のシートが、その job のコマンドと状態、**台帳が持っている出力**
  （`job.output`、上限 64 KB）を出し、まだ走っていれば `Stop` で止められる。読み書きは
  `OpenSession.jobOutput` / `stopJob` として同じ台帳に届き、run state を読み直して
  消えたことを確かめる。シートは settings と job の 2 種になった。

- trajectory は、rail の `trajectory` で開く台帳である。ターンごとに、長さ（ログの
  時刻の差）、ステップ数、tool 呼び出し数、終わりの理由を並べる。畳み方は
  `apps/web/client/trajectory.ts` の純関数で、会話と同じく **seq の重複を数えない**
  （transport が境界のイベントを二度運ぶことがある）。ページはイベントから直接数える
  ので、サーバには何も足していない。

未着手は、右サイドバー（ファイル・端末・プレビュー）、選んだモデルを今のセッションに
効かせること、job の出力の自動更新である。

- subagent が始めた子セッションは、レールの RUN に `subagent · <id の先頭>` として
  出る。押すとそのセッションに移る（セッションの切り替えは既にある経路をそのまま使う）。
  **台帳は増やしていない**: subagent ツールが自分の結果に書いた
  `[child session: <id>]` を読むだけである。押した先は子のログを再開した別の実行なので、
  子の実行そのものに繋がるわけではない（送信や停止はまだできない）。
- 走っている turn に入力すると、これまでは何も出なかった（composer は空になり、
  次の turn が始まるまで見えない）。`agent/inbox/queued` を **CLI 側の
  `projectInbox` で畳み**（inbox の規則は 1 つのまま）、run state の `queued` として
  渡す。ページは composer の上に "queued" の行として出し、inbox のイベントごとに
  読み直すので、claim されれば消える。

## S1 で入れたもの

- `apps/web/client/markdown.ts` — 見出し・箇条書き・引用・コードフェンス・
  インラインの markdown を、エスケープ済みの HTML にする純関数。リンクは
  http/https/mailto/相対だけをアンカーにする。
- `packages/ui/view` の tool ブロックに `output`（全文、16,384 字で打ち切り）を
  足した。TUI は今までどおり 1 行の `result` を読む。
- `apps/web/client/view.ts` — 役割ラベル付きのブロック、tool カード
  （`<details>`、エラーは開いた状態）、承認カード（Allow / Deny、y / n）、
  質問カード（選択肢ボタン）。ヘッダは接続・cwd・provider/model・次の動作。
- `apps/web/client/state.ts` — ログのイベントから cwd・model・turn 数を読む。
  本文は unknown なので、読めなかったキーは捨てる。

## 未確認

- 長い会話（数百ブロック）で毎イベントの描画が実用の速さか。いまは確定ブロックの
  HTML を配列の同一性でキャッシュしている。
- DSH の既定キーバインドと、Chat の折畳モードの細かい規則は未読
  （棚卸しの「未確認」節）。
- 受け入れは実 Chrome と seatbelt の組み合わせで通った。Linux CI では
  `sandbox-exec` が無いので、この経路は macOS に限られる。
