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
| S4 | 走行状態（job・subagent・goal・schedule・plan）と trajectory | 未着手 | 実行中のものを会話とは別の面で見て、止められる |
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
