# 設定の手順

キーの一覧と意味は [configuration.md](configuration.md) にある。

## モデルを変える

```sh
fudo models                                  # 使えるモデルを見る
fudo config set model ollama-cloud/glm-5.3   # 既定を書き換える
fudo config                                  # 入ったことを確かめる
```

1回だけ変えるなら `--model` を付ける。

```sh
fudo --model ollama-cloud/gemma4:31b "Reply with the single word pong"
```

## 設定ファイルを雛形から始める

```sh
fudo config init    # 全キーをコメントで並べたファイルを作る
fudo config         # 値が入ったかを確かめる
```

`fudo config` が出すパスのファイルを開き、使う行の `#` を外す。

## API キーを入れる

```sh
fudo auth add ollama   # 端末に打つ。シェルの履歴に残らない
fudo auth list         # 入っている名前を見る
```

`.env` に書く場合は `OLLAMA_API_KEY=` を作業ディレクトリかその祖先に置く。どれが勝つかは [configuration.md](configuration.md) の環境変数の節にある。

## スキルを読ませる

`SKILL.md` を置いたディレクトリを登録する。

```sh
fudo config add skills ~/skills     # <name>/SKILL.md を持つディレクトリ
fudo config remove skills ~/skills  # 外す
fudo config                         # 入ったことを確かめる
```

同じディレクトリを二度足しても増えない。`skills` が1つ以上あると `skill` tool が付く。

## 書き込みと実行の許可を変える

同梱 `base` profile の `safety` 行に、変えたいキーだけを重ねる。

```sh
fudo config set plugins.safety.preset full
fudo config                                             # 入ったことを確かめる
```

`plugins.safety.preset` は「id が `safety` の行の `preset`」の意味で、`sandbox` のような他のキーは同梱の値のまま残る。1回の実行だけ変えるなら `--patch` に渡すファイルで同じ行を書く。

```yaml
name: full
plugins:
  - id: safety
    name: '@fudo/safety'
    config:
      preset: full
```

```sh
fudo --patch full.yml "…"
fudo --dump-config --patch full.yml   # 効いた行を確かめる
```

## MCP サーバを繋ぐ

行を足し、`command` に起動コマンドを配列で渡す。

```sh
fudo config add plugins @fudo/mcp
fudo config set plugins.mcp.command '["npx", "-y", "@modelcontextprotocol/server-filesystem", "/tmp"]'
fudo config set plugins.mcp.prefix 'fs__'   # 省略すると mcp__
```

サーバの tool は `prefix` を頭に付けて登録される。行を消すときは `fudo config remove plugins mcp`。

## セッションログの置き場を変える

```yaml
name: sessions
plugins:
  - id: session-jsonl
    name: '@fudo/session-jsonl'
    config:
      root: ~/work/fudo-sessions
```

```sh
fudo --patch sessions.yml "…"
```

## 設定が効かないときに見る

```sh
fudo config          # 設定ファイルのパス、4キーの今の値、リストの中身
fudo --dump-config   # 行、plugin ごとのキー、フラグ、環境変数
```

`fudo config` に値が出なければ、そのキーは読まれていない。綴りは [configuration.md](configuration.md) の表と突き合わせる。`profile:` が指せるのは同梱の `base` / `headless` / `repl` だけである。
