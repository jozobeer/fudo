# S7 TUI / S8 Web UI 受け入れ記録（2026-10-14）

この文書はその時点の受け入れ記録である。テスト数と、その後に足した差（commands / goal / schedule / workflow / team / plugin / sandbox の既定 / 承認の既定 / session の耐久性 / presentation / sessions）は [2026-10-13-v1-status.md](2026-10-13-v1-status.md) と [2026-10-14-dsh-gap-backlog.md](2026-10-14-dsh-gap-backlog.md) を正とする。

検査は `bun run check`（fmt:check → oxlint → tsc → typecheck:web → cccc → test）。直近は 418 tests / 130 files / 0 fail。

## S7 の完了条件ごとの証拠

| 条件 | 状態 | 証拠 |
|---|---|---|
| 1. TTY の jozo-harness が TUI を開き、1 セッションで入力→応答→次の入力 | 実端末以外で確認 | apps/cli/tests/tui-e2e.test.ts（stub LLM で入力→応答→ログ）、apps/cli/tests/tui-process.test.ts（実プロセス + --tui + Ctrl-D） |
| 2. 承認が画面に出て y/n がログに残る | 済 | tui-e2e.test.ts の承認ケース（画面に [y/n]、safety/approval/answered が approved=true、tool/result が isError=false） |
| 3. ask_user の質問と回答 | 済 | packages/ui/host/tests/host.test.ts（待ちと回答）、apps/tui/tests/state.test.ts（Enter が submit ではなく answer になる） |
| 4. Ctrl-C の cancel、Ctrl-D の終了と端末復元 | 済 | apps/tui/tests/state.test.ts、tui-e2e.test.ts（setRaw の on/off）、tui-process.test.ts（代替画面の入退場と終了コード 0） |
| 5. --resume の履歴描画 | 済 | tui-e2e.test.ts の resume ケース（前の user と assistant が画面に出る） |
| 6. subagent のイベントが混ざらない | 済 | packages/ui/host/tests/host.test.ts（別 session / 別 agent のイベントを捨てる。hook に session と agent を渡す形にした） |
| 7. API キー無しで再生できる | 済 | 上記はすべて stub LLM |

## S8 の完了条件ごとの証拠

| 条件 | 状態 | 証拠 |
|---|---|---|
| 1. jzh web が 127.0.0.1 に立ち、ブラウザで読める | 済 | apps/cli/tests/web-e2e.test.ts（RPC クライアント + 静的配信）、web-acceptance.ts（実 Chrome） |
| 2. ブラウザの入力が 1 turn になり、応答が stream で伸びる | 済 | web-acceptance.ts（Chrome が "run the command" を入力し、応答が DOM に出る） |
| 3. 承認要求にブラウザから y/n で答えられ、ログに残る | 済 | web-acceptance.ts（Allow を押して tool が走り、次の応答まで届く）、apps/web/tests/view.test.ts（Allow / Deny）、web-e2e.test.ts（command → 実 turn） |
| 4. 複数タブが同じ会話を購読する | 済 | apps/web/tests/server.test.ts の two tabs ケース（2 接続が同じ 1 イベントを受け取る） |
| 5. Ctrl-C でサーバが終了し、ポートが閉じる | 済 | web-e2e.test.ts（interrupt で 130 を返す）、serveWeb の finalizer が server.stop(true) を呼ぶ |
| 6. 上記が stub で API キー無しに再現できる | 済 | 上記はすべて stub LLM |

## 実走の記録（2026-10-14）

- ブラウザ受け入れ: `cd apps/cli && bun run tests/web-acceptance.ts`。実 Chrome（headless）がページを開き、メッセージを入力し、承認プロンプトで Allow を押し、DOM に次の応答が出た。証跡画像は `.tmp/web-evidence.png`（.tmp は git 管理外）。最後の 1 行は `ACCEPTANCE PASS`。
- 端末 UI の実走: `--tui` を付けた実プロセスへ Ctrl-D をパイプで送り、代替画面の入退場と終了コード 0 を確認（apps/cli/tests/tui-process.test.ts）。
- ブラウザ側の bundle は 156 KB（minify 後、effect/rpc のクライアントを含む）。

## 環境の制約（未確認）

- この環境の sandbox は PTY の確保を拒否する（`script` も `expect` も openpty に失敗する）。そのため実端末での TUI の目視は行っていない。実端末では `jzh` を実行すれば同じ runTui 経路が開く。
- Ollama Cloud の実 API は使っていない。UI の受け入れは設計どおり stub LLM で完結する。
- compaction が実際に発火する長い履歴での観測は S4 から持ち越し。

## テスト資産（S7/S8 で増えた分）

- packages/ui/protocol/tests/protocol.test.ts
- packages/ui/view/tests/{conversation,text}.test.ts
- packages/ui/host/tests/host.test.ts
- apps/tui/tests/{editor,keys,render,state,wrap}.test.ts
- apps/cli/tests/{tui-e2e,tui-process,web-e2e}.test.ts
- apps/web/tests/{server,static,view}.test.ts
- apps/cli/tests/web-acceptance.ts（テストランナーの外で走らせる受け入れ道具）
