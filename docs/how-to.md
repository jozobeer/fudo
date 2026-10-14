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

`skills:` に `SKILL.md` を置いたディレクトリを並べる。

```yaml
skills:
  - ~/skills
```

`fudo config set` はリストを扱わないので、`fudo config` が出すパスのファイルを直接編集する。

## 書き込みと実行の許可を変える

`--patch` に渡すファイルで safety 行の `preset` を差し替える。

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
fudo config          # 設定ファイルのパスと、4キーの今の値
fudo --dump-config   # 行、plugin ごとのキー、フラグ、環境変数
```

`fudo config` に値が出なければ、そのキーは読まれていない。綴りは [configuration.md](configuration.md) の表と突き合わせる。`profile:` が指せるのは同梱の `base` / `headless` / `repl` だけである。
