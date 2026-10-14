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

```
.fudo/skills/<name>/SKILL.md   作業ディレクトリの中（ほかの作業ディレクトリへは効かない）
~/.fudo/skills/<name>/SKILL.md 自分のマシン全体
```

`SKILL.md` の先頭に frontmatter を置く。

```markdown
---
name: release
description: リリース手順を踏むときに読む
---

手順の本文。
```

`description` はセッション開始時にモデルへ配る一覧に載る。`name` と `description` の無いファイルは無視される。別のディレクトリを足す場合は設定ファイルに書く。

```sh
fudo config add skills ~/skills     # <name>/SKILL.md を持つディレクトリ
fudo config remove skills ~/skills  # 外す
fudo config                         # 入ったことを確かめる
```

同じディレクトリを二度足しても増えない。

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

## モデルにプラグイン行を直させる

モデルは `plugin` ツールで settings の `plugins` 行を list / add / remove / disable できる。1 回ごとに承認を求められ、効くのは**次の起動から**である（走っているプロセスの構成は変わらない）。足せるのは同梱のパッケージ名だけ。

```
plugin list                     この run が組まれた行
plugin add id=mcp name=@fudo/mcp
plugin set id=mcp disabled=true
```

行が増えると構成が変わるので、そのセッションを続けるには `--allow-preset-change` が要る（[構成を変えてセッションを再開する](#構成を変えてセッションを再開する)）。

## 構成を変えてセッションを再開する

セッションは、始めたときの profile 名と tool の一覧を覚えている。違う構成で再開すると、turn を始める前に拒否され、違う点が stderr に出る。

```sh
fudo --resume <sessionId> "続き"                          # 同じ構成なら続く
fudo --resume <sessionId> --allow-preset-change "続き"     # 意図して変える（新しい構成を記録する）
```

## セッションに話しかけずに尋ねる（コマンド）

REPL・TUI・Web では、行頭が `/` の行はコマンドとしてその場で答える。モデルの turn は消費せず、`command/run` と `command/done` としてログに残る。

```
/help     使えるコマンドを並べる
/status   このセッションの居場所（モデル、cwd、turn 数、goal、schedule）
```

知らない名前は登録済みの一覧を返す。コマンドの答えは TUI と Web では会話の notice として出る。

## 設定が効かないときに見る

```sh
fudo config          # 設定ファイルのパス、4キーの今の値、リストの中身
fudo --dump-config   # 行、plugin ごとのキー、フラグ、環境変数
```

`fudo config` に値が出なければ、そのキーは読まれていない。綴りは [configuration.md](configuration.md) の表と突き合わせる。`profile:` が指せるのは同梱の `base` / `headless` / `repl` だけである。
