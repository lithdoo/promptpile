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
= process-directory lifecycle
```

Non-goals:

- Do not add an `AgentRun` public protocol to Promptpile core.
- Do not teach Promptpile core what Thought / Observe / Check / Final mean.
- Do not make React import Promptpile private runtime code.
- Do not make React implement Conversation idx allocation, OCC, or canonical message publication itself.
- Do not require `promptpile-fork` for every React invocation.
- Do not make React decide which intermediate facts deserve long-term memory.
- Do not make React automatically summarize, archive, promote, retrieve, or rewrite process information into canonical history.

The important distinction is:

```text
execution continuity
!=
application memory
```

`promptpile-react` owns the former only.

## 3. Proposed model

Use existing layered Conversation I/O to separate authoritative history from the current ReAct process layer.

```text
history/                     process/
canonical Conversation       ReAct working Conversation layer
read-only during ReAct       owned/selected by promptpile-react caller

User                         Thought
Assistant Final              intermediate tool artifacts
User                         additional internal continuation
...
```

Model context during intermediate phases is:

```text
history + process
```

Mutation target during intermediate phases is only:

```text
process
```

The central invariant is:

```text
Intermediate orchestration phases
MUST NOT mutate the caller's canonical Conversation.
```

Only a successfully completed Final response may be published back to `history`.

The default canonical history therefore remains:

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

## 4. Process directory as the React extension boundary

The ReAct working layer should be exposed as an explicit directory boundary rather than promoted into a new public AgentRun protocol.

Conceptually React may accept an option such as:

```bash
promptpile-react \
  -d ./history \
  --process-dir ./react-process
```

The exact option name is not frozen by this draft; `--process-dir`, `--work-dir`, or another concise name may be chosen during CLI contract design.

### 4.1 Default behavior

If the caller does not provide a process directory, React creates a fresh temporary physical Conversation directory for the invocation:

```text
/tmp/promptpile-react-<unique-id>/
```

React may remove that directory after the invocation completes.

This keeps the default behavior simple and leaves canonical history containing only caller-visible dialogue.

### 4.2 Caller-provided process directory

If the caller explicitly provides a process directory, React uses that directory as the working Conversation layer and does not treat it as disposable internal storage.

Conceptually:

```text
caller selected process directory
        ↓
promptpile-react writes execution continuation
        ↓
caller / another package decides what happens next
```

React should not automatically summarize, rewrite, archive, or merge the directory into canonical history.

This creates a clean extension boundary:

```text
promptpile-react
      ↓
process directory
      ↓
optional independent consumers
```

### 4.3 Authority rule

Whether the process directory is temporary or caller-retained does not change its authority:

```text
process directory
!=
canonical Conversation
```

Its contents may be useful for diagnostics, analysis, later summarization, or another orchestration layer, but they do not become canonical history merely because they remain on disk.

This preserves a critical distinction:

```text
ephemeral authority
!=
ephemeral storage
```

The process layer loses canonical replay authority when the React invocation ends, even if its files are retained.

## 5. Lifecycle

### 5.1 User input

The caller's user message remains canonical Conversation state.

```text
history/
  ...
  [N]user.md
```

This can continue to use Promptpile's existing append-user semantics.

### 5.2 Resolve process directory

React resolves one process directory for the invocation.

```text
explicit --process-dir
        │
        ├─ yes → use caller-selected directory
        │
        └─ no  → create temporary directory
```

This directory is a physical Conversation layer, not a new protocol domain.

### 5.3 Thought

Run Promptpile with canonical history as a read-only layer and the process directory as the unique writable output layer.

Conceptually:

```bash
promptpile \
  -d history \
  --output-dir process \
  -c \
  ...thought phase args
```

Because `--output-dir process` is also the final input layer, Thought sees:

```text
history + prior process artifacts
```

but its assistant continuation is committed only into `process/`.

### 5.4 Observe

Observe should read the same layered context:

```text
history + process
```

It may continue to emit its observation through an ordinary temporary output artifact (`-o`) rather than canonical Conversation mutation.

This preserves within-invocation continuity: Observe can see Thought without requiring Thought to become permanent history.

The process directory should contain the artifacts naturally needed for ReAct execution continuity. React should not start duplicating every internal phase into extra trace files merely to anticipate future consumers.

### 5.5 Check

The current isolated Check design can remain conceptually unchanged:

```text
check prompt + observe report
```

in an isolated temporary Conversation, with `react_check_decision` as the machine decision boundary.

Check isolation remains useful because the Check model only needs the observation report and decision tool, not the full Conversation.

### 5.6 Additional iterations

If Check requests another iteration, subsequent Thought calls continue reading:

```text
history + process
```

and append only to `process/`.

Thus the process directory provides **execution continuity within the current ReAct invocation** without becoming canonical cross-turn dialogue history.

### 5.7 Final generation

Final must read:

```text
history + process
```

and generate the caller-visible answer without immediately mutating `history`.

Use an explicit result transport such as:

```text
-o <temporary-final-file>
```

or the existing private output-pile transport for streaming.

At this point the Final body is a generated artifact, not yet canonical Conversation state.

### 5.8 Final publication

After Final generation has reached its required success witness, publish exactly that Final assistant message into `history`.

Desired semantic operation:

```text
generated Final artifact
        ↓
validate React terminal success
        ↓
append assistant to canonical history
```

Successful canonical history becomes:

```text
User
Assistant Final
User
Assistant Final
```

The process directory remains non-canonical regardless of whether it is later deleted or retained.

### 5.9 Process directory completion

After successful Final publication:

```text
if process directory was implicit temporary storage
  → React may clean it up best-effort

if process directory was explicitly provided by caller
  → React leaves it intact
```

React does not perform long-term knowledge promotion as part of this step.

## 6. Small missing primitive: append-assistant

Current layered completion couples two concerns:

```text
--output-dir
= writable Conversation directory
= automatically the final input layer
```

For Final generation we want input ordering:

```text
history -> process
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
2. resolve process directory
3. Thought / intermediate continuation -> process
4. Observe / Check -> orchestration-local outputs
5. Final reads history + process -> temporary output / stream
6. append-assistant Final -> history
7. clean up only implicit temporary process storage
```

## 7. Why not introduce AgentRun / Scratch as a public Promptpile concept

Promptpile's design intentionally keeps orchestration outside the execution primitive.

The process directory already has all semantics React needs:

```text
physical files
+ Conversation Protocol
+ layered reads
+ one writable output layer
```

Its lifecycle and meaning are owned by `promptpile-react` and its caller.

Promoting it into a shared `AgentRun` protocol would expand core/ecosystem ownership without demonstrated cross-package need, and would move Promptpile toward a heavier agent runtime.

The design should therefore distinguish:

```text
public primitive: Conversation layer
React policy:     use one layer as process state
```

rather than introducing a new public state domain.

## 8. Why `promptpile-fork` is not required

A physical fork could also isolate intermediate reasoning, but it copies a selected Conversation prefix and introduces an additional package/runtime operation.

Layered I/O already expresses the desired semantics more directly:

```text
history read-only
+
process read/write
```

Therefore the default React implementation should prefer a fresh process output layer over a full Conversation fork.

Fork remains useful when a caller explicitly needs an independent physical snapshot; it is not necessary merely to isolate ReAct intermediate state.

## 9. Why React should not own process-to-history refinement

Once the process directory is available as a stable filesystem boundary, callers may want to use its contents for more advanced behavior:

```text
process/
  ↓
summarize
promote facts
archive
build memory
rewrite/compact context
```

Those are useful capabilities, but they are not intrinsic to ReAct orchestration.

Putting them directly into `promptpile-react` would expand its responsibilities from:

```text
Thought / Observe / Check / Final orchestration
```

into:

```text
orchestration
+ memory policy
+ retention policy
+ summarization
+ history rewriting
+ retrieval
```

That would move the package away from Promptpile's small-primitives / explicit-composition design.

Instead, the process directory should be an **optional consumer boundary**, similar in spirit to how `promptpile-compress` independently owns Conversation lifecycle mutation.

Conceptually:

```text
promptpile-react
      ↓
process directory
      ↓
optional independent package
      ↓
summary / archive / selected history update
```

Possible future packages might perform process summarization, memory extraction, or archive production, but none are required or named by this draft.

The key ownership rule is:

```text
React produces execution material.
Another component may interpret it.
```

Any component that updates canonical Conversation must do so through an explicit, separately owned mutation boundary rather than gaining authority merely by reading the process directory.

## 10. Failure semantics

The proposal should preserve explicit failure boundaries.

### Failure before Final

```text
history unchanged except already-committed user input
process may contain partial intermediate state
no assistant Final published
```

If the process directory was caller-provided, it remains available to the caller.

If it was implicit temporary storage, React may clean it up or retain it long enough for its existing diagnostics policy; exact failure cleanup is an implementation detail and should not change canonical history semantics.

### Final generation failure

```text
history unchanged except user input
no canonical assistant publication
process/temp output may remain according to process-dir ownership
```

### Final publication conflict

If canonical history changed after React began, append-assistant should fail with normal Conversation conflict semantics rather than silently publishing against stale history.

React may report the conflict; it must not rewrite or merge canonical history itself.

### Success

A successful React invocation implies:

```text
Final generation reached its required terminal witness
AND
exactly one caller-visible assistant Final was published to canonical history
```

Intermediate Thought/Observe/Check content is not canonical Conversation state.

## 11. Streaming

Agent Event Protocol behavior should remain compatible in spirit:

- phase lifecycle events remain machine-visible;
- Thought/Observe/Check bodies remain hidden;
- Final deltas may stream in real time;
- canonical publication happens only after the Final completion is known to be valid.

Streaming a delta to the caller and publishing canonical history are separate effects. If the stream was partially observed but Final generation ultimately fails, no successful assistant Conversation artifact should be committed.

Providing a process directory does not change Agent Event visibility rules. Filesystem retention and machine-stream visibility are independent concerns.

## 12. Expected architectural result

After this change the ownership model becomes:

```text
Canonical Conversation
  owned by caller / Promptpile Conversation mutation semantics
  contains caller-visible dialogue truth

React process Conversation layer
  selected/owned by promptpile-react caller
  contains execution continuation needed by ReAct
  never gains canonical authority automatically

Final output artifact / stream
  generated result transport
  not canonical until explicit assistant publication

Optional process consumer
  separate package/application policy
  may analyze or transform process material
  may update other state only through its own explicit mutation boundary
```

The key semantic rules are:

```text
what the model considered
!=
what the assistant told the caller
```

and:

```text
process material retained on disk
!=
process material replayed as canonical history
```

Promptpile core stays a generic single-completion / Conversation primitive; `promptpile-react` fixes the state-authority boundary using the composition mechanisms that already exist.

## 13. Implementation sketch

Likely work areas:

### `promptpile-react`

- accept or resolve one process Conversation directory per invocation;
- create temporary process storage when caller does not provide one;
- route Thought continuation to that directory;
- ensure Observe/next Thought/Final read `history + process` in that order;
- keep Check isolated;
- generate Final through output artifact / output-pile rather than direct canonical `-c`;
- call generic assistant publication only after Final success;
- clean up only React-created temporary process storage;
- leave caller-provided process directories intact;
- do not add automatic summarization/memory/history-promotion logic;
- add multi-turn regression tests proving hidden Thought never appears in canonical history.

### `promptpile`

Potential minimal generic addition only:

```text
conversation append-assistant
```

No React-specific logic should enter Promptpile core or `promptpile-protocol` unless a separately justified protocol change is required.

### Optional future consumers

Independent packages may consume the process directory for:

```text
summarization
selected fact promotion
archive production
memory extraction
context lifecycle mutation
```

These are intentionally outside the scope of `promptpile-react`.

## 14. Required tests

At minimum:

1. One React turn leaves canonical history as `User -> Final` only.
2. Thought is visible to Observe and Final within the same invocation.
3. A second user turn does not replay the previous invocation's Thought from canonical history.
4. Multi-step React iterations share the process layer correctly.
5. Thought failure publishes no Final.
6. Final generation failure publishes no assistant message.
7. Canonical history conflict before Final publication fails closed.
8. Streaming Final deltas do not imply canonical publication before terminal success.
9. Layer order remains `history -> process` for every intermediate and Final model request.
10. An implicit process directory can be cleaned up without affecting canonical history.
11. An explicit caller-provided process directory remains intact after success.
12. Retaining an explicit process directory does not cause its Thought messages to appear in canonical history on the next React invocation unless the caller explicitly supplies that directory as context.
13. React does not mutate caller-provided process content after its own required execution/publication lifecycle has ended.

## 15. Open questions

- What should the public CLI option for the process directory be named: `--process-dir`, `--work-dir`, or another term?
- Should an explicitly provided process directory be required to be empty at invocation start, or may callers intentionally continue an existing process layer?
- If continuation of an existing process layer is allowed, what ownership/precondition rules distinguish intentional reuse from accidental stale state?
- Should `append-assistant` accept stdin only, `--input-file`, or both?
- What exact fingerprint/baseline should React capture before model execution so Final publication detects concurrent canonical history mutation?
- Does Final publication need calls/extra sidecars in any supported React mode, or is plain assistant body sufficient for v1?
- Should implicit temporary process directories be retained on failure for diagnostics, or should the existing debug surface remain the only supported retention mechanism?

These are implementation/contract details. They do not change the central proposal:

> **Canonical history is one directory, the current ReAct process is another writable Conversation directory, canonical history keeps only the successful Final by default, and callers may explicitly retain the process directory for independent downstream refinement without making that refinement part of `promptpile-react`.**
