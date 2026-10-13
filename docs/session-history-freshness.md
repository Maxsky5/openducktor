# Session history freshness

## Scope

This contract covers repeated history reads and duplicate runtime work for task `openduckto-dbsp`. It does not change a runtime history limit or add access to older history.

## Frontend freshness

The workspace rail observes every open workspace through the existing live channel. `agent-session-history-coverage.ts` records an observation epoch and a revision for each concrete session identity. It stores no transcript or durable data.

### Current history

- A Query history response is current when its session exists in the live observation, the observation still covers the workspace, and its epoch and revision match those captured before the read.
- A retained Agent Studio history is current when it was loaded without a failure before the workspace switch and its selected-stream coverage version still matches the rail when the selected live attachment delivers its snapshot.
- The store captures coverage when a full history read starts. It advances that proof only for history-related envelopes handled by the selected stream. Both projections use the host publication sequence, so independent delivery and cloned envelopes have the same position.
- A snapshot updates live metadata but cannot advance a transcript proof across an observation epoch. Workspace departure retains the recorded selected-stream position and does not copy the rail's current position.
- Events from another root session do not make the selected root history stale.
- Child events also change the history revision of their known ancestors because root transcripts contain child links and completion state.
- A complete browser replay keeps the observation epoch. The transport uses the replay gap information from PR #1051 to decide whether to attach again.
- A new selected-workspace attachment restores covered histories to loaded. The retained store checks their versions before the view can load them, including events received during attachment.
- If the rail completes a gap repair after the selected attachment restores history, the coverage reset marks that active history stale. A new full read supplies its proof for the new epoch.

### History that is not current

| Cause | Treatment |
|---|---|
| Transcript event or history-related live update | Advance the session and ancestor revisions. |
| Session removal | Advance revisions and end coverage of that identity. |
| Scoped runtime fault | Advance revisions and mark session and ancestor histories stale. |
| Replay gap or host change | Replace the observation epoch and refresh retained histories. |
| Observation failure or teardown | End coverage and invalidate histories. |
| Unknown native session | Keep a zero stale time because the stream cannot prove freshness. |
| Read overlapped by an event | Keep the response visible, but require a new read on the next request. |
| Interrupted or failed store read | Keep the existing retry and stale-history rules. |

Query history uses an infinite stale time only while its coverage version is current. Live snapshot history fields are activity, execution episode, parent identity, and pending questions. Title, model preference, and context usage updates do not invalidate history. Live events invalidate history without an automatic history read for each text delta. The read-only dialog merges its cached baseline with current live messages and pending input. The existing store history merge keeps messages and questions that changed during a read.

The transcript consumer flushes its pending batch before the store retains the old workspace. This prevents a retained loaded history from claiming coverage for text that the old view had not yet applied.

A scoped fault makes loaded or refreshing histories stale before retention can capture a coverage version. The existing history loader treats a read outside the loading or refreshing state as superseded. An older response cannot restore loaded state after the fault.

## Claude views

| View | Required transcript data |
|---|---|
| Root transcript | Root entries and subagent transcripts for child identity, links, and completion state. |
| Child transcript | Selected child entries and subagent transcripts for nested links and completion state. |
| Root todos | Root entries only. |
| Child todos | Selected child entries. |

The pinned SDK `0.3.295` public `importSessionToStore` API has an `includeSubagents` switch and no child-file selector. Transcript views import subagents once to preserve their existing correlation behavior. Child todo reads use this same import because the SDK must load the selected child file. Root todo reads set `includeSubagents` to `false`.

Each import keeps a request-local `SessionStore`. Its `listSubkeys` method exposes imported subpaths, including physical directories under `subagents`. The SDK uses these keys to locate a child by its file name. Metadata checks and subagent completion checks read this store through the public SDK `sessionStore` option. They do not reopen transcript files. SDK source confirms that the store-backed child reader uses the same conversation-chain projector as the disk-backed reader. No request-local data survives the history load.

## Codex history work

History restores background questions through the existing question state owner. That owner reports whether the pending question payload changed. Only a changed payload requires a live-session mutation and its ordered publication. An unchanged history read returns without entering that queue. The existing handled-question set prevents old history from restoring questions already resolved by live events.

## Verification measurements

These measurements compare commit `ec260607c` with this change in the same worktree. They use local fixtures and do not measure browser HTTP overhead, a model run, or production network latency. Times are one local sample, not a performance threshold.

### Frontend fixture

The fixture uses the production Query options, store, and store history loader with 701 native history messages. It retains the existing 600-message store request and uses a complete read for the read-only query. Only the workspace return or dialog reopen is measured; the first read is excluded. Response bytes are the serialized history payload. Projected messages count the fixture adapter work admitted by the history read.

| Operation | Runtime calls before / after | Response bytes before / after | Projected messages before / after | Local time before / after |
|---|---:|---:|---:|---:|
| Workspace return | 1 / 0 | 220,801 / 0 | 600 / 0 | 9.09 ms / 0.36 ms |
| Transcript reopen | 1 / 0 | 257,749 / 0 | 701 / 0 | 1.25 ms / 0.14 ms |

### Claude SDK fixture

The initial measurement fixture used SDK `0.3.286` with 701 assistant messages, one direct child, and one nested child in flat files under `subagents`. These historical measurements predate the repository update to SDK `0.3.295`. The fixture counted transcript stream reads, `readFile` calls, and metadata file opens in an isolated process. Disk bytes count stream and `readFile` data; they exclude the bounded metadata probe bytes in the baseline. Response bytes are the serialized projected payload, not transport framing.

| View | Root reads before / after | Child reads before / after | Disk bytes before / after | Response bytes before / after | Local time before / after |
|---|---:|---:|---:|---:|---:|
| Root transcript | 2 / 1 | 3 / 2 | 476,343 / 474,304 | 340,371 / 340,371 | 127.58 ms / 111.22 ms |
| Child transcript | 2 / 1 | 4 / 2 | 477,176 / 474,304 | 903 / 903 | 14.75 ms / 12.83 ms |
| Root todos | 2 / 1 | 2 / 0 | 475,012 / 472,145 | 2 / 2 | 35.70 ms / 41.98 ms |

All three Claude fixture results match the baseline exactly. The todo time sample shows why file counts, rather than one timing sample, prove the avoided work. Run `bun test packages/host/src/adapters/claude/claude-agent-sdk-history-read.test.ts` to repeat the file-read assertions. The companion `.test-support.ts` prints the measured payload and counters when it runs with a temporary `CLAUDE_CONFIG_DIR`.

### Regression coverage

- Query reopen tests count reads after unchanged coverage, unrelated activity, relevant activity, a real gap, and observation teardown.
- Cold and warm Query reads that overlap live updates cannot become current cached baselines.
- Workspace integration tests distinguish unknown coverage, uninterrupted coverage, a gap, root and child faults before departure, an unrelated root fault, and a fault during a pending read. They count the resulting native history calls.
- Store tests cover child invalidation, interrupted reads, and events during live attachment.
- The transcript consumer test covers a workspace switch with buffered text.
- The current Claude SDK fixture verifies a complete long history, direct and nested child completion, and one file read per request. The nested child file is under `subagents/team`. Foreground and background variants must both report completion.
- Codex history tests preserve pending background questions and verify that repeated unchanged reads publish no mutation.
- Existing history suites cover forks, tools, attachments, compaction, completion, approvals, questions, and live updates during reads.

### QA rerun on 2026-10-12

This rerun addresses the verification rejection for `01fe1bb7b`. It uses writable `/tmp` directories. The compiler found a readonly-array mismatch in the new retention test table. The table now passes a mutable copy to Bun's `test.each`.

| Check | Final result |
|---|---|
| Changed-area regressions | 196 passed across nine files, including the real SDK file-read tests. |
| Frontend suite | 7,127 passed across all 720 files, with no failures or skips. |
| Host suite | 3,523 passed across all 332 files, with eight skips and no failures. |
| Other workspace suites and root scripts | Passed. Root scripts reported 35 passes and four skips. |
| `bun run test` | The final retry passed across all workspaces and root scripts. |
| Workspace typechecks | All 15 passed in sequence and in the normal pre-commit `bun run typecheck`. |
| `bun run build` | All 15 workspace builds passed. |
| Formatting, lint, React Doctor, and commitlint | Passed in the normal commit hooks. |

The initial `bun run test` encountered timeouts during resource contention. The run stopped after those failures. The complete frontend and host reruns use batches of at most 30 files with one worker and `bun --smol test`. They keep the repository timeouts of 1,000 ms for frontend and 5,000 ms for host. The other workspace suites use their existing commands. When more memory became available, `TMPDIR=/tmp bun run test` passed without worker or timeout overrides.

The initial parallel typecheck reported the test-table error and killed the Web and Electron compilers. The corrected code passed every workspace typecheck with this command:

```sh
TMPDIR=/tmp GOMEMLIMIT=512MiB GOGC=25 GOMAXPROCS=2 bun run --workspaces --sequential --no-exit-on-error typecheck
```

The full build passed with the same compiler settings and `NODE_OPTIONS=--max-old-space-size=1024`. These results are fresh regression execution. The performance measurements above remain fixture samples. This rerun does not measure live browser latency.
