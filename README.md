# fudo

汎用コーディングエージェントのハーネス。設計は [docs/superpowers/specs/2026-10-13-fudo-kernel-design.md](docs/superpowers/specs/2026-10-13-fudo-kernel-design.md) にある。

## 開発

```sh
mise install   # Bun を mise.toml の版で入れる
cp .env.example .env   # API キーを書く。mise と Bun の両方が読み込む
bun install
bun run check  # fmt:check → lint → typecheck → test
```

## 参考元

fudo の設計は [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（MIT、© DeepSeek）と、その基盤である [Cordis](https://github.com/cordiverse/cordis)（MIT、© Shigma）に基づく。両プロジェクトのライセンス表示は [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) にある。
