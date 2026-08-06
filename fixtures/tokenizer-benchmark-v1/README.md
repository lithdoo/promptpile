# Tokenizer benchmark v1

`corpus.json` fixes representative English and Chinese Markdown, JSON, JSONL,
and tool-heavy samples. Reference counts use `tiktoken@1.0.22` with
`gpt-4o-mini`. Tests require exact adapter stability and report the explicit
heuristic fallback's relative error; the fallback is not presented as an exact
model tokenizer.
