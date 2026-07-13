# Task 3 — FIFO Concurrency Semaphore (`CircuitBreaker`)

> **Semantic clarification:** Despite the historical name `CircuitBreaker`,
> this class is **not** a failure-rate circuit breaker. It is a **FIFO
> concurrency semaphore** that caps the number of in-flight provider queries
> and queues additional requests in arrival order. The name is preserved so
> the Provider DI graph keeps a single injection point.

## Files

- Created: `apps/agent/src/error/CircuitBreaker.ts`
- Created: `apps/agent/src/__tests__/CircuitBreaker.test.ts`

No other files touched. `apps/web` untouched. Task 1/2 work merged in from
`worktree-p4-error-handling` (`feat(agent): classify SDK and runtime errors`,
`feat(agent): add bounded retry strategy`) for the joint test run.

## Public API

```ts
new CircuitBreaker({ limit?: number })           // default 5
run<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T>
stats(): { limit, active, queued }
close(reason?: unknown): void
```

## TDD evidence

### RED

Test file `CircuitBreaker.test.ts` written first with the three scenarios from
the brief (5 concurrent + 6th queued, FIFO + release-on-rejection, abort
removes waiter without consuming slot).

```
$ ./node_modules/.bin/vitest run src/__tests__/CircuitBreaker.test.ts
Error: Failed to load url ../error/CircuitBreaker.js … Does the file exist?
Test Files  1 failed (1)
Tests       no tests
```

Failed for the right reason: module missing.

### GREEN

`CircuitBreaker.ts` implemented, then:

```
$ ./node_modules/.bin/vitest run src/__tests__/CircuitBreaker.test.ts
✓ src/__tests__/CircuitBreaker.test.ts (3 tests) 7ms
Test Files  1 passed (1)
Tests       3 passed (3)
```

### Joint run (Task 1–3)

```
$ ./node_modules/.bin/vitest run \
    src/__tests__/CircuitBreaker.test.ts \
    src/__tests__/ErrorClassifier.test.ts \
    src/__tests__/RetryStrategy.test.ts
✓ src/__tests__/CircuitBreaker.test.ts (3 tests)  8ms
✓ src/__tests__/ErrorClassifier.test.ts (14 tests) 9ms
✓ src/__tests__/RetryStrategy.test.ts (5 tests)   12ms
Test Files  3 passed (3)
Tests       22 passed (22)
```

### Agent typecheck

```
$ ./node_modules/.bin/tsc --noEmit
(no output, exit 0)
```

### `git diff --check`

```
$ git diff --check
warning: LF will be replaced by CRLF the next time Git touches it  (×2)
exit 0
```

Only the standard Windows CRLF informational warnings; no whitespace
conflicts, no broken diffs.

## Self-review

### FIFO release correctness

`#releaseFactory()` shifts the head waiter and **transfers the release
closure directly** to it — `#active` does not dip between releases. This
avoids a transient window where `stats().active + stats().queued < limit`
and keeps downstream accounting clean. `released` flag prevents double-release
(double-decrement or double-handoff).

### Abort listener removal — three paths audited

1. **Active abort** (`controller.abort()`): `waiter.abort` removes itself
   from `#waiters` and rejects with `DOMException('aborted', 'AbortError')`.
   The `addEventListener(..., { once: true })` automatically detaches the
   listener after firing, so no manual removal needed.
2. **Normal release / handoff**: before `next.resolve(this.#releaseFactory())`,
   `removeEventListener` is called explicitly. The `addEventListener` was
   `{ once: true }` so it would detach on its own, but explicit removal
   short-circuits the case where the listener is still pending when handoff
   happens — and prevents the signal from retaining a stale waiter reference.
3. **`close()`**: spliced waiters have their listeners explicitly removed
   before `reject`. Listeners on already-resolved waiters are harmless but
   the explicit removal guarantees the AbortSignal cannot fire into a
   no-longer-pending waiter after close.

### `closed` / pre-aborted checks before queueing

`#acquire` short-circuits on `#closed` and `signal?.aborted` **before**
constructing the waiter or registering a listener, so we never enqueue a
waiter that will reject synchronously, and never leak a listener for an
already-aborted signal.

### Error path

Test 2 verifies the throw path: `first` rejects with `'boom'`, then `second`
and `third` proceed in FIFO order. The `try/finally` in `run()` guarantees
`release()` runs on rejection.

## Concerns

- `close()` after an `abort` event already fired: the listener is `{ once:
  true }` and auto-detached, so the explicit `removeEventListener` in
  `close()` is a safe no-op. No leak.
- `releaseFactory()` allocates a new closure per acquire. Trivial overhead
  vs. a single shared release thunk with internal state.
- `limit` validation throws on construction rather than in `#acquire`, so
  bad configuration fails fast at provider wiring time — intentional.
- The class name `CircuitBreaker` is retained for DI continuity. The file
  header comment makes the semantic distinction explicit so future readers
  don't add failure-rate logic by mistake.

## What is intentionally NOT done

- No `ClaudeCodeProvider` wiring (per brief: "Provider 只创建一个实例并
  注入所有 session" — that is downstream of this task).
- No `circuitBreaker.run` retry interaction (RetryStrategy from Task 2 is
  orthogonal; they compose at the caller).
- No metrics hooks / `onTrip` / half-open state — the class is a pure
  semaphore and the brief's `Stats` interface has no such surface.
