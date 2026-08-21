# Draft · ReAct temporary output directory and Conversation state isolation

> Status: Draft / non-normative  
> Scope: `promptpile-react` orchestration state handling  
> Goal: prevent ReAct intermediate artifacts from being written into canonical Conversation history by using Promptpile's existing layered Conversation I/O.

## 1. Problem

`promptpile-react` currently writes intermediate ReAct phases into the same Conversation directory as user-visible history.

Conceptually:

```text
history/
  User
  Thought
  Tool result
  Final
```

The problem is not that intermediate artifacts exist on disk. Promptpile is intentionally file-native.

The problem is that the output directory is wrong:

```text
ReAct execution state != canonical Conversation history
```

Thought, Observe, Tool and Check are internal orchestration artifacts. They should not become future Conversation truth.

## 2. Design principle

Do not introduce a new Agent Runtime abstraction.

Promptpile already provides the required primitive:

```text
Conversation layers
+
read layers
+
output directory
```

The fix is not adding a new state model. The fix is routing intermediate output into a temporary writable layer.

## 3. Model

Use two directories:

```text
history/
  canonical user-visible Conversation

react-temp/
  current ReAct execution artifacts
```

Intermediate phases read:

```text
history + react-temp
```

Intermediate phases write:

```text
react-temp
```

Final generation reads:

```text
history + react-temp
```

Final output writes:

```text
history
```

Result:

```text
history/
  User
  Assistant Final

react-temp/
  Thought
  Tool
  Observe
  Check
```

## 4. Lifecycle

### User input

User messages continue to be appended to canonical history.

```text
history/
  [N]-user.md
```

### React temporary layer

Each React invocation creates a temporary directory:

```text
/tmp/promptpile-react-<id>/
```

This is an implementation detail of `promptpile-react`, not a new public protocol concept.

### Intermediate phases

Thought, Observe, Tool and Check use:

```text
input:
  history + react-temp

output:
  react-temp
```

This keeps within-run continuity while preventing canonical history pollution.

### Final

Final continues to read:

```text
history + react-temp
```

but publishes only the final assistant response into canonical history.

Canonical history becomes:

```text
User
Assistant Final
```

not:

```text
User
Assistant Thought
Assistant Final
```

## 5. Why not promptpile-fork

`promptpile-fork` creates an independent Conversation snapshot.

React isolation does not require a new Conversation. It only requires a temporary writable layer.

Existing layered I/O already expresses the desired behavior:

```text
history (read-only)
+
react-temp (read/write)
```

Fork remains useful for explicit snapshot workflows, not ordinary ReAct execution isolation.

## 6. Why not AgentRun / Scratch abstraction

Promptpile's boundary remains:

```text
promptpile
= Conversation primitive + single completion

promptpile-react
= orchestration policy
```

The lifetime and meaning of the temporary directory belong to React. They do not need to become shared Promptpile domain concepts.

## 7. Implementation direction

### promptpile-react

- create one temporary output directory per React invocation;
- route Thought / Observe / Tool / Check writes there;
- keep all intermediate reads as `history + react-temp`;
- write only successful Final output back to history;
- cleanup temporary directory after completion;
- add regression tests proving Thought never appears in canonical history.

### promptpile

No React-specific logic should be added.

The existing layered Conversation mechanism should remain the only abstraction required.

## 8. Tests

Required cases:

1. React execution leaves canonical history as `User -> Final` only.
2. Thought is available to later phases in the same React run.
3. A later user turn does not replay previous Thought artifacts.
4. Multiple React iterations share the same temporary layer.
5. Final failure does not publish an assistant message.
6. Temporary cleanup failure does not corrupt successful history.
7. Every intermediate phase uses:

```text
read:  history + react-temp
write: react-temp
```

## 9. Final architecture

```text
Canonical Conversation

history/
  user
  assistant final


React execution layer

react-temp/
  thought
  tool
  observe
  check
```

The core rule:

```text
what the model considered
!=
what the assistant told the caller
```

Promptpile remains a generic Conversation primitive. `promptpile-react` only needs to use the existing layered filesystem model correctly.
