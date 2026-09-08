# Codex live snapshot deltas

`CodexLiveSessionMutation.snapshotMode` states whether `snapshots` replaces the full collection or updates only the supplied refs. A `delta` requires `removedRefs`; an omitted snapshot never means removal. The host validates the complete mutation before it changes live state. It applies snapshot updates, removals, transcript events, catalog invalidation, and faults in that order.

`CodexRuntimeSessionEvents` collects changed session IDs during each ordered stream event. Activity updates, context notifications, pending-input requests and resolution, and subagent route or status changes mark the affected IDs. Event routing and delta snapshot builds use `findRetainedSessionOwner` to find the same nearest retained ancestor. The helper keeps runtime checks and cycle handling in one place. The adapter builds only the affected snapshots. A new route also includes its known descendants. Text and reasoning deltas do not mark snapshot state.

Initial attachment and control results use full snapshots. This includes model changes from controls and session release. Native events do not remove retained sessions; release remains a host control. Delta mutations support explicit removals. Tests check removal refs and delivery. This path uses no polling or persisted state.

## Replay evidence

The tests replay 100 text deltas with 50 retained sessions after initial attachment. The baseline runs the former full-collection snapshot and equality path. These are operation counts, not live model timing measurements.

| Measurement | Full collection | Delta |
|---|---:|---:|
| Adapter snapshot builds | 5,000 | 0 |
| Adapter fixture snapshot equality bytes | 3,308,000 | 0 |
| Host snapshot equality calls | 10,000 | 0 |
| Host fixture snapshot equality bytes | 2,496,000 | 0 |

The fixtures have different snapshot sizes. The byte counts cover snapshot equality only, not transcript parsing or transport. The adapter replay compares state against the full snapshot reader after context, activity, child and grandchild lineage, retained-child lineage, approval, question, and fault events. The host tests check transcript order, empty deltas, explicit removal, invalid removal refs, initial attachment, queued delivery, and release. A mixed replay changes a model through a control, applies text-only deltas, then releases the session while preserving an unrelated idle session.

Run the focused tests with:

```sh
bun test packages/adapters-codex-app-server/src/codex-live-snapshot-delta.test.ts packages/host/src/adapters/agent-sessions/codex-live-session-projection.test.ts packages/host/src/adapters/agent-sessions/codex-live-session-adapter.test.ts
```
