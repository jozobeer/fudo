# Bun から Node への移行の受け入れ（Issue #1、2026-10-17）

jozo-harness の道具立てを Bun から pnpm + Node + Vite+ へ移した。段階1（土台）と段階3（本体）を終え、段階2の Solid 試作は Issue #2 で行う。

## 何がどうなったか

- パッケージマネージャは pnpm。`jzh:pnpm-workspace.yaml` がワークスペースを定義し、`jzh:.npmrc` が版を固定する。`bun.lock` と `bunfig.toml` は無い。
- 道具立ては Vite+（`vp`）。fmt / lint / 型検査は `vp check`、テストは Vitest（`vp test`）、タスクは `vp run`、ブラウザの束ねは `vp -C apps/web/client-solid build`、単一バイナリは `vp -C apps/cli pack`。設定は `jzh:vite.config.ts` に閉じてある。
- ランタイムは Node。ソースとテストは `Bun.*` を呼ばず、`node:fs` / `node:child_process`（薄いラッパー `jzh:packages/kernel/process/src/index.ts`）/ `node:sqlite` / `node:zlib` / `node:path` の glob / `yaml` を使う。
- テストは 213 ファイルが Vitest で走る（移行前は 206 ファイルが bun:test）。
- 単一バイナリは Node SEA。profile とビルド済みページを資産として焼き込み、`jzh --dump-config` と `jzh web` が木の外でも動く。
- ブラウザ UI のサーバは `node:http` + `ws`。RPC の framing とクライアントは変えていない（`jzh:apps/web/src/server/protocol.ts` が transport を隔離している）。

## 検証

- `pnpm install --frozen-lockfile`（クリーンなツリー）: 通る。
- `pnpm run check`: **213 ファイル / 947 pass / 2 skip / 0 fail**、coverage lines 94.34%（床 93）/ functions 92.13%（床 92）。fmt・lint（警告も失敗）・typecheck・doc / duplication / complexity の gate も同じコマンドの中で通る。
- `git grep -n "bun:"` と `git grep -n "Bun\."` の残り: 0。
- テスト本数は落ちていない（206 ファイル / 928 テスト → 213 ファイル / 949 テスト。増えた分は失敗経路と SEA の受け入れ）。
- SEA バイナリ: `jzh:apps/cli/tests/compiled.test.ts` が、`--dump-config` が埋め込み profile を読むことと、`jzh web` が埋め込みページ（index.html / main.js / style.css）を 127.0.0.1 で配ることを確かめる。
- CI は `jzh:.github/workflows/check.yml` が `pnpm install --frozen-lockfile` と `pnpm run check` を macOS ランナーで走らせる。node と pnpm は `jzh:mise.toml` から、Rust は rustup が `jzh:rust-toolchain.toml` の版で入れる。

## 記録: 実行時に決めたこと

- **Effect の Node プラットフォームは使わず、node:http + ws にした。** effect 4.0.3 に対する `@effect/platform-node` は 4.0.5 系で、RPC の WebSocket プロトコルは unstable と明記されている。こちら側の protocol 層が transport を隔離しているので、platform を足して RPC の配線を置き換えるより、Issue が代替として名指しした node:http + ws の方が変更が局所で、実ブラウザの受け入れもそのままで通る。
- **テストのランナー反転は一括で行った。** 移行前の実測で、`bun:test` から使う API は `describe` / `test` / `expect` とライフサイクル関数だけで、Bun 固有の matcher は `toStartWith` / `toEndWith` の 2 件、mock 系は不使用だった。パッケージごとに分けるより、import を一括で切り替えて落ちた箇所を直す方が検証が速い。
- **カバレッジの床はそのまま。** Vitest（V8）は関数の数え方が Bun と違うため、失敗経路の実テスト（flush、消えたディレクトリへの append、読めない・直せないログ、消えたログを持つ一覧の項目、読めないレスポンス本文、無い job と読めない settings）を足して床を満たした。
