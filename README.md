# fudo

汎用コーディングエージェントのハーネス。設計は [docs/superpowers/specs/2026-10-13-fudo-kernel-design.md](docs/superpowers/specs/2026-10-13-fudo-kernel-design.md)、設定できるものの全体は [docs/configuration.md](docs/configuration.md)、作業ごとの手順は [docs/how-to.md](docs/how-to.md) にある。

## はじめかた

Bun と依存を入れる。[mise](https://mise.jdx.dev/) を使うと mise.toml が指す版の Bun が入る。

```sh
mise install
bun install
```

`fudo` をコマンドとして使うには、CLI のパッケージでグローバルリンクを張り、`~/.bun/bin` を PATH に足す。

```sh
(cd apps/cli && bun link)   # ~/.bun/bin/fudo がこのリポジトリを指す
export PATH="$HOME/.bun/bin:$PATH"  # fish なら fish_add_path ~/.bun/bin
fudo --help
```

リンクは作業ツリーを直接指すので、ソースの編集は次の実行からそのまま効く。外すときは `(cd apps/cli && bun unlink)` を実行する。

### API キー

Ollama Cloud のキーをリポジトリの `.env` に書くか、`fudo auth add ollama` で保存する。

```sh
cp .env.example .env   # OLLAMA_API_KEY=... を書く
```

`fudo auth add ollama` は `~/.config/fudo/secrets.env` にモード 600 で保存する。

### 使うモデルを決める

1. `fudo models` で使えるモデルを見る。プロバイダの `GET /models` を問い合わせ、`provider/model` の形で 1 行ずつ出す。
2. `fudo config set model <provider/model>` で書き、`fudo config` で入ったことを確かめる。設定ファイルが無ければ作られる。

### 動かす

```sh
fudo                                     # 端末 UI（TTY が要る）
fudo "Reply with the single word pong"   # 1 turn 走らせて終わる
fudo --json "..."                        # セッションイベントを JSON 行で出す
fudo --resume <sessionId>                # 過去のログを端末 UI に描く
fudo --dump-config                       # 読み込んだプロファイルと、書ける設定キーを表示する
```

パイプから入力すると行単位の batch mode になる。TTY が無いところで端末 UI を強制するには `--tui` を付ける。

#### 端末 UI

会話・tool の呼び出しと結果・承認・質問を 1 画面に描く。↑/↓ は入力履歴、Ctrl-C は実行中の turn の cancel（idle なら終了）、Ctrl-D は終了。承認が要る tool は `⚠ approve <tool>? [y/n]` と出るので y / n で答える。`ask_user` の質問には入力をそのまま Enter で答える。

#### Web UI

ブラウザ側を先に束ねる。初回と `apps/web/client/` を変えたときに走らせる。

```sh
bun run build:web     # apps/web/dist に束ねる
fudo web              # http://127.0.0.1:<port>/ を stderr に出す（--port で固定）
```

同じセッションを複数タブで購読できる。承認は Allow / Deny、質問は入力して Enter。サーバは 127.0.0.1 にだけ bind し、認証は無い。

セッションログは既定で `~/.fudo/sessions/<id>/session.v1.jsonl` に残る。設定ファイルのパスは `--config` で差し替えられる。

## 開発

変更したら `bun run check` を通す。fmt → lint → typecheck → complexity → test の順に走る。`bun install` が pre-push hook を有効にし、push 前に test 以外の静的チェック（`bun run check:static`）が走る。

```sh
bun run check
```

## 参考元

fudo の設計は [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（MIT、© DeepSeek）と、その基盤である [Cordis](https://github.com/cordiverse/cordis)（MIT、© Shigma）に基づく。両プロジェクトのライセンス表示は [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) にある。
