# Promptpile CLI Boundary Architecture & Migration Plan

> Status: Implemented (phases 0–9, August 2026)
>
> Scope: `promptpile` + `promptpile-react`
>
> Goal: remove `promptpile-react`'s dependency on unpublished `promptpile/dist/*` internals and make the package boundary explicit, stable, and CLI-first.

## 1. Summary

Before this migration, `promptpile-react` used two different integration models at the same time:

1. It treats `promptpile` as an external CLI and invokes it through a subprocess for model calls.
2. It also imports unpublished implementation modules from `promptpile/dist/*` for conversation mutation and configuration parsing.

The second path makes internal Promptpile refactors observable by React and creates an unstable package boundary. A file rename or build-layout change inside `promptpile` can break `promptpile-react` even if the public CLI behavior is unchanged.

The implemented design chooses a **CLI-first boundary** rather than extracting a new `promptpile-core` package. Sections describing the old implementation are retained as migration rationale; the acceptance checklist records the final result.

The key rule is:

> Do not expose internal functions one-by-one as CLI RPCs. Expose a small number of domain operations and let Promptpile retain ownership of Promptpile-specific configuration semantics.

The minimal public surface added by this proposal is:

```text
New command:
  promptpile conversation append-user

New completion options:
  --llm-config <path>
  --llm-api <name>
  --api-key-env <name>     # recommended for complete React compatibility
```

Existing completion options remain the field-level override mechanism:

```text
-m, --model <model>
-k, --api-key <key>
-b, --api-base-url <url>
--temperature <n>
--extra-body <json>
```

After migration, `promptpile-react` must contain **zero runtime imports from `promptpile/dist/*`**.

---

## 2. Current Problem

### 2.1 Intended architecture

The intended high-level relationship is already process-oriented:

```text
promptpile-react
      |
      | subprocess / CLI
      v
  promptpile
```

React owns orchestration:

- Thought / Observe / Check / Final phases
- phase prompts
- iteration state
- stop conditions
- phase-specific temporary files
- phase-specific tool policy

Promptpile owns one completion execution:

- message directory scanning
- message assembly
- tool definitions
- model request construction
- streaming completion
- persisted assistant artifacts
- Promptpile configuration semantics

This is a strong boundary because React does not need to know how Promptpile implements those behaviors.

### 2.2 Actual architecture today

React also imports internal build artifacts directly.

Current internal dependencies include:

```text
promptpile/dist/file-handler
  scanDirectory
  appendUserMessage

promptpile/dist/llm-sampling
  DEFAULT_TEMPERATURE
  parseTemperatureInput
  coerceTemperatureValue

promptpile/dist/llm-extra-body
  ExtraBody
  parseExtraBodyInput
  coerceExtraBodyValue

promptpile/dist/toml-config
  LlmApiProfile
  loadTomlConfigFile
```

React also assumes the CLI implementation is physically located at:

```text
promptpile/dist/index.js
```

This creates two competing architectures:

```text
                 +--------------------------+
                 |                          |
                 | private TS module import |
                 v                          |
promptpile-react --------------------> promptpile internals
      |
      | subprocess
      v
  promptpile CLI
```

The result is an ambiguous package contract: Promptpile is simultaneously a black-box executable and an accidental library.

### 2.3 Why this matters

A private implementation refactor such as:

```text
file-handler.ts
    -> conversation/scanner.ts
    -> conversation/writer.ts
```

should not be a breaking change for React if Promptpile's externally observable behavior is unchanged.

Today it is.

Likewise, changing the TypeScript build layout from:

```text
dist/index.js
```

to:

```text
dist/cli.js
```

would break React even if the package's `bin.promptpile` entry remains valid.

---

## 3. Decision

Adopt the following package boundary:

```text
                    public contracts
                          |
              +-----------+-----------+
              |                       |
          CLI protocol             files
              |                       |
              +-----------+-----------+
                          v
                      promptpile
                          ^
                          |
                    promptpile-react
```

`promptpile-react` may depend on:

- the `promptpile` executable contract;
- Promptpile's documented message/artifact file protocol;
- npm package metadata needed to locate the declared `promptpile` binary.

`promptpile-react` must not depend on:

- `promptpile/dist/*` module paths;
- Promptpile source file names;
- Promptpile build output layout beyond the package's declared `bin` metadata;
- Promptpile-private TypeScript interfaces;
- Promptpile's internal parser/helper functions.

### Why not `promptpile-core` now?

A `promptpile-core` package is technically safe and gives excellent type safety, but it changes the dependency model to:

```text
              promptpile-core
                 ^       ^
                 |       |
          promptpile   react
                 ^       |
                 +-------+
                  subprocess
```

React would then have two integration relationships with the Promptpile system:

1. library dependency on `promptpile-core`;
2. process dependency on the `promptpile` CLI.

That is valid, but it introduces additional version coordination and makes it easier for the core package to become a large shared implementation bucket.

Because Promptpile is already intentionally file-native and CLI-composable, the CLI-first model is a better architectural fit **provided that the CLI surface remains small and domain-oriented**.

---

## 4. Design Principles

### 4.1 Expose domain operations, not implementation functions

Bad design:

```text
promptpile scan-directory
promptpile next-index
promptpile parse-temperature
promptpile parse-extra-body
promptpile load-toml
promptpile config-resolve
promptpile get-profile
```

This merely converts in-process function calls into subprocess RPC calls. It increases latency, creates a larger protocol, and loses compile-time type safety without creating a better abstraction.

Good design:

```text
promptpile conversation append-user
```

The caller asks for a complete domain operation. Promptpile remains free to change scanning, indexing, locking, or file-writing implementation later.

### 4.2 Promptpile owns Promptpile LLM semantics

React should be able to say:

```text
"Thought uses profile reasoning"
```

It should not need to expand that into:

```text
model = X
base_url = Y
api_key = Z
temperature = T
extra_body = {...}
```

Profile loading, profile validation, defaults, API key resolution, temperature parsing, and extra-body validation are Promptpile responsibilities.

### 4.3 Existing subprocess count should not increase materially

Thought, Observe, Check, and Final already invoke Promptpile subprocesses.

The proposed LLM profile changes are resolved inside those existing subprocesses, so no additional process is needed per phase.

The only new subprocess in the normal React flow is the append-user operation when React input mode needs to persist a user turn.

### 4.4 CLI output is a protocol

Once React depends on a CLI operation, that operation becomes a machine-facing public contract.

Therefore:

- stdout must be predictable;
- diagnostics belong on stderr;
- exit codes must be stable;
- commands must not mix arbitrary logging with machine-relevant output;
- behavior changes require compatibility consideration.

---

## 5. New Command: `promptpile conversation append-user`

### 5.1 Purpose

Atomically express the domain operation:

> Append one user message to a Promptpile message directory using Promptpile's current message-indexing and file-writing semantics, without invoking an LLM.

This replaces React's direct use of:

```text
scanDirectory()
appendUserMessage()
```

### 5.2 Syntax

```bash
promptpile conversation append-user -d <directory>
```

Input is read from stdin.

Example:

```bash
printf '%s' 'Analyze this repository' \
  | promptpile conversation append-user -d ./messages
```

React should pass the already-read user content directly to the child process stdin rather than shell-escaping it.

### 5.3 Options

```text
-d, --directory <path>   Required message directory.
-q, --quiet              Suppress successful stdout output.
```

No model, API, tool, output, or hook options apply to this command.

### 5.4 Input semantics

- stdin is decoded as UTF-8;
- the entire stdin payload is the message content;
- multiline content is supported;
- input is considered empty if `content.trim()` is empty;
- when checking emptiness, Promptpile must not otherwise rewrite the original content unnecessarily;
- empty input fails before any file is written.

### 5.5 Directory semantics

- relative `--directory` is resolved against process cwd;
- the target must already exist and be a directory;
- v1 does **not** auto-create the conversation directory;
- nested directories remain irrelevant to the current scanner behavior;
- indexing and file naming must reuse Promptpile's existing user-message append implementation.

### 5.6 Write semantics

Conceptually:

```text
read stdin
   |
validate non-empty
   |
scan current message files
   |
determine next user-message index
   |
atomic write [N]user.md
   |
exit 0
```

This must remain one domain operation. Do not expose a separate `next-index` command followed by a separate write command, because splitting those steps would introduce an avoidable TOCTOU/race window.

This proposal does **not** attempt to add full multi-writer transaction coordination to Promptpile. It only avoids making the existing situation worse.

### 5.7 LLM isolation guarantee

`conversation append-user` must:

- not require an API key;
- not resolve an LLM profile;
- not load tools;
- not call the completion API;
- not run after-hooks;
- not create assistant files.

This is intentionally different from the current `promptpile -i`, whose input behavior is part of a completion run.

### 5.8 stdout/stderr contract

Default success stdout:

```text
<path-to-written-file>\n
```

`--quiet` success stdout:

```text
(empty)
```

stderr:

```text
human-readable diagnostics and errors only
```

No JSON mode is required for v1 because React only needs the exit status. If another consumer later needs structured metadata, add an explicit machine-output option rather than silently changing stdout.

### 5.9 Exit codes

For v1:

```text
0   success; exactly one user message was written
1   validation, directory, indexing, or write failure
```

More granular exit codes may be introduced later only if there is a concrete consumer need.

---

## 6. New Completion Option: `--llm-config <path>`

### 6.1 Purpose

Provide a configuration source that is used **only as an LLM profile database**.

Syntax:

```bash
promptpile \
  --llm-config ./config.toml \
  --llm-api reasoning \
  ...
```

### 6.2 Difference from existing `--config`

Existing `--config` loads full Promptpile runtime configuration, including fields such as:

```text
directory
output
quiet
continue
input
tools_file
after_hook
insert_files
append_files
disable_tool
...
```

That is unsafe for React phases because Thought, Observe, Check, and Final deliberately use different runtime policies.

For example:

- Observe and Final disable tools;
- Check uses a temporary directory and a synthetic tool;
- Continue behavior differs by phase;
- phase-specific sidecars differ.

Therefore React must not pass an entire Promptpile runtime config into every phase merely to obtain an LLM profile.

`--llm-config` reads only the LLM profile tables:

```toml
[[llm_api]]
name = "reasoning"
model = "..."
base_url = "..."
api_key_env = "..."
temperature = 0.3
extra_body = { ... }
```

Any `[promptpile]`, `[promptpile-react]`, or unrelated table in that file is ignored by `--llm-config` profile loading.

### 6.3 Path semantics

- relative path is resolved against process cwd;
- missing file is an error;
- malformed TOML is an error;
- malformed selected profile fields are an error according to Promptpile's canonical validation rules.

---

## 7. New Completion Option: `--llm-api <name>`

### 7.1 Purpose

Select one named `[[llm_api]]` profile from the active LLM profile source.

Example:

```bash
promptpile \
  --llm-config ./config.toml \
  --llm-api reasoning \
  -d ./messages
```

### 7.2 Selection behavior

Profile lookup is case-insensitive, preserving current Promptpile behavior.

If an explicit `--llm-api <name>` is provided and the profile does not exist, the command must fail:

```text
Error: LLM API profile not found: <name>
```

Do not silently fall back to the default model when an explicitly requested profile is missing. Explicit selection should be strict.

### 7.3 Profile source

The source for `[[llm_api]]` is selected as follows:

```text
if --llm-config is present:
    use [[llm_api]] from --llm-config
else if --config is present:
    use [[llm_api]] from --config
else:
    no configured profiles
```

This preserves existing `--config` behavior while allowing React to load profiles without inheriting Promptpile runtime settings.

---

## 8. Recommended Completion Option: `--api-key-env <name>`

### 8.1 Purpose

Allow a field-level API-key override without making React resolve the secret value itself.

Example:

```bash
promptpile \
  --llm-config ./config.toml \
  --llm-api reasoning \
  --api-key-env OPENAI_API_KEY
```

Promptpile resolves:

```text
process.env["OPENAI_API_KEY"]
```

inside the Promptpile process.

### 8.2 Why this is useful

React currently supports phase-specific `*_llm_api_key_env` configuration. Without `--api-key-env`, React would have to resolve that environment variable itself and pass the secret through `-k`, placing the value in subprocess argv.

With `--api-key-env`, React can pass the environment-variable **name**, not its secret value.

### 8.3 Relationship with `--api-key`

For v1, explicit CLI `--api-key` and `--api-key-env` should be mutually exclusive.

If both are provided:

```text
exit 1
Error: --api-key and --api-key-env cannot be used together
```

This avoids ambiguous explicit overrides.

---

## 9. LLM Configuration Precedence

Configuration precedence must be specified and tested per field.

The migration should preserve existing Promptpile behavior wherever possible rather than silently adopting React's current duplicate resolver behavior.

### 9.1 Profile source precedence

```text
--llm-config
    >
--config (for [[llm_api]] only when --llm-config is absent)
```

### 9.2 Profile name precedence

```text
explicit --llm-api
    >
[promptpile].llm_api from --config
    >
no selected profile
```

`[promptpile].llm_api` is not read from `--llm-config`, because `--llm-config` is profile-database-only.

### 9.3 Field precedence

For model/base URL/temperature/extra body, use:

```text
explicit CLI field override
    >
[promptpile].llm_api_* field from --config
    >
selected [[llm_api]] profile field
    >
Promptpile default
```

Examples of explicit field overrides:

```text
--model
--api-base-url
--temperature
--extra-body
```

Example:

```toml
[[llm_api]]
name = "reasoning"
model = "profile-model"
temperature = 0.8
```

```bash
promptpile \
  --llm-config config.toml \
  --llm-api reasoning \
  --temperature 0.2
```

Resolved values:

```text
model       = profile-model
temperature = 0.2
```

### 9.4 API-key semantics

There is currently a semantic mismatch between Promptpile and React when both a direct API key and an environment-backed key are present in the same configuration layer.

This migration must not hide that mismatch.

For the first CLI-boundary migration, the recommended rule is:

> Keep Promptpile's existing resolution semantics as the canonical semantics, document them, and migrate React to those semantics.

Before implementation, add regression fixtures covering:

- only `api_key`;
- only `api_key_env`;
- both `api_key` and `api_key_env`;
- missing environment variable;
- CLI `--api-key` override;
- CLI `--api-key-env` override;
- profile key plus `[promptpile]` key override.

If a future release wants environment-backed values to take precedence over embedded fallback keys, treat that as a separate intentional behavior change rather than bundling it into this architecture migration.

---

## 10. React Configuration Responsibility After Migration

The objective is **not** to make React configuration-free.

React still owns and may parse:

```toml
[promptpile-react]
max_step = ...
thought_prompt = ...
observe_prompt = ...
check_prompt = ...
final_prompt = ...
thought_llm_api = ...
observe_llm_api = ...
check_llm_api = ...
final_llm_api = ...
...
```

React may also continue to inherit the small set of `[promptpile]` orchestration fields that are part of its documented compatibility behavior, such as directory/quiet/tools/continue/input/default profile name.

The important boundary is:

> React may select a profile and construct explicit phase overrides, but it must not parse the contents of `[[llm_api]]` profiles or reuse Promptpile-private validation helpers.

In other words:

```text
React owns:
  profile name
  phase override intent
  phase orchestration

Promptpile owns:
  profile contents
  profile validation
  default values
  temperature semantics
  extra_body semantics
  API-key resolution
```

---

## 11. React Invocation After Migration

### 11.1 Thought

Conceptually:

```bash
promptpile \
  -d ./messages \
  --llm-config ./config.toml \
  --llm-api reasoning \
  --tools-file ./tools.toml \
  --insert-files ./thought.system.md
```

If React has an explicit Thought override:

```toml
[promptpile-react]
thought_llm_api_temperature = 0.2
```

then React adds only the explicit override:

```bash
--temperature 0.2
```

It does not resolve the profile's base temperature first.

### 11.2 Observe

```bash
promptpile \
  -d ./messages \
  --llm-config ./config.toml \
  --llm-api observer \
  --disable-tool \
  ...
```

### 11.3 Check

```bash
promptpile \
  -d <temporary-empty-directory> \
  --llm-config ./config.toml \
  --llm-api checker \
  --tools-file <temporary-check-tools.toml> \
  --tool-choice function:react_check_decision \
  ...
```

### 11.4 Final

```bash
promptpile \
  -d ./messages \
  --llm-config ./config.toml \
  --llm-api final \
  --disable-tool \
  -c \
  ...
```

### 11.5 Input mode

Instead of importing Promptpile internals:

```text
React reads user terminal input
        |
        v
promptpile conversation append-user -d <directory>
        |
        v
exit 0
        |
        v
start React session
```

React does not need the returned path; successful exit is sufficient.

---

## 12. Binary Resolution

React currently finds Promptpile by resolving the package and assuming:

```text
<promptpile package>/dist/index.js
```

That assumption must be removed.

The `promptpile` package already declares its executable using npm package metadata:

```json
{
  "bin": {
    "promptpile": "dist/index.js"
  }
}
```

React should resolve the declared package binary rather than hardcoding the build path.

Recommended logic:

```text
1. PROMPTPILE_BIN, if explicitly configured
2. installed promptpile package -> read package.json `bin.promptpile`
3. PATH `promptpile` fallback
```

The implemented React integration executes the resolved script via `process.execPath`. Its package-metadata contract is therefore intentionally narrower than a generic npm executable launcher: `bin.promptpile` must point to a Node-compatible entry script. Native executables and custom wrappers remain supported through the explicit `PROMPTPILE_BIN` override. The script path comes from package metadata rather than a fixed `dist/index.js` convention.

This changes the contract from:

```text
"Promptpile's compiled entry file is dist/index.js"
```

to:

```text
"The promptpile npm package declares a Node-compatible promptpile entry script"
```

which is the correct public boundary.

---

## 13. Promptpile Implementation Plan

### Phase 0 — Freeze behavior with tests

Before refactoring, add/confirm fixtures for current behavior:

- message index selection;
- user-message append filename and content;
- temperature parsing;
- extra-body parsing;
- LLM profile loading;
- current profile/default precedence;
- API-key and API-key-env resolution;
- existing `--config` behavior.

The purpose is to distinguish architecture changes from accidental behavior changes.

### Phase 1 — Add `conversation append-user`

Recommended code shape:

```text
src/
  conversation-command.ts       # command adapter
  file-handler.ts               # existing internal implementation
```

The command adapter should call existing internal Promptpile functions. Those functions remain private implementation details; only the CLI contract becomes public.

Do not move functions merely to make them importable by React.

Implementation tasks:

1. add CLI command parsing for `conversation append-user`;
2. read full UTF-8 stdin;
3. validate directory and non-empty content;
4. call existing scanner + append implementation inside Promptpile;
5. preserve atomic-write behavior;
6. print written path unless quiet;
7. return stable exit status;
8. add command tests that verify no LLM/API path is entered.

### Phase 2 — Add profile-only LLM loading

Add:

```text
--llm-config <path>
--llm-api <name>
```

Refactor configuration resolution internally so the following concepts are explicit:

```text
runtime config source
LLM profile source
selected profile
field-level overrides
```

Avoid duplicating a second LLM resolver. The same internal resolution logic should serve:

- normal Promptpile `--config` usage;
- `--llm-config` profile-only usage;
- explicit `--llm-api` selection.

Implementation tasks:

1. parse `--llm-config` and `--llm-api`;
2. separate loading of `[promptpile]` runtime settings from loading of `[[llm_api]]` profiles;
3. implement profile-source precedence;
4. implement strict missing-profile failure for explicit `--llm-api`;
5. preserve existing per-field precedence unless explicitly changed;
6. add config-resolution tests.

### Phase 3 — Add `--api-key-env`

Implementation tasks:

1. add option parsing;
2. reject simultaneous explicit `--api-key` and `--api-key-env`;
3. resolve the named environment variable inside Promptpile;
4. ensure diagnostics never print the resolved secret;
5. add tests for present/missing environment variables;
6. add a regression test proving profile/env-based normal React invocation does not place the resolved API key in argv.

### Phase 4 — Document the new public CLI contract

Update `packages/promptpile/README.md` with:

- `conversation append-user`;
- `--llm-config`;
- `--llm-api`;
- `--api-key-env`;
- profile-source and field precedence;
- examples for orchestration consumers.

---

## 14. React Migration Plan

### Phase 5 — Replace user-message internal imports

Current React code directly calls Promptpile's scanner and append helper.

Replace it with an async subprocess operation, e.g. conceptually:

```text
invokePromptpileAppendUser(directory, content)
```

Behavior:

```text
spawn promptpile conversation append-user -d <directory> -q
write content to child stdin
close stdin
require exit status 0
```

Then delete the direct `promptpile/dist/file-handler` dependency.

### Phase 6 — Stop resolving Promptpile LLM profiles in React

Change React's phase configuration representation.

Today it trends toward a fully resolved shape:

```text
model
apiKey
apiBaseUrl
temperature
extraBody
```

After migration it should represent **selection + explicit overrides**:

```text
profileName?
modelOverride?
apiKeyOverride?          # legacy/direct explicit override only
apiKeyEnvOverride?
apiBaseUrlOverride?
temperatureOverride?
extraBodyOverride?
```

React should no longer need:

```text
LlmApiProfile
loadTomlConfigFile
DEFAULT_TEMPERATURE
coerceTemperatureValue
coerceExtraBodyValue
```

Phase argv construction becomes:

```text
--llm-config <config path>      when profile data comes from that file
--llm-api <phase profile>      when selected
+ explicit phase overrides only
```

### Phase 7 — Remove Promptpile-private type shims

Delete the React declarations that exist only to type unpublished Promptpile modules, including the current equivalents of:

```text
promptpile-file-handler.d.ts
promptpile-imports.d.ts
```

A static architecture test should fail if production React source contains:

```text
promptpile/dist/
```

### Phase 8 — Fix binary discovery

Replace fixed `dist/index.js` resolution with package `bin.promptpile` resolution.

Keep `PROMPTPILE_BIN` as the highest-priority explicit override.

### Phase 9 — Simplify dead React config code

After profile resolution moves back to Promptpile, remove or collapse now-unused React modules/functions, especially code whose only purpose was to emulate Promptpile's LLM config semantics.

Do not retain duplicate resolvers "just in case". The success criterion of this architecture is that Promptpile has one canonical LLM semantic implementation.

---

## 15. Test Plan

### 15.1 Promptpile command tests

`conversation append-user`:

- appends to empty valid directory;
- appends after existing indexed messages;
- preserves multiline content;
- rejects whitespace-only input;
- rejects missing directory;
- rejects non-directory target;
- does not call an LLM;
- does not require API key;
- does not load tools;
- `--quiet` emits no success stdout;
- written file is visible to the normal scanner afterward.

### 15.2 Promptpile LLM configuration tests

Profile source:

- `--llm-config` overrides profile source from `--config`;
- `--config` remains a valid profile source when `--llm-config` is absent;
- non-profile tables in `--llm-config` do not alter runtime behavior.

Profile selection:

- explicit `--llm-api` selects the requested profile;
- explicit missing profile fails;
- selection is case-insensitive if current behavior remains case-insensitive.

Field precedence:

- CLI model > `[promptpile]` model > profile model > default;
- CLI temperature > `[promptpile]` temperature > profile temperature > default;
- CLI extra body > `[promptpile]` extra body > profile extra body;
- equivalent base URL cases;
- API-key cases listed in Section 9.4.

Validation:

- invalid temperature fails through Promptpile's canonical parser;
- invalid extra-body fails through Promptpile's canonical parser;
- malformed profile fails clearly;
- missing API key fails only when a completion actually needs one.

### 15.3 React unit tests

- phase argv contains profile selector instead of expanded profile fields;
- phase-specific explicit overrides are forwarded;
- Observe/Final still disable tools;
- Check still uses its isolated temporary directory/tool selection;
- Continue semantics remain phase-correct;
- input mode invokes append-user before starting the session;
- nonzero append-user exit aborts the round;
- binary resolution honors `PROMPTPILE_BIN`;
- binary resolution follows package `bin` metadata.

### 15.4 Architecture tests

Add a lightweight static test that fails if production React source contains imports matching:

```text
promptpile/dist/
```

Also ensure React does not recreate a full `[[llm_api]]` profile resolver locally.

### 15.5 End-to-end fixtures

Run at least these scenarios through real subprocess boundaries:

1. single Thought phase with profile from shared config;
2. multi-phase React run with distinct profiles;
3. phase-specific temperature override;
4. profile using `api_key_env`;
5. input mode append + React run;
6. continue mode across multiple user rounds;
7. Check phase temporary tools;
8. invalid profile name;
9. invalid temperature/extra body forwarded to Promptpile;
10. executable located through package `bin` metadata.

---

## 16. Compatibility Strategy

The Promptpile-side changes should be additive.

Existing usage such as:

```bash
promptpile --config config.toml ...
```

must continue to work.

Existing CLI flags retain their meaning unless a separate behavior change is explicitly approved and documented.

Migration order is important:

```text
1. release/add Promptpile CLI capability
2. verify capability with integration tests
3. migrate React to the new capability
4. remove internal imports
```

Do not remove the internal React dependencies before the replacement CLI functionality exists and is covered by tests.

During monorepo development both sides can change in one commit, but tests should still reflect this logical ordering.

---

## 17. Failure and Diagnostic Rules

For orchestration consumers, predictable failures matter more than elaborate formatting.

Rules:

- normal result data: stdout;
- diagnostics/errors: stderr;
- secrets: never printed;
- nonzero exit means the requested operation did not complete successfully;
- error text should identify the failed domain concept (`LLM API profile`, `directory`, `temperature`, etc.);
- React should propagate a concise stderr tail when a Promptpile subprocess fails.

The new CLI features do not require a general JSON-RPC protocol.

---

## 18. Security Considerations

### 18.1 Avoid unnecessary secret propagation

Preferred flow:

```text
config / environment
        |
        v
   Promptpile process
```

Avoid when possible:

```text
config
  |
  v
React memory
  |
  v
-k <secret> argv
  |
  v
Promptpile
```

`--llm-config`, profile-owned `api_key_env`, and `--api-key-env` reduce the need for React to handle resolved secrets.

### 18.2 Do not expose resolved config containing secrets

This proposal intentionally does **not** add:

```text
promptpile config resolve --json
```

because React does not need a round trip of:

```text
Promptpile -> resolved secrets -> React -> Promptpile
```

Keeping the resolution inside the completion process is simpler and safer.

---

## 19. Performance Considerations

This design does not introduce an extra subprocess for each LLM configuration operation.

Before:

```text
React resolves profile in-process
React spawns Promptpile for Thought
```

After:

```text
React spawns Promptpile for Thought
Promptpile resolves profile inside that existing process
```

The same is true for Observe, Check, and Final.

The only added process in normal React input mode is:

```text
promptpile conversation append-user
```

which is a small filesystem operation relative to an agent session and is justified by the cleaner package boundary.

---

## 20. Risks and Mitigations

### Risk: CLI grows into a generic RPC surface

Mitigation:

- require new commands to represent complete domain operations;
- reject helper-shaped commands such as `parse-*`, `get-*`, or `next-index` unless independently useful to real CLI users.

### Risk: configuration precedence changes accidentally

Mitigation:

- freeze existing Promptpile behavior with tests first;
- specify precedence per field;
- treat any desired semantic cleanup as a separate change.

### Risk: React still duplicates part of Promptpile config semantics

Mitigation:

- React may parse its own orchestration schema and explicit overrides;
- React must not inspect/resolve `[[llm_api]]` contents;
- add architecture tests and remove old helper modules.

### Risk: CLI protocol becomes hard to evolve

Mitigation:

- keep the machine-facing output minimal;
- use exit status where sufficient;
- add structured output only when a real consumer needs it;
- avoid exposing internal data structures.

### Risk: npm binary resolution remains coupled to package layout

Mitigation:

- use declared `bin.promptpile` metadata, not a hardcoded file path.

### Risk: concurrent writers still race

Mitigation:

- keep scan/index/write inside one domain command;
- explicitly leave full multi-writer coordination out of scope;
- address locking/transaction semantics separately if Promptpile becomes a concurrent multi-process store.

---

## 21. Non-Goals

This proposal does not attempt to:

- create `promptpile-core`;
- turn every internal Promptpile helper into public API;
- create a general JSON-RPC protocol over stdio;
- redesign the Promptpile message-file format;
- redesign MCP execution;
- add full multi-writer transactional locking;
- redesign the React state machine;
- unify all monorepo package versions;
- remove the existing `--config` behavior;
- make React unaware of its own configuration schema.

---

## 22. Files Expected to Change

Indicative, not exhaustive.

### `packages/promptpile`

Likely changes:

```text
src/cli.ts
src/index.ts
src/resolve-config.ts
src/toml-config.ts
src/file-handler.ts              # preferably minimal/no public-surface change
new command adapter module(s)
test/*
README.md
```

### `packages/promptpile-react`

Likely changes:

```text
src/append-user-message.ts       # replace internal import with subprocess adapter
src/promptpile-invoker.ts        # stdin support + bin metadata resolution
src/build-phase-argv.ts          # profile selector + explicit overrides
src/resolve-react-config.ts
src/toml-config-react.ts
src/resolve-llm-profile.ts       # remove or significantly simplify
src/types.ts
src/promptpile-file-handler.d.ts # delete
src/promptpile-imports.d.ts      # delete
test/*
README.md
```

---

## 23. Suggested Implementation Sequence

A practical commit sequence:

```text
Commit 1
  test(promptpile): freeze config and append semantics

Commit 2
  feat(promptpile): add conversation append-user command

Commit 3
  feat(promptpile): add --llm-config and --llm-api

Commit 4
  feat(promptpile): add --api-key-env

Commit 5
  test(promptpile): add CLI contract and precedence integration coverage

Commit 6
  refactor(react): append user through promptpile CLI

Commit 7
  refactor(react): delegate LLM profile resolution to promptpile

Commit 8
  refactor(react): resolve promptpile executable from package bin metadata

Commit 9
  cleanup(react): remove promptpile/dist imports and declaration shims

Commit 10
  docs: document final CLI boundary and migration result
```

These can be squashed later; the sequence is useful because each step has a clear verification boundary.

---

## 24. Acceptance Criteria

The migration is complete when all of the following are true:

- [x] `promptpile conversation append-user` exists and never invokes an LLM.
- [x] `--llm-config` loads only `[[llm_api]]` profile data.
- [x] `--llm-api` selects a named profile and explicit missing profiles fail.
- [x] `--api-key-env` is available or an equivalent safe mechanism preserves React's phase-specific env override capability.
- [x] Existing Promptpile `--config` behavior remains covered and compatible.
- [x] React no longer imports `promptpile/dist/file-handler`.
- [x] React no longer imports `promptpile/dist/llm-sampling`.
- [x] React no longer imports `promptpile/dist/llm-extra-body`.
- [x] React no longer imports `promptpile/dist/toml-config`.
- [x] React no longer assumes the executable is at `dist/index.js`.
- [x] React does not resolve `[[llm_api]]` profile contents itself.
- [x] Thought / Observe / Check / Final behavior remains covered by integration tests.
- [x] Input and continue modes remain behaviorally correct.
- [x] No resolved API key is unnecessarily passed through argv for profile/env-based configuration.
- [x] Production React source contains zero `promptpile/dist/` references.
- [x] Root and package documentation describe the CLI boundary as the supported integration model.

---

## 25. Final Target Architecture

```text
                     promptpile-react
                           |
                           | orchestration decisions
                           |
                           | promptpile CLI args + stdin
                           v
                     +------------+
                     | promptpile |
                     +------------+
                      |          |
          message/artifact files | LLM/API
                      |          |
                      v          v
                conversation   provider

Public boundary:
  - documented CLI
  - documented files/artifacts

Private boundary:
  - scanners
  - config parsers
  - sampling parsers
  - extra-body parsers
  - internal TypeScript types
  - compiled file layout
```

The architectural test is simple:

> Could Promptpile reorganize all of its internal TypeScript modules without changing documented CLI/file behavior and without requiring a React code change?

After this migration, the answer should be **yes**.
