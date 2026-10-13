# S1 受け入れ記録（2026-10-13）

検査は bun run check（fmt:check → oxlint → tsc → test）。作業ツリーはクリーン。

## 完了条件ごとの証拠

| 条件 | 状態 | 証拠 |
|---|---|---|
| 1. fudo --profile headless の 1 turn 完走 | 実 API キー待ち（経路は実装済み） | packages/app/cli/src/{bin,run,index}.ts、packages/app/cli/tests/headless.test.ts |
| 2. --resume が復元した history で 2 turn 目を走る | 済 | packages/app/cli/tests/resume.test.ts |
| 3. tool 例外 / retry / cancel で対と turn/end.reason が正しい | 済 | packages/core/agent-loop/tests/loop.test.ts、packages/app/cli/tests/interrupt.test.ts |
| 4. 録画 fixture を API キー無しで実スタックに通す | 済 | packages/test-support/replay/、packages/app/cli/tests/replay.test.ts |
| 5. profile の合成・--dump-config・--patch・--profile | 済 | packages/bundle/base/tests/、packages/app/cli/tests/bin.test.ts と profile-flag.test.ts |
| 6. bun run check が緑 | 済 | 直近の実行で 0 fail |

## 未了（S1 の残り）

- 実 API での 1 turn（OLLAMA_API_KEY が要る）。
- Enter ごとの逐次対話 REPL。現在は入力の終端（TTY なら Ctrl-D）で 1 セッションを回す形。
- 連続する isConcurrencySafe な tool 呼び出しの並列実行。

## テスト資産の棚卸し

packages/app/cli/tests/bin.test.ts
packages/app/cli/tests/headless.test.ts
packages/app/cli/tests/interrupt.test.ts
packages/app/cli/tests/main-lines.test.ts
packages/app/cli/tests/profile-flag.test.ts
packages/app/cli/tests/repl.test.ts
packages/app/cli/tests/replay.test.ts
packages/app/cli/tests/resume.test.ts
packages/app/cli/tests/route.test.ts
packages/app/cli/tests/run.test.ts
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

- この環境には OLLAMA_API_KEY が設定されておらず、~/.fudo も無い。したがって条件 1 の実 API 実行はここでは行えない（キーを用意した環境で fudo --profile headless を実行し、この記録を更新する）。
