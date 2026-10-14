# fudo の設定

plugin ごとの config キー、フラグ、環境変数の一覧は `fudo --dump-config` がコードから出力する。

## 設定の層

行（plugin 1つぶんの設定）は4つの層を順に重ねる。同じ `id` の行は後ろの層が上書きし、`config` はキー単位でマージされる。

| 順 | 層 | 置き場 |
|---|---|---|
| 1 | 同梱の `base` profile | 常に読まれる |
| 2 | 選んだ profile | 同梱の `headless`（既定）または `repl` |
| 3 | 設定ファイルの `plugins` | `~/.config/fudo/config.yaml` |
| 4 | `--patch` | コマンドラインで渡すファイル（複数可） |

## 設定ファイル

既定のパスは `~/.config/fudo/config.yaml`。`--config` がパスを、`XDG_CONFIG_HOME` がディレクトリを差し替える。ファイルが無い場合は設定なしとして扱う。

| キー | 値 | 効果 |
|---|---|---|
| `model` | `provider/model` | 使うルート。`--model` > この値 > 行の `config.model` |
| `profile` | profile 名 | 層2で重ねる profile。既定は `headless`。`--profile` > この値 |
| `skills` | 文字列の配列 | `<name>/SKILL.md` を持つディレクトリ。1つ以上あると `skill` tool が付く |
| `plugins` | 行の配列 | 層3として重なる |

`profile` が指せるのは同梱の `base` / `headless` / `repl` だけである。同梱に無い名前は `no bundled profile named <name>` で起動が止まる。

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

同梱の plugin のうち `config` にキーを持つのは4つで、残りはキーを持たない。

| plugin | キー |
|---|---|
| `@fudo/session-jsonl` | `root`（必須）— セッションログのディレクトリ |
| `@fudo/safety` | `preset`（必須）— `read-only` / `workspace-write` / `full`、`sandbox` — `none` / `seatbelt`（macOS の sandbox-exec）、`writableRoots` — sandbox が書き込めるディレクトリ |
| `@fudo/llm-openai` | `baseUrl`（必須）、`apiKeyEnv`（必須）— キーを持つ環境変数の名前、`streamIdleTimeoutMs` — 1回の試行が無応答でいられる上限（ミリ秒、既定 300000） |
| `@fudo/mcp` | `command`（必須）、`prefix` |

同梱の `base` profile は `root` に `~/.fudo/sessions`、`preset` に `workspace-write`、`baseUrl` に `https://ollama.com/v1`、`apiKeyEnv` に `OLLAMA_API_KEY` を置いている。

`preset` が許す能力は `read-only` が読むだけ、`workspace-write` が読み書き、`full` が読み書きと実行とネットワークである。preset の外に出る呼び出しは承認要求になる。端末 UI と Web UI は y/n を尋ね、答える者がいない実行は拒否される。

`@fudo/mcp` は plugin として定義されているが、CLI が組み立てる plugin の一覧に入っていない。この行を書くと起動時に `row <id> names unknown plugin @fudo/mcp` で止まる。

## plugin の schema に無い行キー

次の3つは plugin の schema ではなく CLI が行から直接読む。`model` と `maxSpillBytes` は複数の行に書いた場合に最初の行が勝ち、`planMode` は1つの行でも `true` なら効く。

| キー | 置ける行 | 効果 |
|---|---|---|
| `model` | どの行でも | `provider/model`。`--model` と設定ファイルの `model` が無いときにルートになる |
| `maxSpillBytes` | どの行でも | tool の出力がこの大きさを超えたら、ファイルに退避して参照と要点だけをモデルに返す |
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

位置引数は1 turn のタスク、`models`（provider のモデル一覧）、`web`（ブラウザ UI）のいずれかである。

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

`--dump-config` は行を読み込んで検証しないので、未登録の plugin 名や必須キーの欠落は実行して初めて分かる。
