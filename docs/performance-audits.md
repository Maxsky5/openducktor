# Audit performance issues

Use this guide when OpenDucktor uses too much CPU, allocates too much memory, or responds slowly. The audit is complete when the affected workflow is faster, preserves its behavior, and passes the required checks in both Electron and the browser runner.

Read the [architecture overview](architecture-overview.md) to find the process and package that own the work. Follow the [runtime integration guide](runtime-integration-guide.md) when the change affects runtime data. Use the [testing guide](testing.md) for test scope and [CONTRIBUTING.md](../CONTRIBUTING.md) for current commands.

## Audit steps

1. Define the slow action and record its starting state. Include the platform, runtime, session count, history size, event rate, and whether the app is idle or active. Repeat the action until the symptom is stable. Keep task-store reads read-only and use temporary data for writes.
2. Find the process that spends the CPU time. Measure Electron main and renderer processes, the browser renderer and host process, and external runtime processes separately. Capture a profile during the slow action. A single process CPU percentage does not identify the cause.
3. Trace the costly stack to its input and callers. Count how often it runs and how much data it visits. Test one cause at a time with the same input. Keep a hypothesis only if a measurement supports it.
4. Change the owning code and compare it with the unchanged source. Replay identical inputs through the real functions, then repeat the user action in both applications. Check full ordered outputs and failure behavior as well as time.
5. Run all required repository checks and resolve their failures. Report the before and after measurements, behavior checks, and actual platform coverage. A failed test or missing platform check leaves the work incomplete.

## Measure work, not only elapsed time

Record CPU time, elapsed time, input size, event count, and output count. CPU time can exceed elapsed time when several threads run at once. Include retained memory when the profile suggests a cache or subscription leak. Check memory again after cleanup.

Run at least three measured samples per version. Warm up each version with the same input, alternate their run order, and keep background work stable. Report the median and range. Measure startup separately when moving work to module initialization or compiling a parser.

Use the runtime that executes the production path. Bun test results do not predict V8 performance. Electron in Node mode can measure main-process JavaScript, but it does not exercise native IPC, the context bridge, Chromium rendering, or browser security policy. Confirm those paths in a running application.

A replay isolates a cause. A live application check confirms that the optimized code receives the real workload. Keep these claims separate. Do not add savings from separate replays to predict whole-application CPU use.

## Inspect repeated work

| Profile evidence | What to inspect | What proves the change |
| --- | --- | --- |
| Schema constructors or allocation inside an event loop | Whether an immutable schema can live at module scope; whether a caller rebuilds the same schema | Fewer allocations with the same parsed output and errors |
| Repeated recursive parsing of large payloads | Where data first crosses a trust boundary; whether a later consumer already receives a validated value | Full validation at the boundary, with no repeated traversal inside that boundary |
| Session-array scans on every event | Whether lookup cost grows with all sessions; whether an index can use the event identity | Correct lookup after add, replace, remove, reconnect, and disposal |
| Parsing events that no listener uses | Whether transport delivery can select a channel and repository before parsing the full payload | Unobserved routes cause no parsing; observed routes still reject invalid or mismatched envelopes |
| JSON formatting or tree traversal while a UI section is closed | Whether the UI computes hidden content or walks tool input more than once | Closed sections avoid the work; opening them preserves content and interaction |

Check cumulative cost and call count together. A cheap function called for every session on every event can cost more than an expensive function called once. Test event mixes with no relevant events, some relevant events, and all relevant events. Vary session count and payload size independently to expose growth with input size.

Preserve identity and ownership. An index must handle replacement and removal. A shared event listener must retain registration order, independent unsubscribe behavior, and cleanup after the last observer. Check initial snapshots, reconnects, buffered events, and errors during setup.

## Preserve validation contracts

Validate untrusted input at each process or network boundary. Within one boundary, pass the parsed value to typed consumers. Routing metadata can avoid work for unobserved events, but it does not make an observed payload valid. Validate that payload and confirm its route before delivery.

Read the installed dependency source and its official contract before changing parser behavior. Use supported APIs. Measure schema compilation on the actual hot path, including its startup cost. Confirm that each target runtime and its security policy permit the compilation method.

Compare accepted inputs, rejected inputs, and complete parsed outputs. Include defaults, transforms, unknown keys, recursive values, and error paths. For dependency upgrades, also check Unicode length limits, timestamp precision, public schema exports, and generated schemas used by external tools. These can change even when common valid inputs still pass.

Use full output equality or a hash of the complete ordered output. Matching counts alone can hide dropped fields, wrong session routing, duplicate events, or changed defaults. Add regression tests for the cause and its meaningful failure cases. Keep machine-specific timing thresholds out of unit tests.

## Verify both applications

Shared code does not prove shared coverage. Trace each changed path from the Electron entry point and from the browser entry point. Record where their transports or lifecycle rules differ.

| Path | Electron check | Browser check |
| --- | --- | --- |
| Host and runtime adapters | Exercise the desktop host and selected runtime route | Exercise the web host and selected runtime route |
| Host events | Exercise main-process forwarding, preload validation, context-bridge delivery, and observer cleanup | Exercise server event names, EventSource delivery, validation, and observer cleanup |
| Task stream | Exercise IPC envelope delivery, acknowledgement, and terminal failure | Exercise stream frames, acknowledgement, reconnect, and terminal failure |
| Shared UI | Repeat the affected interaction in the Electron renderer | Repeat it in the supported browser |

Verify malformed input, wrong repository scope, removal, and resubscription where they affect the change. Use temporary application state when a check creates records. Keep failures visible. If the test environment denies a required local socket or process operation, obtain that access and rerun the check; changing the assertion or skipping the test does not resolve the failure.

## Keep useful evidence

Keep temporary replay scripts, raw profiles, logs, process IDs, local ports, and dated measurements outside the source tree. Store the audit result with its task or review. Include the source revision, runtime versions, input shape, reproduction steps, sample results, output comparison, and remaining verification limits.

Add lasting lessons to this guide only when they change how a future audit should proceed. Keep current file names, dependency versions, commands, and architecture details in their existing sources. This avoids a second copy that becomes stale.
