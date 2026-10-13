# Ollama Cloud recordings

`ollama-cloud-tool-call.sse` は 2026-10-13 に Ollama Cloud の OpenAI 互換 API
(`POST https://ollama.com/v1/chat/completions`) へ streaming + `stream_options.include_usage` +
2 つの tool を付けて録画した生の応答である。モデルは `kimi-k2.7-code`。

録画で確定したこと:

- reasoning の delta は `reasoning` フィールドで届く（`reasoning_content` ではない）
- usage は `finish_reason` の**後**に、`choices: []` の chunk として届く。ストリームは `data: [DONE]` で終わる
  - 設計の「usage は finish より前に出す」という adapter 契約とは順序が逆になるため、adapter は finish を保留して usage を先に emit する
- 並列の tool call は**1 つの delta** にまとめて届く。各要素は `id` / `index` / `type` / `function.name` / `function.arguments` を持ち、`arguments` は分割されず完全な JSON 文字列で入ることがある
- `qwen3-coder:480b` は 2026-07-15 に retire 済み。bundle の既定 route には現行モデルを使う
