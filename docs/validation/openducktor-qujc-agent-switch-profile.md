# Agent Studio large transcript switch validation

Task: `openducktor-qujc`  
Date: 2026-05-07  
App: browser runner at `http://localhost:1420`

## Scenario

- Opened Agent Studio for `fairnest-8fx · Update README.md`.
- Used the persisted Builder session `ses_2ce64fae3ffe4a79GhiPT66CFK` as the large transcript case.
- Transcript payload fetched by the app from the runtime message endpoint was about 2.6 MB (`2,614,677` bytes), with 40 persisted messages and 5 screenshot attachment labels visible in the rendered transcript.
- Repeated role switches across `Spec`, `Planner`, `Builder`, and `QA`, including repeated switch-back to unchanged Builder rows.

## Profile artifacts

Captured with `agent-browser profiler` using Chrome trace categories:

- `devtools.timeline`
- `v8.execute`
- `blink`
- `blink.user_timing`
- `latencyInfo`
- `renderer.scheduler`
- `toplevel`

Compressed trace files captured during validation:

- `docs/assets/traces/openducktor-qujc-agent-switch-trace.json.gz`
- `docs/assets/traces/openducktor-qujc-agent-switch-warm-trace.json.gz`

Future browser profiler traces should be compressed and stored under `docs/assets/traces/` when the validation notes depend on trace-level evidence.

## Observations

### Initial switch sequence

Switch order: `Spec → Planner → Builder → QA → Builder → Spec → Builder → QA → Builder`.

Measured two-frame/settled times from browser-side `performance.now()`:

| Switch | Two-frame time | Settled time |
|---|---:|---:|
| Spec | 91.1 ms | 171.5 ms |
| Planner | 52.9 ms | 156.0 ms |
| Builder | 35.8 ms | 118.1 ms |
| QA | 22.0 ms | 103.9 ms |
| Builder | 37.4 ms | 120.1 ms |
| Spec | 39.7 ms | 121.5 ms |
| Builder | 41.2 ms | 122.7 ms |
| QA | 20.4 ms | 102.1 ms |
| Builder | 63.6 ms | 159.8 ms |

The browser `PerformanceObserver` saw one long task in this sequence. Trace inspection associated the long `FunctionCall` with React work on the first cold `Spec` switch, not with the repeated Builder large-transcript switch-back path.

### Warmed cache sequence

Switch order: `Spec → Builder → Planner → Builder → QA → Builder → Spec → Builder → Planner → Builder`.

Measured two-frame/settled times:

| Switch | Two-frame time | Settled time |
|---|---:|---:|
| Spec | 77.2 ms | 223.0 ms |
| Builder | 34.6 ms | 157.4 ms |
| Planner | 33.0 ms | 154.1 ms |
| Builder | 37.7 ms | 161.1 ms |
| QA | 28.2 ms | 149.9 ms |
| Builder | 43.6 ms | 164.6 ms |
| Spec | 54.9 ms | 174.9 ms |
| Builder | 46.7 ms | 166.9 ms |
| Planner | 39.5 ms | 160.9 ms |
| Builder | 41.4 ms | 161.5 ms |

The warmed trace had one `>= 50 ms` `FunctionCall` (`66.5 ms`) and marker analysis placed it between `odt-warm-Spec-start` and `odt-warm-Spec-settled`. Repeated warmed Builder switches for the large attachment-rich transcript stayed under 50 ms to two frames (`34.6–46.7 ms`).

## Derivation-specific check

Trace search did not surface `resolveAgentChatWindowRowsState`, `buildAgentChatWindowRowsState`, `createAgentChatWindowRowsStateBuilder`, or `useAgentChatTranscriptRows` as a single long switch-frame task. Large Builder switch-backs reused/published rows without an observed long derivation block.

The remaining long tasks observed in this run were associated with React render work for the Spec role, not the large Builder transcript derivation path targeted by this task.

## Result

Post-change browser validation supports the task’s main performance claim for the large persisted Builder transcript: repeated switches back to the unchanged attachment-rich transcript did not show visible freezing and did not produce a long synchronous transcript derivation task in the captured Chrome traces.
