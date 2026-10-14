# fudo 設計: S8 Web UI

S1 をローカルサーバー越しに操作するブラウザ UI。S7 と同じ UiCommand / UiEvent を WebSocket で運ぶ。

## 目的と範囲

- `fudo web [--port N]` が 127.0.0.1 にサーバを立て、URL を stderr に出す。
- ブラウザで会話を読み、入力し、承認と ask に答える。複数タブは同じセッションを購読する。
- やらない: 認証、リモート公開（バインドは 127.0.0.1 固定）、ファイル添付。
- **インターフェースの方向（2026-10-14 追記、暫定）**: dsh に TUI が無いので、比べる相手はこの web UI である。新しい提示（presentation・画面）は web を先に作り、TUI は同じ `@fudo/ui-view` を読んで追随する方に寄せていく（比べる相手が変われば見直す）。
- **提示層はカードを持たない（2026-10-14 追記、ギャップ表の「提示層」）**: dsh はノードレジストリでカード・差分・markdown を描くが、v1 は持たない。理由は 3 つ。(1) モデルに渡る情報は tool の 1 行要約（`tool/call` / `tool/result` の `summary`）と tool の本文で足り、要約は pipeline が描いてログに残るので TUI・Web・replay が同じ行を読む。(2) カードはクライアントごとの描画契約を増やし、`@fudo/ui-view` の reducer 1 つに畳んだ利点を失う。(3) 差分表示は `edit` の要約（`lines: 2 → 3`）と read の行番号で足りる。見直す条件は、日々の使用で「どのツールが何をしたか」を追うのに 1 行では足りないと感じたとき、または markdown をそのまま読みたい場面が計測で出たとき。そのときは web を先に作り、`present` ツール（client へカードを渡す経路）を足すかどうかも同時に決める。
- **セッション一覧とブラウズは CLI が持つ（2026-10-14 改訂、E2）**: 当初はここも「やらない」に入れていたが、[dsh のギャップ表](../../notes/2026-10-14-dsh-gap-backlog.md)の E2 が一覧とブラウズを求めるので、`fudo sessions`（一覧）と `fudo sessions <id>`（1 セッションの会話を読む）として CLI に置く。Web は起動時に渡された 1 セッションを購読するままで、一覧と切り替えは持たない（切り替えは boot が渡すセッション id の面を作り直すことになり、S8 の範囲を超える）。デスクトップ・SDK・ACP は除外のままである。設定は `fudo config`（ファイル）と `fudo --dump-config`（実効値と出どころ）が見せる。

## transport

`effect/rpc`（unstable）は S8 の transport の内側だけで使う。protocol と host は effect/rpc を知らない。

- サーバ: `Bun.serve` の WebSocket ハンドラを `RpcServer.Protocol` に写す。1 フレーム 1 メッセージの `RpcSerialization.json` を使う。サーバのフレーム処理は Bun のコールバックから来るので、受信は `writeRequest` を fork し、送信は接続ごとの parser で encode して `ws.send` する。
- クライアント（ブラウザ）: `RpcClient.makeProtocolSocket` を `Socket.makeWebSocket` + `Socket.layerWebSocketConstructorGlobal` で束ねる。
- RPC 群（`apps/web/src/shared/rpc.ts`）:
  - `submit({ text })` / `approve({ callId, approved })` / `answer({ id, answer })` / `cancel()` — 単発
  - `events()` — `UiEvent` の stream

この形は Bun 1.4.3 / effect 4.0.3 で実測済み（単発と stream の両方が通る）。

## 構成

| 置き場 | 名前 | 責務 |
|---|---|---|
| `apps/web/src/server` | `@fudo/web` | RPC 群と Protocol、`Bun.serve`、静的ファイル配信、`serveWeb` |
| `apps/web/client` | （bundle のみ） | ブラウザの入口。`@fudo/ui-view` の reducer と DOM 描画 |
| `apps/web/dist` | | `bun run build` の出力。`fudo web` はここを配る |

- `fudo web` は apps/cli が `@fudo/web` の `serveWeb` を呼ぶ。`serveWeb(host, { port, interrupt })` は SIGINT でサーバを閉じて 130 を返す。
- クライアントは `Bun.build`（target browser）で 1 ファイルに束ねる。CSS と HTML は静的ファイル。
- 静的配信は `dist` の中だけを許可し、パス traversal を拒否する。

## client

- `client/state.ts` は `@fudo/ui-view` の reducer を包み、`{ blocks, liveText, pendingApproval, pendingAsk, running }` を持つ。
- `client/render.ts` は純粋に「画面モデル → HTML 文字列」を作る（unit テスト対象）。DOM へは `client/dom.ts` が差し込む。
- 入力欄は `<textarea>`。Enter で submit（Shift+Enter は改行）。承認は y/n ボタンとキー、ask は入力欄 Enter で回答。
- 接続が切れたら 1 秒後に開き直す（指数 backoff はしない）。サーバ側の stream は切断で終わり、再接続時に履歴を再購読する。

## エラー方針

- サーバは 127.0.0.1 のみに bind する。ポートが使えなければ 1 行 stderr に出して 1 で終了する。
- RPC のデコード失敗はその要求だけ落とし、接続は維持する（Effect の Protocol に任せる）。
- クライアントの `UiEvent` 解読失敗は画面に notice を出して捨てる。
- セッションの append 失敗で agent が止まる場合、events stream が終わる。クライアントは切断として見せる。

## テスト

| 層 | 内容 |
|---|---|
| Unit | render（HTML 断片・エスケープ）、state reducer、静的配信のパス検証 |
| transport | 実サーバ + Bun の `RpcClient`（global WebSocket）で submit → イベント、approve、cancel が通る |
| 本番経路 | stub LLM の `fudo web` を起動し、ヘッドレス Chrome でページを開いて描画と入力の反映を確かめる |

## 完了条件

1. `fudo web` が 127.0.0.1 に立ち、ブラウザで会話が読める。
2. ブラウザから入力したテキストが 1 turn になり、assistant のテキストが stream で伸びる。
3. 承認要求にブラウザから y/n で答えられ、ログに残る。
4. 複数タブが同じ会話を購読する。
5. Ctrl-C でサーバが終了し、ポートが閉じる。
6. 上記が stub / replay で API キー無しに再現できる。

## 未確認

- ブラウザ bundle に effect を含めたときの実サイズと起動時間。
- ヘッドレス Chrome で WebSocket 越しの描画をどの程度まで自動判定できるか。
- `Bun.build` の workspace 解決（`@fudo/ui-view` の TS を browser target で束ねられるか）。
