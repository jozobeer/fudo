# fudo の設定

plugin ごとの config キー、フラグ、環境変数の一覧は `fudo --dump-config` がコードから出力する。作業ごとの手順は [how-to.md](how-to.md) にある。

## 設定の層

行（plugin 1つぶんの設定）は4つの層を順に重ねる。同じ `id` の行は後ろの層が上書きし、`config` はキー単位でマージされる。

| 順 | 層 | 置き場 |
|---|---|---|
| 1 | 同梱の `base` profile | 常に読まれる |
| 2 | 選んだ profile | 同梱の `headless`（既定）または `repl` |
| 3 | 設定ファイルの `plugins` | `~/.config/fudo/config.yaml` |
| 4 | `--patch` | コマンドラインで渡すファイル（複数可） |

## 設定ファイル

既定のパスは `~/.config/fudo/config.yaml`。`--config` がパスを、`XDG_CONFIG_HOME` がディレクトリを差し替える。ファイルが無い場合、空の場合、コメントだけの場合はいずれも設定なしとして扱う。

| キー | 値 | 効果 |
|---|---|---|
| `model` | `provider/model` | 使うルート。`--model` > この値 > 行の `config.model` |
| `profile` | profile 名 | 層2で重ねる profile。既定は `headless`。`--profile` > この値 |
| `skills` | 文字列の配列 | `<name>/SKILL.md` を持つディレクトリを追加する。```/x``` は展開する |
| `plugins` | 行の配列 | 層3として重なる |

`profile` が指せるのは同梱の `base` / `headless` / `repl` だけである。同梱に無い名前は `no bundled profile named <name>` で起動が止まる。

`skills` は追加の探索先である。`skill` tool は常に次の順で探し、同じ名前は先の根が勝つ。

| 順 | ディレクトリ |
|---|---|
| 1 | `<workspace>/.fudo/skills` |
| 2 | `skills` に書いた順 |
| 3 | `<fudo home>/skills`（既定 `~/.fudo/skills`） |

`SKILL.md` は YAML frontmatter に `name` と `description` を必ず持つ。欠けたファイルは一覧にも読込にも現れない。セッションの開始時に、見つかった skill の一覧がモデルへ届く。

## 行

行は profile と `--patch` の YAML に `plugins:` の配列として書く。持てるキーは4つ。

| キー | 必須 | 効果 |
|---|---|---|
| `id` | はい | 層をまたぐマージの単位 |
| `name` | はい | plugin 名 |
| `config` | いいえ | plugin が受け取る設定 |
| `disabled` | いいえ | `true` でその行を外す |

YAML では plugin 名を引用する（`name: '@fudo/safety'`）。`@` で始まる値はプレーンな scalar として解釈できない。

## plugin が受け取る config キー

同梱の plugin のうち `config` にキーを持つのは5つで、残りはキーを持たない。

| plugin | キー |
|---|---|
| `@fudo/session-jsonl` | `root`（必須）— セッションログのディレクトリ |
| `@fudo/safety` | `preset`（必須）— `read-only` / `workspace-write` / `full`、`sandbox` — `none` / `seatbelt`（macOS の sandbox-exec）、`writableRoots` — sandbox が書き込めるディレクトリ |
| `@fudo/llm-openai` | `baseUrl`（必須）、`apiKeyEnv`（必須）— キーを持つ環境変数の名前、`streamIdleTimeoutMs` — 1回の試行が無応答でいられる上限（ミリ秒、既定 300000） |
| `@fudo/agent-loop` | `keepLast` — 末尾で内容を置き換えないメッセージ数（既定 12）、`maxBytes` — これを超える text block を、末尾 `keepLast` の外でスタブに置き換える（バイト、既定 32000） |
| `@fudo/mcp` | `command`（必須）、`prefix` |

同梱の `base` profile は `root` に `~/.fudo/sessions`、`preset` に `workspace-write`、`baseUrl` に `https://ollama.com/v1`、`apiKeyEnv` に `OLLAMA_API_KEY` を置いている。

`preset` が許す能力は `read-only` が読むだけ、`workspace-write` が読み書き、`full` が読み書きと実行とネットワークである。preset の外に出る呼び出しは承認要求になる。端末 UI と Web UI は y/n を尋ね、答える者がいない実行は拒否される。

`@fudo/mcp` の行は MCP サーバを起動し、その tool を `prefix`（既定 `mcp__`）を頭に付けて登録する。

## plugin の schema に無い行キー

次の3つは plugin の schema ではなく CLI が行から直接読む。`model` と `maxSpillBytes` は複数の行に書いた場合に最初の行が勝ち、`planMode` は1つの行でも `true` なら効く。

| キー | 置ける行 | 効果 |
|---|---|---|
| `model` | どの行でも | `provider/model`。`--model` と設定ファイルの `model` が無いときにルートになる |
| `maxSpillBytes` | どの行でも | tool の出力がこの大きさを超えたら、ファイルに退避して参照と要点だけをモデルに返す。退避先は fudo home の `spill/<sessionId>/`（0700、7日で掃除）、fudo home が無ければ一時ディレクトリ。`read` の結果は対象外で、注記のパスを `read` の offset/limit で読み直せる |
| `planMode` | `@fudo/safety` の行 | `true` でワークスペースを変える tool を外す |

## コマンドライン

| フラグ | 効果 |
|---|---|
| `--model <provider/model>` | ルートを決める |
| `--profile <name>` | 層2の profile |
| `--patch <file.yml>` | 層4の行。複数回で複数ファイル |
| `--config <file.yml>` | 設定ファイルのパス |
| `--resume <sessionId>` | 過去のセッションを開く |
| `--port <N>` | `fudo web` のポート。0 は空きポート |
| `--json` | セッションイベントを JSON 行で出す |
| `--tui` | パイプ越しでも端末 UI を開く |
| `--dump-config` | 設定面を出力して終わる |
| `--help` | 使い方を出力して終わる |

サブコマンドは `models`（provider のモデル一覧）、`web`（ブラウザ UI）、`config`（設定の表示と書き込み）、`auth`（秘密の保存）である。それ以外の位置引数は1 turn のタスクになる。

`fudo config` は引数なしで今の設定を表示する。書き込みは次の通りで、いずれも書く前に schema で検証し、ファイルのコメントと他のキーは残す。

| 書き方 | 効果 |
|---|---|
| `fudo config set model <provider/model>` | `model` を書く。`profile` も同じ形 |
| `fudo config set plugins.<id>.<key> <value>` | その行のキーを書く。同梱 profile の行を指すと差分の行を作る。`disabled` は行の項目として書く |
| `fudo config add skills <dir>` | `skills` にディレクトリを足す |
| `fudo config add plugins <name>` | 行を足す。`id` は名前から作り（`@fudo/mcp` → `mcp`）、`--id` で決められる |
| `fudo config remove skills <dir>` | `skills` から外す |
| `fudo config remove plugins <id>` | 設定ファイルの行を外す。同梱 profile の行は外せない |
| `fudo config init` | 全キーをコメントで並べたファイルを作る |

値は YAML として読む。配列を書くときは flow 形式（`'["npx", "-y", "server"]'`）で1つの引数として渡す。

## 環境変数

| 変数 | 効果 |
|---|---|
| `OLLAMA_API_KEY` / `OPENAI_API_KEY` | provider のキー。名前は行の `apiKeyEnv` が決める |
| `BRAVE_API_KEY` | あると `web_search` tool が付く |
| `XDG_CONFIG_HOME` | `config.yaml` と `secrets.env` を置くディレクトリ |

優先順位はシェル環境、作業ディレクトリに近い `.env`、`secrets.env` の順である。先に値がある場所が勝ち、後ろは空いているキーだけを埋める。

## ファイルの置き場

| 何 | どこ | 変え方 |
|---|---|---|
| 設定 | `~/.config/fudo/config.yaml` | `--config`、`XDG_CONFIG_HOME` |
| 秘密 | `~/.config/fudo/secrets.env`（モード 600） | `fudo auth add` / `set` / `remove` / `list` |
| セッションログ | `~/.fudo/sessions/<id>/session.v1.jsonl` | `@fudo/session-jsonl` 行の `root` |
| Web UI | `127.0.0.1` のみ | `--port` |

## 設定できないもの

- provider の能力（tool の強制なし、画像なし、reasoning effort なし、prompt cache 制御なし）は adapter に固定されている
- Web UI の bind 先は `127.0.0.1` に固定されている
- セッションログの形式は `session.v1.jsonl` に固定されている
- tool ごとの実行時間の上限は tool の定義側にある

## 読み込みの失敗

| 起きること | いつ | 結果 |
|---|---|---|
| 知らないキー | 設定ファイル、行の `config` | 無視される |
| どの層にも `model` が無い | 実行 | 起動が止まる（`no model is set`） |
| YAML が壊れている | 設定ファイル、profile、`--patch` | 起動が止まる（`settings are not valid YAML` など） |
| 知らない plugin 名 | 行の `name` | 起動が止まる（`unknown-plugin`） |
| 必須キーが無い | 行の `config` | 起動が止まる（`config`） |
| 1つの service を2つの行が提供する | 行の `provides` | 起動が止まる（`duplicate-provider`） |
| 依存が循環する | 行の `requires` | 起動が止まる（`dependency-cycle`） |

`--dump-config` は行を読み込んで検証しないので、未登録の plugin 名や必須キーの欠落は実行して初めて分かる。`fudo config set` は書き込む前に plugin の schema で値を検証するので、起動時に無視される行の `config` の知らないキーも、ここでは拒否される。
