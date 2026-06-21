# promptpile-chat-loop example

Run `promptpile` with `--config promptpile.toml` and `--input --continue` in a single bat loop.

## Prerequisites

- **`DEEPSEEK_API_KEY`** (choose one):
  - Set the **User** or **System** environment variable `DEEPSEEK_API_KEY` in Windows, **or**
  - Create a **`.env`** file in this folder (not tracked by git) with one line: `DEEPSEEK_API_KEY=sk-...`
- **`setx`** writes the registry but **does not** update the **current** terminal; open a **new** `cmd` window after `setx`.
- **`run-example.bat`** reads `.env` only to inject `DEEPSEEK_API_KEY` into the current `cmd` session (plain `cmd.exe` does not load `.env` automatically). `promptpile` itself does not load `.env`; its TOML uses `api_key_env = "DEEPSEEK_API_KEY"`.
- Run from this folder with `run-example.bat`
- Do **not** commit API keys. Configuration that is safe to version lives in **`promptpile.toml`**.

## Configuration

- **[`promptpile.toml`](promptpile.toml)** — model, API base URL, message directory (`./messages`), `disable_tool` for a simple chat loop, and `api_key_env` pointing at `DEEPSEEK_API_KEY`.

## Behavior

- If **`DEEPSEEK_API_KEY`** is missing from both the environment and `.env`, the script exits with an error.
- Each round runs `promptpile --config promptpile.toml --input --continue`.
- Enter `Y` to continue the next round; any other input exits.
