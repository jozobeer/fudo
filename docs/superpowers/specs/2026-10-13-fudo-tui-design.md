# fudo 設計: S7 TUI と UI の共通継ぎ目

S1 のイベントを描画する端末 UI。行単位の REPL はここで置き換える。S8 のブラウザ UI と同じプロトコルで核を使う。

## 目的と範囲

- 端末で引数なしの `fudo` が全画面 TUI を開く。1 セッション上で複数 turn を回す。
- 描くもの: 人の入力、assistant のテキスト（stream 中含む）、tool call と結果、承認要求と回答、ask_user、turn の失敗、状態行。
- 操作: 入力編集（履歴・カーソル）、承認の y/n、ask の回答、Ctrl-C で turn の cancel、Ctrl-D で終了、`--resume` で履歴表示。
- やらない: マウス、複数セッションの並置、添付、テーマ設定。行単位の lines 経路は非 TTY の batch mode として残す（テストと配管が使う）。

## 継ぎ目（UI と核の境界）

核の公開面は直列化できるイベントとコマンドに限る。UI は関数やクロージャを受け取らない。S7 は同一プロセス、S8 は WebSocket 越しに、同じ型を使う。

```ts
// packages/ui/protocol
type UiCommand =
  | { kind: 'submit'; text: string }
  | { kind: 'approve'; callId: string; approved: boolean }
  | { kind: 'answer'; id: string; answer: string }
  | { kind: 'cancel' }

type UiEvent =
  | { kind: 'session'; event: SessionEvent }   // 追記された session event（購読時の履歴も同じ形で流す）
  | { kind: 'stream'; chunk: TimedStreamChunk } // 実行中の assistant stream
```

- 履歴は購読時に `session.events()` を `session` イベントとして流す。live との境界で同じイベントが二度流れうるので、UI は `seq` で重複を捨てる。
- 承認と ask は session イベント（`safety/approval/requested` など）として届く。UI は要求を見てコマンドで答える。
- 状態（idle / running）は `turn/start` と `turn/end` から導出する。専用の状態イベントは持たない。

### 出所の分離

hook はアプリ全体で 1 つなので、subagent のイベントも同じ registry に流れる。UI は主 agent のものだけを描く。

- `session/event` の listener は第 2 引数に `Session` を受け取る（既存 listener は無視できる後方互換の追加）。
- `agent/assistant-stream` の listener は第 2 引数に `Agent` を受け取る。
- `makeUiHost` は主 agent の session / agent と一致するときだけ publish する。

## 構成

| 置き場 | 名前 | 責務 |
|---|---|---|
| `packages/ui/protocol` | `@fudo/ui-protocol` | UiCommand / UiEvent と Schema。effect のデータ型のみ |
| `packages/ui/host` | `@fudo/ui-host` | 主 agent と UI をつなぐ。events の配信、コマンドの実行、承認・ask の回答箱 |
| `packages/ui/view` | `@fudo/ui-view` | 会話モデル（event → 表示ブロック）。純粋関数。TUI と S8 の client が共有 |
| `apps/tui` | `@fudo/tui` | 状態 reducer、行の描画、キー解読、入力編集、端末 seam、`runTui` |

`packages/` は `apps/` に依存しない。`apps/tui` は protocol / host / view に依存する。

### makeUiHost

```ts
interface UiHost {
  readonly events: Stream.Stream<UiEvent>
  readonly submit: (text: string) => Effect.Effect<void, SessionError>
  readonly approve: (callId: string, approved: boolean) => Effect.Effect<void>
  readonly answer: (id: string, answer: string) => Effect.Effect<void>
  readonly cancel: () => Effect.Effect<void>
  // installApproval / installAsk に渡す回答者
  answerApproval(request: ApprovalRequested): Effect.Effect<boolean>
  answerAsk(request: AskRequested): Effect.Effect<string>
}
makeUiHost(input: {
  session: Session
  agent: Agent
  hooks: HookRegistry
}): Effect.Effect<UiHost, never, Scope.Scope>
```

- `events` は購読者ごとのキューに配る。購読ごとに履歴 → live の順で流す。
- 承認と ask の待ちは、要求イベントがログに載った時点で listener が作る。回答コマンドは、待ちがまだ読まれていなくても解決できる（解決済みの Deferred を後から読む）。待ちの後始末は answered イベントが行う。
- `installApproval` には `answerApproval` を渡す（`Approval` service は使わない）。`installAsk` にも `answerAsk` を渡す。

## データフロー

```
fudo（TTY・引数なし）
  → bin.ts が端末 seam を作り、runCommand({ work: { kind: 'tui', io } })
  → runSession: layer 構築 → agent 作成 → makeUiHost
      → installTier1(answerAsk) / installSafety(answerApproval)
      → serveAgent が runTui(host, io)
  → キー → UiCommand / UI 状態
  → UiEvent → reducer → 画面
```

## 状態と描画

- `ConversationBlock`（`@fudo/ui-view`）: `user` / `assistant` / `tool`（name・引数の要約・状態・結果の要約）/ `notice`（承認・ask・エラー）。
- `applyEvent(state, event)` は純粋。`seq` で重複を捨てる。assistant の stream delta は `stream` バッファへ足し、`assistant/message` が来たら確定ブロックに置き換える。
- `render(state, size)` は `rows` 行の文字列を返す純粋関数。0 行目は状態行、最終行は入力行、間が会話。
- 折り返しは表示幅で行う（East Asian Wide は 2 桁）。ANSI エスケープは色付けのみで、描画結果には含めてよい。
- モーダル: 未回答の承認があれば 1 行の y/n プロンプト、未回答の ask があれば質問と選択肢を出し、Enter は「新しい入力」ではなく回答になる。

## キー操作

| キー | 動作 |
|---|---|
| 文字 | 入力に追加 |
| Enter | submit（ask 待ちなら answer） |
| Backspace / Delete | 削除 |
| ← / → / Home / End | カーソル |
| ↑ / ↓ | 入力履歴 |
| Ctrl-C | turn 実行中なら cancel、idle なら終了 |
| Ctrl-D | 終了（0） |
| y / n | 未回答の承認があるとき回答 |
| Esc | 承認プロンプトを閉じる（保留のまま） |

## エラー方針

- 端末の復元は finalizer で必ず行う（raw mode 解除、代替画面を出る、カーソル表示）。SIGINT でも finalizer が走る。
- 画面サイズが取れないときは 80x24 を既定にする。
- キーの解読に失敗したら、そのバイト列を捨てて次のキーへ進む（UI を止めない）。
- host の submit が失敗したら notice ブロックに出す。turn の失敗は `turn/end.reason` から notice にする。
- 端末が TTY でないときに TUI を要求されたら、1 行 stderr に出して 2 で終了する。

## テスト

| 層 | 内容 |
|---|---|
| Unit | view の reducer（重複 seq・stream の確定・tool の状態遷移）、描画の折り返しと行数、キー解読、入力編集、モーダル遷移 |
| 統合 | 偽端末 + stub LLM で `runTui` を回し、書き込み内容とコマンド列を見る。承認 y/n、Ctrl-C の cancel、Ctrl-D の終了コード |
| 本番経路 | `script`(1) などの PTY で `fudo` を起動し、代替画面と描画を実際の端末から観測する |

## 完了条件

1. TTY の `fudo` が TUI を開き、入力 → assistant の応答 → 次の入力が 1 セッションで回る。
2. 承認要求が画面に出て、y で実行・n で拒否が session ログに残る。
3. ask_user の質問が画面に出て、入力した回答がログに残る。
4. Ctrl-C で実行中 turn が cancelled で終わり、Ctrl-D で端末が元に戻って終了コード 0 になる。
5. `--resume` で過去の会話が描画される。
6. subagent のイベントが TUI に混ざらない。
7. 上記が API キー無しの replay / stub で再生できる。

## 未確認

- Bun の `process.stdin.setRawMode` と `process.stdout.columns` の挙動（PTY で確認する）。
- 1 行ずつの再描画で実用の速さが出るか（差分描画が要るか）。
- 端末幅の計算に使う Wide 判定の範囲（まずは既知の CJK レンジで足りるか）。
