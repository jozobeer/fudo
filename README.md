# fudo

汎用コーディングエージェントのハーネス。設計は [docs/superpowers/specs/2026-10-13-fudo-kernel-design.md](docs/superpowers/specs/2026-10-13-fudo-kernel-design.md) にある。

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

`fudo auth add ollama` は `~/.config/fudo/secrets.env` にモード 600 で保存する。両方にあるときは `.env` の値が使われる。シェル環境の値はどちらにも上書きされない。

### 使うモデル

使えるモデルは `fudo models` で一覧できる。プロバイダの `GET /models` を問い合わせ、`provider/model` の形で 1 行ずつ出す。

既定のモデルは `~/.config/fudo/config.yaml` に書く。

```yaml
model: ollama-cloud/deepseek-v4.1-flash
```

モデルは `--model`、設定ファイル、プロファイルの順に探す。どれにも無ければ `no model is set` で止まる。

### 動かす

```sh
fudo "Reply with the single word pong"   # 1 turn 走らせて終わる
fudo --json "..."                        # セッションイベントを JSON 行で出す
fudo --dump-config                       # 読み込んだプロファイルを表示する
```

セッションログは既定で `~/.fudo/sessions/<id>/session.v1.jsonl` に残る。設定ファイルのパスは `--config` で差し替えられる。

## 開発

変更したら `bun run check` を通す。fmt → lint → typecheck → complexity → test の順に走る。`bun install` が pre-push hook を有効にし、push 前に test 以外の静的チェック（`bun run check:static`）が走る。

```sh
bun run check
```

## 参考元

fudo の設計は [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（MIT、© DeepSeek）と、その基盤である [Cordis](https://github.com/cordiverse/cordis)（MIT、© Shigma）に基づく。両プロジェクトのライセンス表示は [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) にある。
