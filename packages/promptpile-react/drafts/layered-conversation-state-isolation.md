# Draft · ReAct layered Conversation state isolation

> Status: Draft / non-normative  
> Scope: `promptpile-react` orchestration state ownership  
> Goal: prevent intermediate ReAct phases from mutating the caller's canonical Conversation while preserving Promptpile's file-native / CLI-first architecture.

## 1. Problem

`promptpile-react` currently treats Thought and Final as real Conversation continuations when `--continue` is enabled.

Conceptually:

```text
canonical Conversation
  User
  Assistant Thought
  Assistant Final
```

This makes an orchestration-internal phase (`Thought`) indistinguishable from an assistant message that was actually presented to the caller.

The problem is not that Thought is persisted to disk. Promptpile is intentionally file-native. The problem is **authority**: a temporary orchestration artifact is published into the authoritative Conversation history.

This leaks execution topology into conversation topology:

```text
ReAct phase != Conversation turn
```

A hypothesis considered and rejected during Thought can therefore become durable history and influence later turns as if the assistant had actually said it.

## 2. Design constraints

The fix should preserve Promptpile's existing architecture rather than introduce a new Agent Runtime abstraction.

Keep these boundaries:

```text
promptpile
= one completion primitive
= Conversation scan / assembly
= Conversation mutation / OCC
= output artifacts

promptpile-react
= orchestration policy
= phase ordering
= temporary workspace lifecycle
```

Non-goals:

- Do not add an `AgentRun` public protocol to Promptpile core.
- Do not teach Promptpile core what Thought / Observe / Check / Final mean.
- Do not make React import Promptpile private runtime code.
- Do not make React implement Conversation idx allocation, OCC, or canonical message publication itself.
- Do not require `promptpile-fork` for every React invocation.

## 3. Proposed model

Use existing layered Conversation I/O to separate authoritative history from the current ReAct working layer.

```text
history/                     react/
canonical Conversation       ephemeral Conversation layer
read-only during ReAct       owned by promptpile-react

User                         Thought
Assistant Final              intermediate tool artifacts
User                         additional internal continuation
...
```

Model context during intermediate phases is:

```text
history + react
```

Mutation target during intermediate phases is only:

```text
react
```

The central invariant is:

```text
Intermediate orchestration phases
MUST NOT mutate the caller's canonical Conversation.
```

Only a successfully completed Final response may be published back to `history`.

## 4. Lifecycle

### 4.1 User input

The caller's user message remains canonical Conversation state.

```text
history/
  ...
  [N]user.md
```

This can continue to use Promptpile's existing append-user semantics.

### 4.2 Create React-owned ephemeral layer

For one React invocation, create a temporary physical Conversation directory:

```text
/tmp/promptpile-react-<unique-id>/
```

This directory is an orchestration implementation detail. It does not require a new public protocol or package-level domain concept.

### 4.3 Thought

Run Promptpile with canonical history as a read-only layer and the temporary React directory as the unique writable output layer.

Conceptually:

```bash
promptpile \
  -d history \
  --output-dir react \
  -c \
  ...thought phase args
```

Because `--output-dir react` is also the final input layer, Thought sees:

```text
history + prior react artifacts
```

but its assistant continuation is committed only into `react/`.

### 4.4 Observe

Observe should read the same layered context:

```text
history + react
```

It may continue to emit its observation through an ordinary temporary output artifact (`-o`) rather than canonical Conversation mutation.

This preserves within-run continuity: Observe can see Thought without requiring Thought to become permanent history.

### 4.5 Check

The current isolated Check design can remain conceptually unchanged:

```text
check prompt + observe report
```

in an isolated temporary Conversation, with `react_check_decision` as the machine decision boundary.

### 4.6 Additional iterations

If Check requests another iteration, subsequent Thought calls continue reading:

```text
history + react
```

and append only to `react/`.

This means intermediate reasoning is durable enough for the current React process and crash/debug inspection, but it has no canonical Conversation authority.

### 4.7 Final generation

Final must read:

```text
history + react
```

and generate the caller-visible answer without immediately mutating `history`.

Use an explicit result transport such as:

```text
-o <temporary-final-file>
```

or the existing private output-pile transport for streaming.

At this point the Final body is a generated artifact, not yet canonical Conversation state.

### 4.8 Final publication

After Final generation has reached its required success witness, publish exactly that Final assistant message into `history`.

Desired semantic operation:

```text
generated Final artifact
        ↓
validate React terminal success
        ↓
append assistant to canonical history
```

Then remove the React temporary directory on best-effort cleanup.

Successful canonical history becomes:

```text
User
Assistant Final
User
Assistant Final
```

not:

```text
User
Assistant Thought
Assistant Final
```

## 5. Small missing primitive: append-assistant

Current layered completion couples two concerns:

```text
--output-dir
= writable Conversation directory
= automatically the final input layer
```

For Final generation we want input ordering:

```text
history -> react
```

but publication target:

```text
history
```

Using `--output-dir history` for that same completion would move `history` to the final layer, which does not express the desired ordering cleanly.

React should also not manually create `[N]assistant.md`, because that would duplicate Promptpile-owned idx allocation, fingerprint/OCC, atomic publication, and conflict semantics.

Preferred small generic addition to `promptpile`:

```bash
promptpile conversation append-assistant -d <history>
```

with assistant body from stdin or an explicit input file.

This should be symmetric with the existing `conversation append-user` operation and should own:

- next-index allocation;
- Conversation OCC / expected condition handling where applicable;
- protocol-valid assistant artifact naming;
- atomic file publication;
- conflict exit semantics.

It must remain a generic Conversation primitive. It must not know anything about React or Final phases.

Then React becomes:

```text
1. append user -> history
2. create react temp dir
3. Thought / intermediate continuation -> react
4. Observe / Check -> orchestration-local artifacts
5. Final reads history + react -> temporary output / stream
6. append-assistant Final -> history
7. cleanup react temp dir
```

## 6. Why not introduce AgentRun / Scratch as a public Promptpile concept

Promptpile's design intentionally keeps orchestration outside the execution primitive.

The temporary directory already has all semantics React needs:

```text
physical files
+ Conversation Protocol
+ layered reads
+ one writable output layer
```

Its lifetime and meaning are owned by `promptpile-react`.

Promoting it into a shared `AgentRun` protocol would expand core/ecosystem ownership without demonstrated cross-package need, and would move Promptpile toward a heavier agent runtime.

The design should therefore distinguish:

```text
public primitive: Conversation layer
private policy:    React uses one layer ephemerally
```

rather than introducing a new public state domain.

## 7. Why `promptpile-fork` is not required

A physical fork could also isolate intermediate reasoning, but it copies a selected Conversation prefix and introduces an additional package/runtime operation.

Layered I/O already expresses the desired semantics more directly:

```text
history read-only
+
react read/write
```

Therefore the default React implementation should prefer a fresh ephemeral output layer over a full Conversation fork.

Fork remains useful when a caller explicitly needs an independent physical snapshot; it is not necessary merely to isolate ReAct intermediate state.

## 8. Failure semantics

The proposal should preserve explicit failure boundaries.

### Failure before Final

```text
history unchanged except already-committed user input
react may contain partial intermediate state
no assistant Final published
```

### Final generation failure

```text
history unchanged except user input
no canonical assistant publication
react/temp output may remain for cleanup/debug
```

### Final publication conflict

If canonical history changed after React began, append-assistant should fail with normal Conversation conflict semantics rather than silently publishing against stale history.

React may report the conflict and retain enough local artifacts for diagnosis; it must not rewrite or merge canonical history itself.

### Success

A successful React invocation implies:

```text
Final generation reached its required terminal witness
AND
exactly one caller-visible assistant Final was published to canonical history
```

Intermediate Thought/Observe/Check text is not canonical Conversation state.

## 9. Streaming

Agent Event Protocol behavior should remain compatible in spirit:

- phase lifecycle events remain machine-visible;
- Thought/Observe/Check bodies remain hidden;
- Final deltas may stream in real time;
- canonical publication happens only after the Final completion is known to be valid.

Streaming a delta to the caller and publishing canonical history are separate effects. If the stream was partially observed but Final generation ultimately fails, no successful assistant Conversation artifact should be committed.

## 10. Expected architectural result

After this change the ownership model becomes:

```text
Canonical Conversation
  owned by caller / Promptpile Conversation mutation semantics
  contains user-visible dialogue truth

React ephemeral Conversation layer
  owned by promptpile-react
  contains orchestration-internal continuation
  exists only for the current React invocation

Final output artifact / stream
  generated result transport
  not canonical until explicit assistant publication
```

The key semantic rule is:

```text
what the model considered
!=
what the assistant told the caller
```

Promptpile core stays a generic single-completion / Conversation primitive; `promptpile-react` fixes the state-authority boundary using the composition mechanisms that already exist.

## 11. Implementation sketch

Likely work areas:

### `promptpile-react`

- create and own one ephemeral Conversation directory per invocation;
- route Thought continuation to that directory;
- ensure Observe/next Thought/Final read `history + react` in that order;
- keep Check isolated;
- generate Final through output artifact / output-pile rather than direct canonical `-c`;
- call generic assistant publication only after Final success;
- cleanup ephemeral directory best-effort;
- add multi-turn regression tests proving hidden Thought never appears in canonical history.

### `promptpile`

Potential minimal generic addition only:

```text
conversation append-assistant
```

No React-specific logic should enter Promptpile core or `promptpile-protocol` unless a separately justified protocol change is required.

## 12. Required tests

At minimum:

1. One React turn leaves canonical history as `User -> Final` only.
2. Thought is visible to Observe and Final within the same invocation.
3. A second user turn does not replay the previous invocation's Thought.
4. Multi-step React iterations share the ephemeral layer correctly.
5. Thought failure publishes no Final.
6. Final generation failure publishes no assistant message.
7. Canonical history conflict before Final publication fails closed.
8. Streaming Final deltas do not imply canonical publication before terminal success.
9. Temporary React cleanup failure does not corrupt an already successful canonical publication.
10. Layer order remains `history -> react` for every intermediate and Final model request.

## 13. Open questions

- Should `append-assistant` accept stdin only, `--input-file`, or both?
- Should React retain failed ephemeral directories under an opt-in debug mode instead of always cleaning them?
- What exact fingerprint/baseline should React capture before model execution so Final publication detects concurrent canonical history mutation?
- Should successful React temporary state ever be retained for diagnostics, or should Agent Event / debug logging remain the only supported trace surface?
- Does Final publication need calls/extra sidecars in any supported React mode, or is plain assistant body sufficient for v1?

These are implementation/contract details. They do not change the central proposal: **canonical history is one directory, current ReAct continuation is another writable directory, and only the successful Final is explicitly published back to canonical history.**
