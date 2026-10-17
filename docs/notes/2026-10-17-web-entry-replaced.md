# Web UI の既定の入口を Solid 版へ置換（2026-10-17）

`docs/notes/2026-10-17-solid-port-decision.md` の判断に従い、既定の入口を Solid 版へ入れ替えた。旧 vanilla クライアントは木に無い。

## いまの木

- **入口**: `jzh:apps/web/client-solid` が唯一のブラウザ入口。`base` は既定（`/`）、出力は `apps/web/dist`。
- **束ね**: `jzh:package.json` の `build:web` は `vp -C apps/web/client-solid build` の 1 手。`jzh:apps/web/package.json` の `build` も同じ。
- **純関数**: 旧 `apps/web/client/` の state・trace・board・theme・markdown・html・scroll・trajectory・style.css は `jzh:apps/web/src/ui/` へ移った。ページもテストもここを読む。
- **スタイル**: レイアウトのスタイルシートは `layer(client)` のまま。`jzh:apps/web/src/ui/style.css` を `jzh:apps/web/client-solid/style.css` が読む（Tailwind への移行はしない）。
- **配信**: `jzh:apps/web/src/server/serve.ts` の `defaultStaticRoot` は `apps/web/dist`。ページは `/`、資産は `/assets/<hash>`。単一バイナリは `jzh:apps/cli/vite.config.ts` の `pageAssets()` が dist を再帰的に焼くので、`web/index.html` と `web/assets/…` がそのまま入る。
- **消えたもの**: 旧入口の `main.ts`・`view.ts`・`index.html`・`main.js`・`state.js`・`view.js`・`tsconfig.json`、`apps/web/vite.config.ts`、`apps/web/tests/view.test.ts`（いずれも木に無いので `jzh:` は付けない）。
- **受け入れ**: `jzh:apps/cli/tests/web-acceptance.ts` は既定の `/` を読み、`JZH_WEB_ENTRY` は無い。動き（4 箇所と reduced-motion）の確認は入口を問わず走る。`jzh:apps/cli/tests/compiled.test.ts` はページが名指す bundle を取る。`jzh:apps/cli/tests/web-e2e.test.ts` は一時ディレクトリへ Solid を束ねる。

## 確かめたこと

- 実 Chrome: `node apps/cli/tests/web-acceptance.ts` が既定の `/` で ACCEPTANCE PASS（`.tmp/web-evidence.png`）。置換前の同じシナリオは `the card does not arrive: missing` で落ちる（旧ページに動きは無い）。
- 実配信: `jzh web` の `/` は 200 で `apps/web/dist/index.html` とバイト一致。ページが名指す `/assets/<hash>.js` は 200、旧 `/solid/` と `/main.js` は 404。
- `pnpm run check`: 全ゲート緑（coverage lines 94.30% / functions 92.04%、床は 93 / 92）。旧 `view.test.ts` が副次的に踏んでいた state の遷移は `jzh:apps/web/tests/state.test.ts` が直接踏む。

## 残っているもの

- ディレクトリ名 `client-solid` は移植時のまま。Solid が唯一の入口になったので、名前自体はもう何も分けていない。
- 右シートの Kobalte 化、Tailwind への完全移行、動きの動画は `docs/notes/2026-10-17-solid-port-decision.md` の「いま残っているもの」のまま。
