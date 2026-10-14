# fudo 設計: S5 Tier 2

範囲は設計文書の分割表に従う: skill、web（search と fetch）、MCP、ask-user、plan-mode、read_image。

## 前提（S1 から S5 までで使えるもの）

- ツールは ToolDefinition（parameters / needs / output / execute）で宣言し、needs は read / write / exec / network。
- needs: network のツールは、S2 の preset では read-only と workspace-write のいずれでも承認要求になる（full だけが無問い合わせ）。
- 承認は safety/approval/requested と answered のイベントとして session に残り、installApproval の answer 経路（その場で答える / 待つ）で決まる。
- system prompt はセクションのレジストリ。AGENTS.md がその一例（registerAgentsMd）。
- ツール群は値のリストとして公開し、CLI が profile の行を見て registする。

## 決めること

1. skill の実体。SKILL.md をどのディレクトリから探し（workspace / ~/.fudo / 同梱）、どのツールで読むか。一覧を出すツール（skill）と、本文を読むツールの 2 つにするか。
2. web search と fetch の provider。API キーが要る検索の扱い（環境変数、未設定時はツール自体を登録しない）。
3. read_image は ContentBlock に画像を載せる必要がある。S1 の ContentBlock は text / reasoning / tool-call の 3 種で、画像が無い。ここで追加するか、それとも結果をファイル参照 + 説明文にするか。
4. MCP のクライアントを S5 でどこまで作るか（stdio のみ、ツール一覧の取り込みと実行だけ、等）。
5. ask-user は承認の仕組みとどこが違うか（質問への回答は選択肢 + 自由記述。session に残るイベントは asked / answered の 2 種を想定）。
6. plan-mode はツール制限（ToolRestriction）で表現する。制限中に許可するツールの集合を profile から与えるか、名前で固定するか。

## 進め方

1. 1 と 5 は S5 の中でも独立性が高いので、先に決めて実装する（skill / ask-user）。
2. read_image は ContentBlock の拡張が要るため、S1 側の追加として先に型を決める。
3. web と MCP は provider / 外部プロセスの寿命が絡むため、最後に回す。

## 実装（2026-10-13、2026-10-14 追記）

| 項目 | 状態 |
|---|---|
| ask-user | 実装済み。interaction/ask/requested と answered を session に残し、Ask サービス（Deferred）で待つ。installAsk が記録を重ねる。CLI は answer を与えるか、Ask.answer を待つ。tools-tier1 の ask_user が callId を id に使う |
| plan-mode | 実装済み。ToolRestriction で read / glob / grep / skill / todo_write / ask_user 以外を隠し、call も拒否する（隠れたツールを呼べない）。profile の safety 行の planMode で切り替える |
| skill | 実装済み。ルートを順に見て <name>/SKILL.md を読む。名前は ^[a-z0-9][a-z0-9-]*$ のみ（パス脱出の拒否は名前の段階）。CLI は options.skills で roots を渡す |
| read_image | 実装済み。ContentBlock に image を追加（llm）。拡張子から mediaType を決め、未知は読む前に拒否。value に base64 を載せ、render が画像ブロックを返す |
| web(fetch) | fetch は実装済み（needs: network。http(s) 以外は拒否、maxBytes で切る）。preset は full 以外で承認要求になる |
| web(search) | 実装済み。BRAVE_API_KEY があるときだけ search host を渡し、無ければ web_search を登録しない（apps/cli/src/search-env.ts、apps/cli/tests/search-e2e.test.ts） |
| MCP | 実装済み。stdio のクライアント（startMcpServer）が tools/list を読み、tool ごとに prefix（既定 mcp__）を付けて登録する。CLI の plugin 一覧にも入ったので、設定ファイルの行から起動できる（apps/cli/src/plugins.ts） |

## 未了（S4 から持ち越し）

- なし。spill の CLI 配線と compaction の発火観測はどちらも入った（証拠は tier1 設計の「実装の追加」にある）。
