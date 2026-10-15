# S1 受け入れ記録（2026-10-13）

この文書はその時点の記録である。パッケージのパスはその後 `packages/app/cli` → `apps/cli` に移り（本文は更新済み）、下の「未了」3 項目（実 API の 1 turn、Enter ごとの逐次対話、並列実行）はその後すべて済みである。現在の状況は [2026-10-13-v1-status.md](2026-10-13-v1-status.md) を正とする。

検査は bun run check（fmt:check → oxlint → tsc → test）。作業ツリーはクリーン。

## 完了条件ごとの証拠

| 条件 | 状態 | 証拠 |
|---|---|---|
| 1. jzh --profile headless の 1 turn 完走 | 実 API キー待ち（経路は実装済み） | apps/cli/src/{bin,run,index}.ts、apps/cli/tests/headless.test.ts |
| 2. --resume が復元した history で 2 turn 目を走る | 済 | apps/cli/tests/resume.test.ts |
| 3. tool 例外 / retry / cancel で対と turn/end.reason が正しい | 済 | packages/core/agent-loop/tests/loop.test.ts、apps/cli/tests/interrupt.test.ts |
| 4. 録画 fixture を API キー無しで実スタックに通す | 済 | packages/test-support/replay/、apps/cli/tests/replay.test.ts |
| 5. profile の合成・--dump-config・--patch・--profile | 済 | packages/bundle/base/tests/、apps/cli/tests/bin.test.ts と profile-flag.test.ts |
| 6. bun run check が緑 | 済 | 直近の実行で 0 fail |

## 未了（S1 の残り）

- 実 API での 1 turn（OLLAMA_API_KEY が要る）。
- Enter ごとの逐次対話 REPL。現在は入力の終端（TTY なら Ctrl-D）で 1 セッションを回す形。
- 連続する isConcurrencySafe な tool 呼び出しの並列実行。

## テスト資産の棚卸し

apps/cli/tests/bin.test.ts
apps/cli/tests/headless.test.ts
apps/cli/tests/interrupt.test.ts
apps/cli/tests/main-lines.test.ts
apps/cli/tests/profile-flag.test.ts
apps/cli/tests/repl.test.ts
apps/cli/tests/replay.test.ts
apps/cli/tests/resume.test.ts
apps/cli/tests/route.test.ts
apps/cli/tests/run.test.ts
packages/bundle/base/tests/assembly.test.ts
packages/bundle/base/tests/profile.test.ts
packages/bundle/base/tests/profiles.test.ts
packages/core/agent-loop/tests/loop.test.ts
packages/core/agent/tests/agents.test.ts
packages/core/agent/tests/inbox.test.ts
packages/core/agent/tests/plugin.test.ts
packages/core/scope/tests/scope.test.ts
packages/core/session-jsonl/tests/persistence.test.ts
packages/core/session-jsonl/tests/plugin.test.ts
packages/core/session/tests/codec.test.ts
packages/core/session/tests/derive.test.ts
packages/core/session/tests/json.test.ts
packages/core/session/tests/service-layer.test.ts
packages/core/session/tests/session.test.ts
packages/core/session/tests/sessions.test.ts
packages/core/system-prompt/tests/system-prompt.test.ts
packages/core/tools/tests/plugin.test.ts
packages/core/tools/tests/tools.test.ts
packages/kernel/kernel/tests/hooks.test.ts
packages/kernel/kernel/tests/loader.test.ts
packages/kernel/kernel/tests/toolchain.test.ts
packages/llm/llm-openai/tests/adapter.test.ts
packages/llm/llm-openai/tests/plugin.test.ts
packages/llm/llm-openai/tests/sse.test.ts
packages/llm/llm/tests/assembler.test.ts
packages/llm/llm/tests/assistant-stream.test.ts
packages/llm/llm/tests/schemas.test.ts
packages/test-support/replay/tests/replay.test.ts

## 環境の確認（2026-10-13）

- この環境には OLLAMA_API_KEY が設定されておらず、~/.jzh も無い。したがって条件 1 の実 API 実行はここでは行えない（キーを用意した環境で jzh --profile headless を実行し、この記録を更新する）。
