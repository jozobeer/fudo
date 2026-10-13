# fudo 設計: S2 Safety

範囲は設計文書の分割表に従う: approval、sandbox seam と macOS Seatbelt provider、sandbox policy、permission preset、escalation。

## 前提（S1 から引き継ぐもの）

- ツール実行は executeTool の 1 本の pipeline を通る。前後には tools/pre-execute / tools/execute / tools/post-execute / tools/result の hook がある。
- PreExecuteDecision は既に「実行する / しない」を返せる。承認はここに挟まる可能性が高い。
- hook は Serial / Parallel / Bail / Waterfall の 4 モードを持つ。承認待ちは時間をまたぐため、待ち合わせは Deferred とイベントで表現する。
- profile は YAML の行で構成され、行の config は plugin の schema で decode される。

## 決めること（実装前に確定させる）

1. approval の要求はどこで発生し、誰が答えるか。CLI（TTY の y/n）と UI（イベント越し）の両方で同じ形にするには、要求と回答をどちらも session に残るイベントにする必要があるか。
2. sandbox seam の型。起動するコマンド（argv・cwd・env）を受けて、包んだ実行方法を返すのか、実行そのものを担うのか。macOS Seatbelt は sandbox-exec の profile 文字列を生成する形になる。
3. 失敗の表し方。sandbox が起動できない（未対応 OS・プロファイル不正）ときに、ツールのエラーとして返すか、起動時に落とすか。
4. permission preset（例: read-only / workspace-write / full）と escalation（拒否されたときに 1 段上げて再要求する）の関係。preset は policy の名前であり、escalation は approval の一種か、別の経路か。
5. policy の置き場。profile の行の config か、専用の行か。ツールごとの許可（bash は許可、write は workspace 内のみ、等）をどう表現するか。

## 未確認

- macOS Seatbelt（sandbox-exec）の現行 OS での可用性と、非対応プラットフォームでの代替（Linux の Landlock 等は v1 の対象か）。
- approval を待つ間、agent loop の turn がどう見えるか（turn/end は出さずに tool/call の後で待つ、等）。S1 のイベント語彙で足りるかの確認が要る。

## 進め方

1. 上記 1〜5 を決めて、この文書を更新する（決定と理由を残す）。
2. seam の型と pipeline への差し込みを、S1 の拡張点（hook と PreExecuteDecision）だけで書けるか確認する。足りなければ S1 側の拡張点を先に足す。
3. 承認・sandbox の拒否・escalation を、replay とスタブで再現できるテストとして先に書く。

## 決定（2026-10-13）

1. **承認はイベントにする。** 要求と回答を session に残るイベント（safety/approval/requested と safety/approval/answered）として書き、pre-execute hook は Deferred を作って要求を書き、回答を待つ。CLI は端末から、UI はイベント越しに同じ形で答える。待っている間も turn は開いたままにし（turn/end を出さない）、ツール呼び出しの直後に待ちが入る。これで S7・S8 が同じプロトコルで承認を扱える。
2. **sandbox は「包む」だけの seam にする。** サービス Sandbox を @fudo/safety に置き、wrap(command) が実行すべき argv を返す（例: sandbox-exec -p <profile> -- <argv>）。実行そのものはツール側（bash）が担う。provider は none（素通し）と seatbelt（macOS）。
3. **sandbox の失敗はツールのエラーにする。** 未対応 OS やプロファイル不正は wrap の時点で SandboxError として返し、tool/result の isError で見せる。起動時に落とさない。素通しへ落とすかは policy が決める。
4. **preset と escalation を分ける。** preset は policy の名前（read-only / workspace-write / full）。escalation は preset の外で実行したいという承認要求であり、理由付きでイベントに残す。1 回の呼び出しにつき 1 段だけ上げる（連鎖させない）。
5. **policy は専用の行に置く。** profile に @fudo/safety の行を足し、config に preset を書く。ツールごとの細かい規則は、ツール定義が宣言する必要種別（read / write / exec / network）から導く。規則の列挙を YAML に持たない。

## S1 に足す拡張点

- ToolDefinition に必要種別（read / write / exec / network）を宣言する欄を足す。S1 のツールはまだ無いので、S3 のツールを書くときに埋める。
- 承認待ちの間に turn がどう見えるかは、上記 1 のとおり「turn は開いたまま」で確定。イベント語彙の追加は上記 2 種のみ。

## 実装（2026-10-13）

| 決定 | 実装 |
|---|---|
| 1. 承認はイベント | events.ts（safety/approval/requested と answered、session カタログへ登録）、approval.ts（Approval サービスと保持）、bridge.ts（installApproval: pre-execute の ask を受けて記録し、回答を待つ / その場で答える 2 経路） |
| 2. sandbox は包む seam | sandbox.ts（Sandbox サービス、none provider）、seatbelt.ts（SBPL の生成と sandbox-exec の argv 組み立て） |
| 3. 失敗はツールのエラー | SandboxError。bridge は承認要求を記録できない場合も拒否へ倒す |
| 4. preset と escalation | policy.ts（decide: allow / ask / deny）、policy-service.ts（Policy サービス、preset を保持） |
| 5. policy は専用行 | plugin.ts（@fudo/safety の行: preset / sandbox / writableRoots）、base.yml の safety 行（preset: workspace-write） |

CLI 側: runCommand は profile に安全行があるときだけ承認を有効にし、approve 未指定なら拒否（答えてくれる相手がいないまま待ち続けない）。prompt.ts が端末の y/n を扱う（既定は拒否）。

テスト: packages/core/safety/tests/ の sandbox / seatbelt / policy / policy-service / approval / approval-service / bridge / prompt / plugin / wiring。承認が実際の tool 呼び出しで発火する CLI レベル確認は、exec を要求する tool が入る S3 で行う。

## 学び（Effect 4）

- Layer.mergeAll は requirements を満たさない。片方の層が要求する service をもう片方から供給するには Layer.provide か provideMerge を使う。テストで toolsLayer と HooksLive を mergeAll したために Service not found: fudo/Hooks が 2 ラウンド追いかける羽目になった。
