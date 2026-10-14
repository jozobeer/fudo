# fudo 設計: S6 Tier 3

範囲は設計文書の分割表に従う: subagent（fork を含む）、jobs、goal、workflow（PTC）、working-directory。schedule は分割表に無いが、[dsh のギャップ表](../../notes/2026-10-14-dsh-gap-backlog.md)の C2 が求めるので、2026-10-14 にこの段へ足した。

## 前提（S1 から S5 までで使えるもの）

- ツールは ToolDefinition で宣言し、依存（sandbox や Ask など）は構築時に注入する。
- 子 agent は Agents.create で作れる。親子はセッションの並置で表す（subagent ツールで実装済み）。
- 承認と質問は session に残るイベント（safety/approval/*, interaction/ask/*）と Deferred で扱う。
- ログは JSONL。イベント型は SessionEventMap への宣言マージと registerSessionEventSchemas で足す。

## 決定

1. **working-directory はイベントで表す。** session/cwd の変更を session/cwd/changed として記録し、agent loop は「最後の変更、無ければ session/header」を現在の cwd として使う。ツール context の cwd もそれに従う。ツール側は working_directory ツール（needs: []）で、変更先がワークスペース外なら拒否する。
2. **jobs はセッションに紐づくプロセスの表。** 起動は bash の非同期版（needs: exec、承認は bash と同じ）。出力は退避と同じくファイルに書き、job_id で引く。プロセスは Scope に結びつけ、セッション終了で止める。
3. **goal は目標の記録で、継続ラウンドを持つ（2026-10-14 改訂）。** 当初は「自動再開は v1 では持たない」と決めていたが、[dsh のギャップ表](../../notes/2026-10-14-dsh-gap-backlog.md)の C1 が「目標がセッションをまたいで持続し、自動で次のラウンドが走る」を受け入れ条件にしているので、方針を変える。
   - 目標は session のイベント `goal/updated`（log-only）として残す。`currentGoal(events)` が最新の 1 件を畳むので、再開したセッションでも目標は生きている。ラウンド数はログの `user/message`（source = `goal-round`）の数から導出し、別の状態を持たない。上限は `maxGoalRounds`（既定 256）。
   - 自動再開は `startGoalRound(agent)` が担い、CLI が `agent/turn-stopping` に登録する。turn が閉じる**前に**次のラウンドの指示を `goal-round` 来源の user/message として `followup` するので、run が途中で idle になって終わることがない。上限に達していれば、システムの判断として blocked（round-limit）にする。ラウンドの判断は自分（`wire` された agent）の turn だけを見る。`goal-round` は `USER_MESSAGE_SOURCES` に足す。
   - モデルは `goal` ツールの action（create / edit / pause / resume / complete / blocked）で目標を動かす。blocked は理由を要求し、直近の user/message が `goal-round`（＝自動ラウンドの中）なら 3 ラウンド未満では拒否する。
4. **workflow（PTC）は「同じ turn で複数のツールを並べる」に留める。** isConcurrencySafe が真の連続呼び出しを並列に実行する（S1 で保留にした項目）。コードを書く/実行する新しい DSL は v1 では持たない。
5. **subagent の fork は、親の履歴を子に渡す形で表す。** 子のセッションを親のイベントから派生させて作り、cwd と route を引き継ぐ。
6. **schedule はログのイベントで表し、時計は 1 本の fiber が持つ（2026-10-14 追加）。** 予定は `schedule/created` / `schedule/updated` / `schedule/deleted` としてログに残し、`currentSchedules(events)` が最新の状態を畳む（goal と同じ方針）。期限到達は `schedule/fired` として記録し、発火の判定は「ルールから計算した次の時刻」と「最後に発火した時刻」の比較だけで行う。時計は起動時に一度だけ立てる scoped fiber が持ち、次の期限まで `Effect.sleep` して `followup` する。したがって予定はプロセスをまたいで生き、再開したセッションでも期限が来ていれば発火する。
   - 種別は every（秒）・daily（ローカル時刻）・weekly（曜日 + ローカル時刻）・cron（5 フィールド）。
   - 時間帯はプロセスのローカル 1 つだけを使う。dsh は予定ごとに IANA の zone を持つが、fudo の v1 は持たない（差分として記録する）。

## 進め方

1 は S1 の拡張（イベント 1 種と loop の cwd 解決）で済むため最初にやる。次に 4（並列実行）、3（goal）、2（jobs）、最後に 5（fork）。

## fork の種をどこで入れるか（2026-10-13 の調査）

- makeAgent は「すでに組み立てられた Session」を受け取る（packages/core/agent/src/agent.ts の MakeAgentOptions）。Session には sink が無い（sink は OpenedSession 側の内部）。
- したがって種を入れる場所は Sessions.create の側。案: Sessions.create({ cwd, seed }) とし、persistence.create で得た OpenedSession の sink に、session/header 以外の種のイベントを順に append してから Session を組み立てる。
- subagent ツールは forkSeed(親の session.events()) を create に渡す。親の最後の user/message は forkSeed が落とすので、子には自分のタスクだけが残る。

## 実装の記録

- subagent: packages/core/tools-tier1/src/subagent.ts（makeSubagentTool(agents, route)）。CLI は subagents: true のとき登録する。
