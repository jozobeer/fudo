# jozo-harness

汎用コーディングエージェントのハーネス。設計は [docs/superpowers/specs/2026-10-13-jozo-harness-kernel-design.md](docs/superpowers/specs/2026-10-13-jozo-harness-kernel-design.md)、設定できるものの全体は [docs/configuration.md](docs/configuration.md)、作業ごとの手順は [docs/how-to.md](docs/how-to.md) にある。

## リポジトリの見取り図

ワークスペースは `apps/`（実行するもの）と `packages/`（組み込むもの）に分かれる。

| 場所 | 何が入っているか |
|---|---|
| `apps/cli` | `jzh` 本体。引数の解釈、設定と鍵の読み込み、profile の組み立て、`config` / `auth` / `models` / `sessions` / `web` の入口 |
| `apps/tui` | 端末 UI。会話と承認・質問を 1 画面に描く |
| `apps/web` | ブラウザ UI。`src/server` が 127.0.0.1 で配り、`client/` を `pnpm run build:web` で `dist` に束ねる |
| `packages/kernel/kernel` | profile の解析・マージと plugin のローダ、hook |
| `packages/kernel/process` | 子プロセスを Node で動かす薄いラッパー（stdio・exit code・kill） |
| `packages/core/*` | agent と turn（`agent` / `agent-loop`）、session とそのログ（`session` / `session-jsonl`）、tool（`tools` / `tools-tier0` / `tools-tier1`）、許可と sandbox（`safety`）、system prompt（`system-prompt`）、scope |
| `packages/llm/*` | provider に依らない LLM の型（`llm`）と OpenAI 互換 adapter（`llm-openai`） |
| `packages/ui/*` | UI とコアの間の rpc の約束（`protocol`）、ログを会話に畳む共有の描画（`view`）、承認と質問の待ち合わせ（`host`） |
| `packages/bundle/base` | 同梱の `base` / `headless` / `repl` profile |
| `packages/test-support/replay` | 記録した SSE を再生する adapter（テストと snapshot 用） |
| `packages/test-support/stub` | テストが向ける HTTP スタブ（node:http の上で、ハンドラは web の Request / Response） |
| `scripts/` | `pnpm run check` の中身（doc / duplication / coverage の gate）と dsh との A/B |

`tools-tier1` が既定でモデルに渡すのは todo、`ask_user`、skill、`web_fetch`、`read_image`、job、goal、schedule、`working_directory`、`plugin` 行の編集である（MCP のツールは `@jozo-harness/mcp` の行があるとき、`web_search` は検索プロバイダを設定したときだけ加わる）。subagent と team は `subagents` を有効にした構成でのみ加わり、いまの CLI にはそれを有効にする指定が無い。TUI と Web は同じ `@jozo-harness/ui-view` を通してログを読むので、片方で書かれたログをもう片方でも同じ形で描ける。

## はじめかた

Node・pnpm・Rust と依存を入れる。[mise](https://mise.jdx.dev/) を使うと mise.toml が指す版が入る。

```sh
mise install
pnpm install
```

`jzh` をコマンドとして使うには、CLI のパッケージでグローバルリンクを張り、pnpm の global bin を PATH に足す。

```sh
(cd apps/cli && pnpm link --global)   # pnpm bin -g が指す場所に jzh が入る
export PATH="$(pnpm bin -g):$PATH"    # fish なら fish_add_path (pnpm bin -g)
jzh --help
```

リンクは作業ツリーを直接指すので、ソースの編集は次の実行からそのまま効く。外すときは `(cd apps/cli && pnpm unlink --global)` を実行する。

### API キー

Ollama Cloud のキーをリポジトリの `.env` に書くか、`jzh auth add ollama` で保存する。

```sh
cp .env.example .env   # OLLAMA_API_KEY=... を書く
```

`jzh auth add ollama` は `~/.config/jzh/secrets.env` にモード 600 で保存する。

### 使うモデルを決める

1. `jzh models` で使えるモデルを見る。プロバイダの `GET /models` を問い合わせ、`provider/model` の形で 1 行ずつ出す。
2. `jzh config set model <provider/model>` で書き、`jzh config` で入ったことを確かめる。設定ファイルが無ければ作られる。

### 動かす

```sh
jzh                                     # 端末 UI（TTY が要る）
jzh "Reply with the single word pong"   # 1 turn 走らせて終わる
jzh --json "..."                        # セッションイベントを JSON 行で出す
jzh --resume <sessionId>                # 過去のログを端末 UI に描く
jzh sessions                            # ログの一覧（新しい順）
jzh sessions <sessionId>                # 1 つのログを会話として読む
jzh --dump-config                       # 読み込んだプロファイルと、書ける設定キーを表示する
```

パイプから入力すると行単位の batch mode になる。TTY が無いところで端末 UI を強制するには `--tui` を付ける。

#### 端末 UI

会話・tool の呼び出しと結果・承認・質問を 1 画面に描く。↑/↓ は入力履歴、Ctrl-C は実行中の turn の cancel（idle なら終了）、Ctrl-D は終了。ホイールか PageUp/PageDown で会話を遡り、Esc で末尾に戻る（遡っている間は状態行に何行戻ったかが出る。マウスを要求している間のテキスト選択は Shift+ドラッグ）。承認が要る tool は `⚠ approve <tool>? [y/n]` と出るので y / n で答える。`ask_user` の質問には入力をそのまま Enter で答える。

#### Web UI

ブラウザ側を先に束ねる。初回と `apps/web/client/` を変えたときに走らせる。

```sh
pnpm run build:web    # apps/web/dist に束ねる
jzh web              # http://127.0.0.1:<port>/ を stderr に出す（--port で固定）
```

同じセッションを複数タブで購読できる。承認は Allow / Deny、質問は入力して Enter。サーバは 127.0.0.1 にだけ bind し、認証は無い。

セッションログは既定で `~/.jzh/sessions/<id>/session.v1.jsonl` に残る。設定ファイルのパスは `--config` で差し替えられる。

## 開発

変更したら `pnpm run check` を通す。fmt → lint → typecheck → doc gate → 重複検出 → complexity → テスト（coverage の床つき）の順に走る。`pnpm install` が pre-push hook を有効にし、push 前に test 以外の静的チェック（`pnpm run check:static`）が走る。同じ `pnpm run check` を GitHub Actions（[.github/workflows/check.yml](.github/workflows/check.yml)、macOS）が push と PR ごとに走らせるので、手元の hook は速いままにしてある。

```sh
pnpm run check
```

fmt・lint・型検査は Vite+ が `vp check` で束ねる（テストと gate まで含むのは `pnpm run check`）。設定は `vite.config.ts` の `fmt` / `lint` / `run` に閉じてあるので、Vite+ が邪魔をしたらその下の道具（Vitest / oxlint / oxfmt / tsdown）を devDependencies に足して直接呼ぶ道に切り替えられる。

## 参考元

jozo-harness の設計は [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（MIT、© DeepSeek）と、その基盤である [Cordis](https://github.com/cordiverse/cordis)（MIT、© Shigma）に基づく。両プロジェクトのライセンス表示は [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) にある。
