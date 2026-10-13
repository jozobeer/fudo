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
