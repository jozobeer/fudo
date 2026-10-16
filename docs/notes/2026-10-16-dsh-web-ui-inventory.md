# DSH ブラウザ UI の機能棚卸し（2026-10-16）

jozo-harness の Web UI を DSH 相当に引き上げるための入力。DSH のチェックアウト
（dsh:apps/web、dsh:packages/client/*）を調査専用のサブエージェントに読ませ、
ユーザーに見える機能だけを表にした。コードは写していない。

## 1. 領域別の機能表

| 機能 | 何ができるか | DSH の置き場 |
|---|---|---|
| **シェル/レイアウト** | | |
| 3 カラム枠と幅操作 | 左 264〜420px（既定 280）、右は 45% で開き 70% 上限、狭いときは右→左の順で譲る | ui-layout |
| 左サイドバー | ブランド、新規セッション、折畳、設定導線、グローバル パネル | ui-sidebar |
| グローバル パネル | sidebar.panellist に載るアイコン付きパネル | ui-sidebar + ui-plugin-manager / ui-schedule |
| 右サイドバー | セッションごとのドッキング面・タブ・全画面化 | ui-sidebar-right / ui-dockkit |
| 描画の入口 | boot ページを水和してアプリに切り替え、slot を実体化する | ui-renderer / ui-slots |
| 共有部品と描画器 | コントロール、Markdown、差分、端末出力、JSON | ui-primitives |
| **セッションと履歴** | | |
| ワークスペース/セッションの閲覧 | ワークスペース別の一覧、展開状態の保存、Add workspace | ui-workspace |
| 一覧の並び | Last updated / Manual、ピン、既定 5 件と Show more | ui-workpace |
| 行メニュー | Rename / Fork / Pin / Archive / 削除、実行中は停止確認 | ui-workspace |
| 検索 | タイトルと WS は即時、本文は 250ms デバウンスで上位 20 件と抜粋 | ui-workspace |
| タブ(ビュー) | Chat と Trajectory、選択の永続化 | ui-conversation / ui-chat / ui-trajectory |
| セッション状態の供給 | 一覧・保持・実行状態・完了通知を slot に流す | ui-session |
| **会話の描画** | | |
| メッセージ行 | ユーザー/アシスタント、コマンド行、失敗行、クォータ通知、画像ギャラリー | ui-chat / ui-attachment |
| プロセス折畳と推論 | Compact / Standard / Detailed / Verbose、折畳の設定 | ui-chat |
| ツール表示 | 呼び出しツリー、ツール別ビュー、未登録は汎用カード | ui-tool |
| ターン統計 | トークン使用量と入力欄下の activity/usage ピル | ui-chat |
| 成果物 | 変更ファイル カード、成果物カード、本文中のファイル リンク | ui-deliverables |
| Trajectory | ターン/ステップ単位の台帳とタイミング俯瞰 | ui-trajectory |
| ワークフロー実行 | 実行/フェーズ/メンバーを会話のノードとして展開 | ui-workflow-run |
| **入力（composer）** | | |
| エディタと送信 | Enter/Ctrl+Enter/Shift+Enter、送信モード設定 | ui-conversation |
| ドラフト保持 | テキストと参照チップをセッション切替・リロード越しに保持 | ui-conversation |
| トリガーとコマンド | / と @ の候補、+ メニュー（File/Goal/Plan/Compact/Permission/Model/Export） | ui-input-trigger / ui-commands |
| キューと Todo | 次ターン inbox のドックと TODO のドック | ui-conversation |
| composer 乗っ取り | priority 順の chain で承認・質問・プランが入力を置換 | ui-conversation |
| 添付 | 下書き添付レール、全画面ドロップ、画像/ファイル カード | ui-attachment |
| スキル | /名前 でスキルを読み込み、会話にカードを出す | ui-skill |
| **承認と質問** | | |
| 承認要求 | 保留ごとに composer を乗っ取り、判断を Host へ返す | ui-approval |
| 質問 | 選択肢/自由入力/スキップ/一括回答、カウントダウン | ui-user-questions |
| プラン レビュー | 提出プランの提示と承認/拒否、プレビュー | ui-user-questions / ui-plan |
| **走行状態** | | |
| job | ヘッダの一覧、経過時間と進捗、出力パネル | ui-jobs |
| サブエージェント | 系譜カタログ、子セッションへの移動、フォローアップと停止 | ui-subagent |
| goal | GoalBar で編集・一時停止・再開・クリア | ui-goal |
| スケジュール | Automation tasks ページ、ヘッダの時計、行のマーク | ui-schedule |
| プラン/workflow | composer のチップ、ターン末尾のカード、実行ノード | ui-plan / ui-workflow-run |
| **設定・モデル・テーマ** | | |
| 設定シェル | セクション/行/ランチャーの型付き拡張点、namespace 単位の読み書き | ui-settings |
| General と各機能の行 | 外観、言語、折畳、権限既定、プリセット既定、キーボード | ui-settings-general / ui-theme / ui-permission-presets / ui-agent-preset / ui-shortcuts |
| Models / Account | モデルと API キーの編集、ログイン状態 | ui-settings-models / ui-settings-account |
| モデル選択 | composer の席と /model ポップアップ、カタログ、次リクエストから適用 | ui-model-selection |
| テーマ | light/dark/system、フォントとサイズ、トークンの DOM 適用 | ui-theme / ui-layout |
| **添付とファイル** | | |
| アップロード | Blob/ストリームをセッションへ送り、進捗・キャンセル・レシート | file-upload |
| ファイル ツリー / プレビュー | 遅延一覧と監視更新、Markdown・コード・PDF・画像などのプレビュー | ui-sidebar-files / ui-sidebar-documentpreview |
| 端末とブラウザ | シェル実行のタブとサンドボックス iframe | ui-sidebar-terminal / ui-sidebar-browser |
| 参照 | @ でファイル/フォルダ/セッションを挿入 | ui-reference |
| **基盤** | | |
| 接続 | RPC とイベント ストリーム、再接続、接続世代 | connection |
| 読込と更新 | boot graph の遅延ロード、再ビルド時に頁を再読込せず差替 | modules / hmr |
| ショートカット | コマンド登録と物理キー配送、Mod+/ の一覧 | shortcuts / ui-shortcuts |

## 2. 中核と追加

「1 セッションの会話が読み書きできる」までに要る線を中核とする。

1. 描画の入口と骨格（画面そのもの）
2. 3 カラム枠と左サイドバー（全導線の器）
3. セッション一覧（会話を選ぶ手段）
4. 接続とイベント配信
5. セッション ライフサイクルの結線（実行状態）
6. 会話の描画
7. ツール表示
8. 入力と送信
9. トリガーとコマンド
10. モデル選択
11. 承認
12. 質問
13. 添付と参照
14. テーマ
15. 設定シェル

追加（欠けても会話は成立する）: jobs、subagent、goal、schedule、plan、workflow-run、
trajectory、deliverables、message-feedback、plugin-manager、右サイドバー、shortcuts、
locale、open-in-app、agent-preset、directory-picker、dockkit。

## 3. 中核が読むデータと DSH の出所

| データ | DSH の出所 |
|---|---|
| セッション/ワークスペース一覧 | remote.session / remote.workspace（session-controller、workspace-controller） |
| 会話履歴 | session-controller の cold read とイベント ストリーム |
| 実行状態と進行ターン | session 投影の status |
| 承認待ち・質問待ち | SessionPendingInteraction と remote.userQuestions |
| モデル カタログ | remote.session.modelCatalog |
| 権限プリセット | remote.permissionPresets |
| 設定文書 | remote.settings（settings-controller） |
| ワークスペースのファイル | remote.workspaceFiles（workspace-files） |
| job 一覧と出力 | remote.job（job-controller）と job-output |
| goal / スケジュール | remote.goals / remote.schedule |
| コマンド / スキル | remote.commands / remote.skills |
| 統計とターン輪郭 | session-stats / session-turn-outline |

## 4. 未確認

- 既定キーバインドの実値（物理キーの対応表は未読）
- Chat 表示モード（折畳）の業務ルール
- モデル カタログの Host 側の合成経路
- Web 既定で本文検索が有効か
- Desktop 固有の連携（ネイティブ選択、分析イベント）
- 見た目の実数（CSS トークン値、余白）
