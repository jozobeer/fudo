# fudo 設計: 全体構成と S1 Kernel

fudo は、自分が日常的に使う汎用コーディングエージェントのハーネスである。設計は [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（以下 dsh）の思想を移植し、Cordis に依存せず、一人で全体を把握できる規模に保つ。この文書は全体の分割と、最初のサブプロジェクト S1 の設計を定める。

## 目的と前提

fudo を dsh のプラグインとして作らず独自に作る理由は三つある。中身を隅々まで把握して自分の判断で育てられること、Cordis と dsh の規模に縛られない技術スタックを選べること、モデルとプロバイダを自由に選べること、である。

- 言語とランタイム: TypeScript と Bun。プロバイダ SDK や MCP SDK の層が厚く、dsh の実装と読み比べながら作れる。Rust は単一バイナリ配布で勝るが、プラグインの動的ロードに WASM か子プロセスが要る
- 最初のモデル接続先: Ollama Cloud の OpenAI 互換 API（`https://ollama.com/v1`、`Authorization: Bearer $OLLAMA_API_KEY`）。Anthropic adapter は S1 の後に追加する
- 開発環境: macOS。sandbox backend は最終的に macOS・Linux・Windows に対応するが、v1 では macOS だけを実装する

未決の事項は dsh に準拠する。dsh から外す・簡略化するものは、理由とともにこの文書に書く。

## 全体の分割

v1 は、dsh の base bundle と同等のツールセットを日常のコーディングで評価できる状態を指す。v1 は S1 から S6 で構成し、各サブプロジェクトが独立に spec・計画・実装のサイクルを持つ。

| ID | 範囲 |
|---|---|
| S1 Kernel | プラグイン機構、session log、agent loop、LLM seam と OpenAI 互換 adapter、tool registry と実行 pipeline、system prompt の組み立て、最小の Headless CLI |
| S2 Safety | approval、sandbox seam と macOS Seatbelt provider、sandbox policy、permission preset、escalation |
| S3 Tier 0 | `read` / `write` / `edit` / `glob` / `grep` / `bash` |
| S4 Tier 1 | compaction、spill、tool call timeout、`todo_write`、AGENTS.md の読み込み |
| S5 Tier 2 | skill、web（search と fetch）、MCP、ask-user、plan-mode、`read_image` |
| S6 Tier 3 | subagent（fork を含む）、jobs、goal、workflow（PTC）、working-directory |
| S7 TUI | S1 のイベントを描画する端末 UI |
| S8 Web UI | S1 をローカルサーバー越しに操作するブラウザ UI |

依存は S2 以降から S1 への一方向である。S1 は、S2 から S6 の機能を agent loop の変更なしに載せられる拡張点を揃える。S7 と S8 は v1 の後に作る。

UI と核の間は、プロセス境界を越えられる形に保つ。核の公開面は直列化できるイベントストリームとコマンドに限り、UI に関数やクロージャを渡さない。こうすると S7 は同一プロセスで、S8 は WebSocket 越しに、同じプロトコルで核を使える。

## dsh から外すもの

| 外すもの | 理由 |
|---|---|
| Cordis | 必要な部分集合を自作する（[カーネル](#カーネル)）。Effect-TS 上に作る案は、waterfall 型イベントが Effect の流儀から外れて結局自作になるため退けた。イベントソーシングを核にする案は、承認待ちやストリーミングのような時間をまたぐ介入を純粋関数で書くのが不自然なため退けた |
| HMR と実行中の load / unload | 依存先が実行中に現れたり消えたりしないので、DI は起動時のトポロジカルソート一回で済む。登録はすべて disposer を返すので、後から HMR を足すときは disposer を束ねる scope を加えればよい |
| Desktop、Python SDK、ACP | v1 の UI は CLI だけである。S7 と S8 の後で再検討する |
| 二言語ドキュメント | 個人の基盤には不要 |
| OpenTelemetry、credentials と authorization の各サービス | API キーは環境変数で足りる |
| plugin-manager、typert | 起動時に組み立てる方式では不要 |
| session format の世代 migration | 移行元が無い。`formatVersion` は最初から持ち、migration の連鎖は互換性の無い変更が初めて生じたときに作る |
| SurfaceOp / SurfaceIntent / `sourceEventSeqs`、`prepareCall` の capability フェーズ、`request/context` | dsh ではプロンプトキャッシュを保ったまま surface を差分更新するための仕組みである。Ollama Cloud の OpenAI 互換 API には明示的なキャッシュ制御が無い。Anthropic adapter を足すときに必要性を再判断する |
| `ToolDefinition.projectContent` | S1 から S3 のツールは `output.render` で足りる。`read_image`（S5）で必要になったときに足す |
| パッケージのファイルごとに 100% のカバレッジ gate | Bun の coverage がファイル単位の閾値を持つかは未確認である。主な証拠は replay snapshot と contract テストが担う。coverage report は出力する |

## S1 の設計

### リポジトリ構成

Bun workspaces の monorepo とし、パッケージを `packages/<group>/<pkg>/` に置く。パッケージ名は `@fudo/<pkg>`、CLI 名は `fudo` である。

```
packages/
  kernel/kernel        Context・service・event・effect・loader
  core/session         SessionEventMap・append-only log・deriveMessages
  core/session-jsonl   JSONL 永続化 provider
  core/tools           tool registry と実行 pipeline
  core/system-prompt   prompt section と tool schema の組み立て
  core/agent           Agent interface・registry・agent/* イベント
  core/agent-loop      turn/step driver（プラグイン）
  core/scope           Agent 単位の scoped registration
  llm/llm              StreamChunk・LlmFailure・adapter seam
  llm/llm-openai       OpenAI 互換 adapter
  bundle/base          既定の plugin 行（YAML）
  app/cli              Headless 一発実行と REPL（profile runner）
  test-support/replay  録画 fixture の再生と、テスト専用ツール
```

### カーネル

カーネルは Cordis の部分集合である。service の DI、型付きイベント、disposer を返す登録を持ち、実行中の load と unload は持たない。

```ts
// 宣言マージで拡張する。dispatch mode をイベントの型に埋め込む
interface Events {
  'agent/pre-step': Waterfall<(input: PreStepInput) => Promise<PreStepDecision>>
  'agent/created':  Serial<(agent: Agent) => Promise<void>>
  'session/event':  Emit<(ev: SessionEvent) => void>
}
interface Services { sessions: SessionStore; tools: ToolRuntime; llm: LlmRuntime }

interface Plugin<C> {
  name: string
  inject?: (keyof Services)[]
  config: z.ZodType<C>
  apply(ctx: Context, config: C): void | Promise<void>
}

ctx.provide(name, impl)              // service を登録し、disposer を返す
ctx.on(name, listener, { prepend })  // listener を登録し、disposer を返す
ctx.effect(() => disposer)           // 任意のリソースを登録する
ctx.emit / serial / parallel / bail / waterfall(name, ...args)
ctx.child()                          // 子 Context。dispose で配下の登録を逆順に解除する
```

dispatch mode は emit、serial、parallel、bail、waterfall の五つで、意味は dsh の Cordis primer と同じである。waterfall の listener は `(...args, next)` を受け、`next()` を呼べば次へ委譲し、呼ばずに返せば short-circuit する。単一の決定を返すイベントでは short-circuit が正規の使い方である。dsh はイベントの mode を JSDoc の `@mode` で宣言し、gate で dispatch 箇所と照合する。fudo は mode を `Waterfall<F>` などの型に埋め込み、mode と異なる dispatch 関数ではそのイベントを呼べないようにする。

loader は dsh と同じ行形式 `{ id, name, config, disabled }` の YAML を、bundle、profile patch、home patch、`--patch` の順に id 単位で重ねる。起動時は `inject` から依存をトポロジカルソートし、循環や存在しない service があれば起動を失敗させる。activate の途中で失敗したら、それまでの disposer を逆順に呼ぶ。`--dump-config` は最終的なツリーを表示する。

plugin の config と tool の引数・出力の schema は zod v4 で書く。tool の JSON Schema は `z.toJSONSchema()` で同じ定義から生成する。

デプロイによって変わる値は、plugin の config として YAML から変更できる形にする。`DEFAULT_*` 定数を plugin に埋め込まない。プロトコル定数とセキュリティ上の不変条件は固定する。

### Session log

session log は append-only で、model に渡す history はすべてログから導く。model に見える入力は必ずログに残り、ログに無いものは model に見えない。resume、fork、transcript、replay テストはこの不変条件に依存する。

```ts
type SessionEvent = { [K in keyof SessionEventMap]: {
  seq: SessionSeq; time: number; type: K; data: SessionEventMap[K]; ignorable?: true
} }[keyof SessionEventMap]
```

`type` による判別 union なので、`switch (ev.type)` で `ev.data` が cast なしに絞り込まれる。`SessionEventMap` は宣言マージで拡張する。

| イベント | 内容 |
|---|---|
| `session/header` | `formatVersion`、作成時刻、cwd。ログの最初の 1 件 |
| `turn/start` / `turn/end` | `turn/end.reason` は宣言マージで拡張できる `TurnEndReasonMap`（`completed`、`cancelled`、`error` など） |
| `step/start` / `step/end` | 1 回の model request と、その request が呼ぶ tool をまとめた単位 |
| `request/header` | provider、model、リクエストパラメータ。request series ごとに 1 件 |
| `system/message` | system prompt。request series の先頭で 1 件 |
| `user/message` | `source` で、人の入力・`agent.inject()`・runtime context を区別する |
| `assistant/message` | 組み立てた content、usage、`replayState`、タイムスタンプ付きの生 stream |
| `assistant/attempt` | 失敗・retry・cancel した試行。history に入らない |
| `tool/call` / `tool/result` | `tool/call` は実行前に記録する。引数は生の JSON 文字列のまま |

`approval/*`、`sandbox/mode`、`compaction/*`、`todo/write` などは、担当するプラグインが S2 以降で宣言マージによって追加する。

`assistant/message` と `assistant/attempt` に埋め込む stream は、dsh の compact assistant stream と同じく、同じ block の連続する delta を一つのレコードにまとめ、元のタイムスタンプを保つ。replay テストはこの stream を adapter の出力として再生するので、ストリーミング途中の chunk の分割まで再現される。

`deriveMessages(events, projections)` はイベント列を畳み込んで model history を作る純粋関数である。プラグインは message projection を登録できる。S4 の compaction は「`compaction/summary` より前の範囲を要約に置き換える」projection を登録する。live の Agent とファイルから読んだセッションは同じ projection 定義を使う。

永続化の seam は `SessionPersistence`（`create` / `open` / `stat` / `list`）で、S1 の provider は JSONL（`~/.fudo/sessions/<id>/session.v1.jsonl`、1 行 1 イベント）である。`append` は data が JSON に直列化できるかを検査し、できないイベントはログに入れない。flush は step と turn の終わりで行う。未知のイベント型は、`ignorable: true` が付いていない限り読み込みエラーにする。

### LLM seam

LLM seam の Definition は `llm/llm`（`ContentBlock`、`StreamChunk`、`LlmFailure`、`LlmAdapter`）、Provider は `llm/llm-openai`、Consumer は agent loop と S4 の compaction である。

`StreamChunk` は dsh と同じ閉じた union で、`block-start`、`text-delta`、`reasoning-delta`、`tool-call-delta`、`block-end`、`usage`、`finish` の 7 種である。switch は `assertNever` で閉じる。

adapter は次の契約を守る。

1. `usage` は `finish` より前に出し、`finish` の後には何も出さない
2. tool の引数は生の JSON 文字列のまま流す
3. 失敗は `stream()` からの throw か `finish{kind:'error'}` のどちらかで返し、どちらも `LlmFailure` に正規化する
4. 1 回の adapter 呼び出しは provider への 1 回の試行とし、SDK の retry を無効にする（OpenAI SDK は `maxRetries: 0`）。SDK の内部で retry すると、失敗した試行が `assistant/attempt` に残らない
5. 応答の無い時間を transport で打ち切る（`streamIdleTimeoutMs`、config で変更でき、既定 5 分）
6. content の無い完了は `EMPTY_RESPONSE` として、retry できるエラーにする
7. コンテキスト長の超過は `CONTEXT_WINDOW_EXCEEDED` に正規化する。consumer は provider の文面ではなく `code` で分岐する

dsh に無い追加として、adapter は自分が対応する機能を静的に宣言する。

```ts
interface LlmCapabilities {
  toolChoice: boolean                        // Ollama Cloud: false
  reasoningEffort: readonly string[] | null
  images: 'base64' | 'none'
  promptCacheControl: boolean                // Anthropic: true
}
```

Ollama Cloud の OpenAI 互換 API は `tool_choice` を受け付けない。`toolChoice: false` の adapter では、ツールの強制や禁止をプロンプトと `tools/pre-execute` で担う。loop とプラグインは capabilities を見て振る舞いを分け、特定の provider の機能を前提にしない。

route は `provider/model` 形式の文字列（例: `ollama-cloud/qwen3-coder:480b`）で指定する。provider ごとの `baseURL`、API キーの環境変数名、capabilities、retry policy は bundle の YAML に置く。retry は `llm-retry` プラグインが `agent/request-error` waterfall で担い、`retryableCodes` と backoff に従って `{ kind: 'retry' }` を返す。

### Tool registry と実行 pipeline

```ts
interface ToolDefinition<A, V> {
  name: string
  description: string
  parameters: z.ZodType<A>
  output: { schema: z.ZodType<V>; render(args: A, value: V): ContentBlock[] }
  execute(args: A, exec: ToolRunContext): Promise<V>  // exec.signal に従う
  isConcurrencySafe?(args: A): boolean
  timeoutMs?: number
  finalizeContent?(exec: ToolExecution, result: ToolExecutionResult): ContentBlock[] | undefined
  presentCall?(args: A): ToolCallView
  presentResult?(args: A, result: ToolResultView): ToolResultView
}
```

`schemas()` は `name`、`description`、`parameters` だけを allowlist で取り出して model に渡す。tool 本体は正規の JSON 値を返し、`output.render` がそれを model 向けの content に変換する。S6 の workflow（PTC）は、コードから tool を呼んで構造化された値を受け取るので、この分離を前提にする。`presentCall` と `presentResult` は引数と結果だけに依存する純粋関数で、live 描画と replay で同じ結果を返す。

1 回の tool call は次の順に処理する。

```
tool/call（ログ）
  → tools/pre-execute  waterfall   allow / deny / ask
      ask → ctx.approval（S2）→ allowed-once 以外は deny
  → monotonic guards               deny か abstain だけを返す
  → tools/execute      waterfall   timeout・計測などの around 処理
      → execute() 本体
  → tools/post-execute waterfall   結果の置換・追加 context
  → finalizeContent
  → tools/result       emit        確定した結果の通知
tool/result（ログ）
```

waterfall は `prepend` で順序が変わるので、後から登録したプラグインが policy を迂回できる。どの組み合わせでも破られてはならない拒否（plan-mode での書き込み禁止など）は monotonic guard に置く。

pipeline の途中で起きた例外は `isError` の結果に正規化し、model にエラーとして返す。連続する `isConcurrencySafe` の call は並列に実行し、結果は call の順にログへ記録する。ToolRestriction は scope（Agent）ごとに継承したツールを絞り込むフィルタで、plan-mode（S5）と subagent（S6）が使う。

### Agent と agent loop

```ts
interface Agent {
  readonly id: SessionId
  readonly session: Session
  readonly options: AgentOptions   // route、model、reasoning effort など
  readonly inbox: Inbox            // nextTurn と nextStep の 2 キュー。永続化する
  readonly status: AgentStatus     // idle | running | cancelling | disposed
  readonly ctx: Context            // Agent scope。dispose で配下の登録を巻き戻す
  followup(m: UserMessage): void   // 次の turn に積む
  steer(m: UserMessage): void      // 次の step 境界で取り込む
  inject(m: UserMessage): void     // Agent を起こさず、次の request に同梱する
  cancel(cause: AgentCancelCause): void
  whenIdle(): Promise<void>
}
ctx.agents.create({ seed?, options, preset?, meta? })
```

`followup`、`steer`、`inject` は、UI からの入力、jobs の完了通知、AGENTS.md の追加読み込みにそれぞれ対応する。

1 turn は次の順に進む。

```
turn/start
  inbox から input を claim
  → agent/pre-step  waterfall  reject | enter(messages, startsRequestSeries?)
  step/start
  → system prompt と tool schema を組み立て、system/message と user/message を記録
  → agent/request   waterfall  route 切り替えなど request の最終調整
  → 必要なら request/header を記録し、deriveMessages() で history を確定
  → llm stream → agent/assistant-stream（emit、live 描画用）
    assistant/message か assistant/attempt を記録
    失敗時は agent/request-error waterfall。{ kind: 'retry' } なら再試行
  → tool/call* → 実行 pipeline → tool/result*
  step/end
  tool の結果を model に返す必要があるか steer が届いていれば、次の step へ
  → agent/turn-stopping  serial
turn/end
```

agent loop は次の不変条件を守る。

1. すべての `tool/call` に対応する `tool/result` を記録する。step が失敗またはキャンセルされたら、欠けた分を合成したエラー結果で埋める。埋めないと、次の request で provider が応答の無い tool call を理由に要求を拒否する
2. キャンセルの原因を `AgentCancelCause`（`user`、`shutdown`、`parent-cancelled` など）で表し、`turn/end.reason` に記録する
3. retry は確定済みの request を再送し、prompt の組み立てと `agent/pre-step` をやり直さない
4. `agent/created` は serial で await してから最初の作業に入り、失敗したら初期化を巻き戻す

S6 はこれらの拡張点を使う。subagent は親が `ctx.agents.create()` で子を作り、子の `agent.ctx` に ToolRestriction を登録する。子の approval は親の answerer に委譲するか `never` に固定する。fork は `seed` に turn 境界までのイベント列を渡す。goal は `agent/turn-stopping` で継続を指示する。jobs は Agent の外の service とし、完了を `inject` で通知する。

### System prompt

```ts
interface PromptSection {
  name: string          // 重複登録は throw する
  order: number         // 昇順に連結し、同順位は name の code-unit 順
  text: string | ((c: AssembleContext) => string)  // {{var}} は後段で補間する
  complete?: boolean    // この section だけで prompt 全体を置き換える
}
ctx.systemPrompt.section(s)  // disposer を返す。agent.ctx から登録するとその Agent だけに効く
```

tool schema は、登録済みのツールのうち scope の ToolRestriction を通ったものから作る。

approval policy、sandbox mode、cwd、日付のように変わる事実は、system prompt に入れず、runtime context の snapshot として `user/message{ source: 'runtime-context' }` に記録する。値が変わったら、既存の history の後ろに新しい snapshot を足す。system prompt が変わらないので prefix が安定し、model が各時点で何を知っていたかがログから分かる。AGENTS.md（S4）、skill の一覧（S5）、plan-mode の指示（S5）は section か `inject` で入れ、agent loop を変更しない。

### エラー処理

失敗はそれぞれ担当が決まっており、担当が保証を持つ。

| 失敗 | 担当 | 保証 |
|---|---|---|
| plugin の config や依存の不備 | loader | 起動を失敗させ、途中までの disposer を逆順に呼ぶ |
| tool 本体と pipeline の例外 | tool registry | `isError` の結果にして model に返し、loop は続ける |
| approval の answerer の不在・例外 | approval（S2） | `unavailable` を返す。呼び出し側は拒否する |
| sandbox backend の不在 | sandbox（S2） | `SANDBOX_UNAVAILABLE` で失敗する。制限なしでの実行に切り替えない |
| LLM の失敗 | adapter と agent loop | `LlmFailure` に正規化し、retry するか `turn/end{ reason: 'error' }` で閉じる |
| ログの append・永続化の失敗 | session | その Agent を止める |
| `session/event` の observer の例外 | session | 隔離して報告し、append の成否に影響させない |

ログの append に失敗した Agent を止めるのは、記録されない状態で作業を続けると、model に見えたものとログが食い違うからである。observer の例外を隔離するのは、observer がログの下流にあり、その失敗がログの正しさに影響しないからである。

失敗は `code` を持つ判別 union で表し、consumer は文面ではなく `code` で分岐する。ユーザーへの報告は、起きたことと次に取る行動を一文ずつ書く。

### Headless CLI

```
fudo "task"                      一発実行（headless profile）
fudo                             REPL（repl profile、TTY が必要）
fudo --profile <name> --patch <file.yml>... --dump-config
fudo --resume <sessionId>        ログから復元して続ける
fudo --json "task"               session/event を JSONL で stdout に出す
```

アプリケーションの起動経路は `fudo` の profile だけとし、テストと demo も同じ経路で起動する。

S1 が出荷する profile は `headless` と `repl` の二つで、どちらも `bundle/base` を第一層にする。CLI は `agent/assistant-stream` の chunk を stdout に流し、tool call を `presentCall` の 1 行要約で示す。S2 で approval が入ると、`repl` profile は TTY の y/n answerer を登録し、`headless` profile は answerer を登録しないので承認を要する操作が拒否される。全面的な許可は S2 の permission preset を `--permission danger-full-access` で明示して選ぶ。終了コードは completed が 0、error が 1、SIGINT が 130 である。SIGINT を受けたら `cancel({ kind: 'user' })` を呼び、`turn/end` を記録してから終了する。

### テスト

| 層 | 内容 |
|---|---|
| Unit（`bun test`） | 各パッケージの `tests/**`。すべての registry に、plugin を dispose すると登録が消えることを確かめるテストを書く。agent loop には contract-regression テストを置く |
| Replay snapshot | `snapshots/session/<case>/session.v1.jsonl` と `snapshot.yml`（profile と patch）。録画した assistant stream を adapter の出力として再生し、`fudo` CLI と実物の registry・pipeline・JSONL を通す。出力ログの id と時刻をトークンに置き換えて fixture と比べる。ワークスペースを変更する case は `workspace.expected/` と全体を比べる |
| Real-API e2e | `OLLAMA_API_KEY` が無ければ skip する。profile を起動してプロンプトを送り、書き込まれたファイルなど外部の状態を確かめる。agent 自身の出力の文言では判定しない |
| 録画 | `bun run snapshot:record` が API キーを使って fixture を作り直す。差分はレビューしてからコミットする |

mock は LLM の境界だけに置き、その下流は実物を使う。

## 未確認の事項

次の三点は Ollama Cloud のドキュメントに記載が無く、S1 の実装の初めに API キーで録画して確定する。録画は adapter の単体テストの fixture にする。

- reasoning の delta が `reasoning` と `reasoning_content` のどちらのフィールドで届くか
- 並列の tool call の delta がどう分割されて届くか
- `stream_options.include_usage` を指定したとき、usage がどの chunk に付くか

Bun の coverage がファイル単位の閾値を持つかも未確認である。

## S1 の完了条件

1. `fudo --profile headless "…"` が Ollama Cloud に対して、テスト専用ツール（`test-support` の `echo` と `fail`）の呼び出しを含む複数 step の turn を完了する
2. そのセッションを `--resume` で再開した 2 turn 目が、ログから再構成した history の上で動く
3. tool の例外、LLM の retry、SIGINT による cancel のそれぞれで、`tool/call` と `tool/result` が対になり、`turn/end.reason` が正しく記録される
4. 1 から 3 が replay snapshot として API キーなしで再生できる
5. [未確認の事項](#未確認の事項)の三点を録画で確定し、adapter のテストに反映する
6. `--dump-config` が最終的なツリーを表示し、存在しない service を `inject` する行があると起動が失敗する
