# Claude Agent SDK runtime — last-commit audit

Date: 2026-07-11  
Audited commit: `1992a6b1219ce7bb279a7c567bb61b7f9f959213` (`feat(runtime): add Claude Agent SDK runtime`)  
Fixed point: `69425cd1a7015fa59c4b4f77117375c808867c13` (`HEAD^`)  
Diff: `git diff HEAD^...HEAD`  
Scope: 290 files, 32,959 insertions, 1,462 deletions

## Verdict

The audited commit was **not merge-ready**. Claude support legitimately requires changes outside `packages/host/src/adapters/claude`: a runtime kind and descriptor, config, typed host commands, event transport, runtime registration, frontend adapter registration, and session-start/model UI all cross existing boundaries. However, the original commit also contained unrelated refactors, Claude-specific behavior in generic layers, cross-runtime regressions, and Claude adapter correctness/security defects.

The remediation working tree addresses every blocker below. The 29 whole-file reversions were restored to the fixed point, except `docs/cli-tool-discovery.md`, which was first restored and then given a narrowly scoped Claude prerequisite entry. Mixed files retain only the integration needed by the runtime abstraction. The final intended diff contains 258 tracked files relative to the fixed point, plus this audit report.

Every changed file is classified exactly once in the inventory below:

| Verdict | Files | Meaning |
| --- | ---: | --- |
| KEEP | 152 | Legitimate Claude integration or required test/transport wiring. |
| PARTIAL REVERT | 83 | File contains legitimate integration plus behavior that must be reverted or redesigned. |
| REVERT | 29 | The branch change is unrelated, speculative, or belongs in the Claude adapter. Revert the whole file diff. |
| KEEP, FIX BEFORE MERGE | 26 | The file legitimately belongs to Claude support, but its current implementation is incorrect. Do not revert the file wholesale. |
| **Total** | **290** | Matches `git diff --name-only HEAD^...HEAD`. |

GitNexus rates the complete commit **CRITICAL** (`2,001` changed symbols, `98` affected execution flows). The most sensitive individual seam is `resolveAgentSessionRuntimePolicy`: 19 upstream symbols across six start/send/approval/question flows, also rated CRITICAL.

## Remediation result

| # | Finding | Resolution |
| ---: | --- | --- |
| 1 | Read-only enforcement | Fixed in the Claude adapter: Bash and write-capable tools are blocked for read-only roles, unknown tools fail closed, paths are canonicalized with symlink-escape rejection, and approval outcomes are limited to one-time approve/reject. |
| 2 | Shared lifecycle leakage | Reverted the shared capability, idle reason, polling/retries, and generic Claude idle policy. Claude now withholds normalized idle until its SDK turn reaches a terminal state. |
| 3 | Universal runtime settings dependency | Kept adapter-owned runtime policy and added an explicit `requiresSessionRuntimePolicySettings` decision; only Codex requests settings. |
| 4 | Browser first-event race | Reverted the unrelated generic readiness behavior and added the Claude event stream to the host replay paths with replay coverage. |
| 5 | Context usage read path | Removed the frontend `useEffect` fetch/store path and the dedicated host command. Context usage is derived from normalized history and live events. |
| 6 | Unsafe session approval | Removed `approve_session` from the public Claude approval contract and descriptor. The service rejects unsupported outcomes before consuming a pending request. |
| 7 | Text/time transcript identity | Reverted content/time deduplication. Generic merging is stable-ID based; Claude produces adapter-owned normalized IDs. |
| 8 | Claude identifiers/sentinels in generic UI | Removed frontend Claude ID construction and provider URI checks. Claude emits normalized child IDs, and attachment history exposes generic preview availability. |
| 9 | File-edit input fallback | Removed input-derived diffs. File edits are emitted only from authoritative SDK results or transcript-mirror patches. |
| 10 | Mandatory Semble/`uvx` | Removed tool discovery, health, default MCP, docs, and permission-classifier coupling. Claude receives only the workspace OpenDucktor MCP server. |
| 11 | Prompt and entrypoint | Replaced the Claude Code preset with an OpenDucktor-owned system prompt and removed the CLI entrypoint override. |
| 12 | Electron sidecars | Reverted all unrelated Electron sidecar/optional-binary packaging and runtime-distribution changes. Claude remains an external CLI prerequisite. |
| 13 | Non-atomic model update | Added compensation for model/effort failures and surfaces an actionable typed error if rollback is incomplete. |
| 14 | Half-enforced command contracts | Host handlers parse outputs; the host client uses a command-to-output map instead of a free generic. |
| 15 | Fake stdio runtime route | Added the live-only `host_service` route and uses it for the host-managed Claude workspace runtime. |
| 16 | Missing setup UX | Added Claude install health/version, session-start authentication guidance, `/login`, billing guidance, and official setup/policy links to Runtime settings. |
| 17 | Contradictory public docs | Updated README, contributor policy, and CLI discovery docs consistently around Claude support and the external executable requirement. |

### Verification

- `bun run test` — pass, including 3,285 frontend tests and all workspace/script suites.
- `bun run typecheck` — pass for every workspace.
- `bun run lint` — pass, including frontend boundary and host architecture guards.
- `bun run format:check` — pass across 1,972 files.
- `bun run build` — pass for every workspace.
- React Doctor `0.7.4 --scope changed --base main` — 98/100 overall, 100 for Electron, no actionable diagnostics.

### Post-remediation independent review

The required Standards and Spec re-reviews found several omissions after the first remediation pass. They were resolved before the final verification above:

- selected-session render data now calls `requiresSessionRuntimePolicySettings`, with a regression proving OpenCode loads without a settings snapshot;
- generic SSE subscriptions no longer treat the first message as the connection-ready signal;
- Claude runtime adapter tests inject an isolated TanStack Query client instead of mutating the application singleton;
- executable, MCP command, and bridge dependencies are resolved in the Effect-native service before crossing into Claude SDK Promise APIs;
- Claude Code `/resume` exposure failures are surfaced as session errors rather than only logged;
- README and the runtime route/read-only policy documentation now match the implementation.

The Spec review suggested allowing Claude `Bash` in read-only roles. That recommendation was rejected because it would reintroduce blocker 1: the SDK exposes Bash as one arbitrary-command boundary, and a command parser cannot safely classify all programs and flags. The adapter therefore remains fail-closed and the runtime guide records this Claude-specific limitation.

The sections below preserve the original commit audit and exhaustive per-file classification. Their imperative wording records what the audited commit required; the table above records the resulting disposition.

## Governing requirements

- `docs/adr/0007-implement-claude-as-claude-agent-sdk-runtime.md` is the accepted decision.
- `docs/runtime-integration-guide.md` defines descriptor-first integration and requires runtime-specific translation at adapter boundaries.
- `AGENTS.md` prohibits fallback behavior, polling in place of live events, untyped expected host errors, Promise-driven host internals, and ad hoc frontend reads where TanStack Query owns server data.
- Pinned SDK contract: `@anthropic-ai/claude-agent-sdk@0.3.191` from `bun.lock` and its shipped `sdk.d.ts`/`sdk.mjs`.

## Merge blockers and required action

### 1. Read-only roles are not safely read-only

`claude-agent-sdk-options.ts:234` uses `permissionMode: "auto"`, loads repository `project`/`local` settings, exposes Bash, and gives the sandbox write access to the worktree. The fallback command classifier is not sound:

```text
sed -n 1w pwned package.json  -> read_only
sort -opwned package.json     -> read_only
```

`claude-agent-sdk-permissions.ts:138` also uses lexical containment, so a worktree symlink can escape read confinement. Yet the descriptor claims `readOnlyAutoRejectSafe: true`.

Action: keep the Claude permission files, but replace the current enforcement with an unavoidable SDK boundary and canonical path checks. Until then, set the safety claim false. Do not solve this in generic frontend/core code.

### 2. Claude lifecycle semantics leaked into every runtime

The commit adds `keepsPendingTurnRunningUntilFinalAssistantMessage` to every descriptor and `session_idle.reason` to the shared event contract, then teaches generic frontend state to special-case Claude's early idle ordering. `use-agent-session-observers.ts` adds one-second snapshot polling with three retries.

This violates the live-stream and adapter-normalization rules. The Claude adapter already tracks active and pending SDK turns; it should withhold normalized `session_idle` until the turn is actually complete.

Action: revert the shared capability, idle-reason policy, polling/retry loop, and the dedicated generic Claude-idle test. Keep a single race-safe initial snapshot/read if required, but do not poll. Normalize SDK lifecycle ordering in `claude-agent-sdk-lifecycle.ts`.

### 3. Runtime policy resolution regresses OpenCode and Claude

Adapter-owned policy resolution is a good change. Eagerly loading settings for every runtime is not. `use-session-runtime-data.ts:127-130` and `session-runtime-policy.ts` now make OpenCode and Claude reads depend on a settings snapshot even though only Codex needs it.

Action: keep `AgentSessionRuntimePolicyPort`, but make the adapter decide whether it needs settings (for example through an async/lazy resolver). Revert the universal settings dependency. Regression-test OpenCode, Codex, and Claude with settings unavailable.

### 4. Browser mode can still lose the first Claude events

`subscribeLocalHostClaudeRuntimeEvents` returns without awaiting EventSource readiness. The host event bus does not replay Claude events: `INITIAL_REPLAY_STREAM_PATHS` contains only `codex-app-server-events`. The added generic “message means ready” behavior does not fix the subscription race and changes unrelated dev-server semantics.

Action: revert the generic readiness hunk and its dev-server test. Add a Claude-specific ready handshake or include the Claude stream in initial replay, with an end-to-end first-event test.

### 5. Explicit context usage loading bypasses TanStack Query and capability ownership

The Claude host operation is legitimate. The frontend invokes it through `useEffect`, copies server data into session state, and exposes a throwing aggregate method for OpenCode/Codex. There is no descriptor capability for this optional read; the `runtimeDefinitions` parameter added to `useSelectedSessionHistoryLoad` is unused.

Action: revert the current frontend orchestration. Reintroduce the read as a runtime-capability-gated TanStack Query query, or derive context usage from normalized history/live events. Keep the Claude host transport only if the query path uses it.

### 6. `approve_session` does not mean “approve for this session”

`claude-agent-sdk-service.ts:246-252` degrades to one-time approval when suggestions are absent and forwards SDK suggestions unchanged when present. SDK destinations include `userSettings`, `projectSettings`, `localSettings`, `session`, and `cliArg`; forwarding them can persist beyond the session.

Action: remove `approve_session` from the Claude descriptor/event until the adapter can force and verify session-only updates, or rewrite validated suggestions to the session destination.

### 7. Generic transcript code guesses identity from text and time

The new final-assistant policy collapses messages with equal text inside a two-second window and performs additional within-turn collapse. Legitimate repeated answers can be lost in OpenCode or Codex. The SDK adapter must preserve stable normalized IDs and update metadata for duplicate result frames; generic UI must not infer identity from content/timestamps.

Action: revert `final-assistant-message-policy.ts`, the content/time dedupe paths, and their tests. Retain only ID-based generic merging. Fix duplicate-result identity in the Claude event/history adapter.

### 8. Claude identifiers and attachment sentinels leaked into generic UI

`subagent-session-key.ts` constructs `::claude-subagent::` identifiers in the frontend even though the Claude adapter already has `claudeSubagentExternalSessionId`. `use-agent-chat-attachment-preview.ts` knows the provider URI `claude-history://attachment/`.

Action: revert these frontend changes. Claude history/events must supply the normalized child `externalSessionId`; attachment preview availability needs a generic contract field or adapter-owned omission, not a provider URI check in shared UI.

### 9. File-edit fallback reports requested edits as applied edits

`readClaudeFileEditPayload` defaults `allowInputFallback` to true and synthesizes diffs from Edit/MultiEdit input when structured SDK result data is absent. This can display a requested edit that failed or applied differently.

Action: remove the fallback. Emit file diffs only from authoritative result/mirror data; otherwise omit them and expose an actionable absence/error.

### 10. Mandatory Semble/`uvx` is scope creep

Every Claude session eagerly resolves `uvx`, starts a pinned Semble MCP server, and uses `strictMcpConfig`. Neither ADR requires Semble; missing `uvx` prevents Claude startup.

Action: remove Semble from default Claude MCP configuration and revert all `uvx` discovery, health, and docs changes. Keep the OpenDucktor MCP bridge. If Semble is desired later, ship it as an explicit optional product capability.

### 11. System-prompt and SDK entrypoint choices contradict the intended SDK integration

The adapter defaults to the `claude_code` preset plus append and sets `CLAUDE_CODE_ENTRYPOINT="cli"`. The retained ADR rationale says managed sessions should use an OpenDucktor-authored prompt; the pinned SDK defaults SDK integrations to `sdk-ts`.

Action: use an OpenDucktor-owned system prompt and omit the entrypoint override (or set `sdk-ts`).

### 12. Electron sidecar/optional-binary work is unrelated to the chosen executable strategy

The runtime requires an external `claude` executable and always supplies `pathToClaudeCodeExecutable`. Therefore installing target SDK optional binaries during Electron packaging is unused. The MCP sidecar manifest refactor does not package Claude at all, and `sidecarExecutables` is unused.

Action: revert the Electron sidecar, optional-target install, runtime-distribution `sidecarExecutables`, and associated tests. If the product chooses the SDK-bundled binary instead, make that a separate explicit distribution design and remove the external-CLI requirement.

### 13. Live model + effort updates are non-atomic

`applyClaudeSessionModel` calls `setModel` and then `applyFlagSettings`. Failure of the second leaves the runtime on a new model while host/UI state retains the previous selection.

Action: keep the in-scope file but restrict updates to atomic supported combinations or implement explicit compensation with surfaced rollback failures.

### 14. Claude command contracts are only half-enforced

The host handler parses inputs but not outputs. The client parser returns `as T`, so callers can request an unrelated compile-time type that is not coupled to the selected command.

Action: parse command outputs at the host boundary and replace the free generic with a command-to-output type map.

### 15. The workspace runtime advertises a route it does not own

`claude-workspace-runtime-starter.ts:55-56` advertises a `stdio` route identified by runtime ID, but no workspace stdio process or pipe exists; SDK processes are created per session later.

Action: represent this honestly (for example, a host-service/in-process route) or change runtime ownership. Do not retain a fake live route merely to satisfy the current schema.

### 16. ADR-required product setup is missing

ADR 0007 requires settings/auth/billing setup and a link to Anthropic's current plan policy. The branch adds only `claude.enabled`; there is no setup guidance, auth status, billing explanation, or API-key versus subscription guidance.

Action: add the required setup surface before claiming complete first-class support.

### 17. Public contributor/runtime documentation contradicts the new support policy

`CONTRIBUTING.md` still says OpenDucktor supports only open-source runtimes and lists only OpenCode/Codex as supported tooling, while the changed runtime guide claims Claude is supported. The commit does not resolve that policy contradiction or document the external `claude` prerequisite.

Action: obtain/record the product-policy decision and update `CONTRIBUTING.md`, README/setup docs, and CLI discovery docs consistently. Do not silently leave mutually exclusive support statements.

## Changes to revert completely

These 29 file diffs have no required Claude integration content. Revert them to `HEAD^` (delete files that were newly added):

- `apps/electron/scripts/electron-sidecar-manifest.ts`
- `apps/electron/scripts/package-build.test.ts`
- `apps/electron/scripts/package-build.ts`
- `apps/electron/scripts/prepare-electron-sidecars.test.ts`
- `apps/electron/scripts/prepare-electron-sidecars.ts`
- `apps/electron/scripts/verify-electron-sidecar-package.test.ts`
- `apps/electron/src/main/electron-runtime-distribution.test.ts`
- `apps/electron/src/main/electron-runtime-distribution.ts`
- `apps/electron/src/shared/electron-sidecar-manifest.ts`
- `docs/cli-tool-discovery.md`

The current `docs/cli-tool-discovery.md` diff is Semble/formatting churn; add correct Claude CLI documentation separately after reverting it.
- `packages/frontend/src/components/features/agents/agent-chat/agent-chat-message-card-content.tsx`
- `packages/frontend/src/components/features/agents/agent-chat/agent-chat-message-card-tool-presenters.tsx`
- `packages/frontend/src/components/features/agents/agent-chat/file-edit-tool.ts`
- `packages/frontend/src/components/features/agents/agent-chat/subagent-session-key.ts`
- `packages/frontend/src/components/features/agents/agent-chat/subagent-transcript-button.test.tsx`
- `packages/frontend/src/components/features/agents/agent-chat/subagent-transcript-button.tsx`
- `packages/frontend/src/components/features/agents/agent-chat/tool-duration.ts`
- `packages/frontend/src/components/features/agents/agent-chat/tool-summary-builder.ts`
- `packages/frontend/src/components/features/agents/agent-chat/tool-summary.ts`
- `packages/frontend/src/components/features/agents/agent-chat/use-agent-session-transcript-dialog.test.tsx`
- `packages/frontend/src/state/operations/agent-orchestrator/events/session-claude-idle-events.test.ts`
- `packages/frontend/src/state/operations/agent-orchestrator/support/final-assistant-message-policy.ts`
- `packages/frontend/src/state/operations/agent-orchestrator/support/history-message-merge-final-assistant.test.ts`
- `packages/frontend/src/state/operations/agent-orchestrator/support/pending-turn-idle-policy.ts`
- `packages/host/src/adapters/runtimes/runtime-distribution.test.ts`
- `packages/host/src/adapters/runtimes/runtime-distribution.ts`
- `packages/openducktor-web/scripts/dev.test.ts`
- `packages/openducktor-web/scripts/dev.ts`
- `packages/openducktor-web/src/web-runtime-distribution.test.ts`

## Partial-revert map

These are the main hunk-level rollback groups inside the 82 mixed files:

| Group | Revert | Keep |
| --- | --- | --- |
| Lifecycle | `keepsPendingTurnRunningUntilFinalAssistantMessage`, idle reasons, snapshot polling/retries, text/time final-message collapse | Normalized new event types, ID-based reconciliation, one race-safe bootstrap snapshot |
| Runtime policy | Eager settings load for all runtimes | Adapter-owned policy resolution and Claude policy binding |
| Context usage | `useEffect` fetch/store path and ungated aggregate throwing method | Claude host command/adapter read if consumed by a capability-gated query |
| Generic UI | Claude session-ID synthesis, `claude-history://` check, reasoning padding, Bash/file-edit presentation hardening | Claude icon/accent, MIME-aware attachment validation, runtime selection |
| Tool discovery | `uvx` descriptor/health/docs | External `claude` descriptor if the external executable strategy remains |
| Task sync | Raw `setTimeout`/`Effect.runPromise` scheduler rewrite and retry swallowing | Shared task-event channel constant |
| Web SSE | “message means ready” generic behavior | Shared stream-path constants and Claude subscription wiring |
| Electron host test | Unrelated task/git/attachment fixture and assertion churn | Claude config/runtime definition/health assertions |
| Runtime descriptor | Claude-specific lifecycle flag, unsafe approval/safety/subagent-reference claims | `claude` kind, descriptor, workflow aliases, verified capabilities |
| Transcript merge | content/time identity heuristics and provider ordering workarounds | Stable-ID message handling, normalized retraction and metadata events |

## Standards axis

Hard violations:

1. `use-agent-session-observers.ts` adds polling/retries beside a live subscription.
2. `task-sync-service.ts` replaces Effect scheduling with `setTimeout`, `Effect.runPromise`, and swallowed/retried failures.
3. `claude-agent-sdk-service.ts` converts internal runtime-registry Effects to Promises inside the host adapter instead of at a transport boundary.
4. `claude-agent-sdk-file-edits.ts` synthesizes fallback diffs from tool input.
5. selected-session context usage uses `useEffect` and copied state rather than TanStack Query and has no descriptor capability.
6. `claude-agent-sdk-cli-resume.ts` and `claude-agent-sdk-queue.ts` use generic `Error` for expected validation/state failures.

Judgment calls:

- Primitive obsession/Claude leakage in generic subagent session keys.
- Speculative generality in the shared pending-turn capability.
- Divergent, unrelated task-sync scheduler change.

## Spec axis

- Missing: ADR-required settings/auth/billing setup and plan-policy link.
- Wrong: defaulting to the Claude Code system-prompt preset plus append rather than an OpenDucktor-authored managed-runtime prompt.
- Revert/move: shared polling/lifecycle takeover; Claude must normalize event order.
- Revert/move: Claude subagent ID construction in generic UI.
- Cross-runtime regression: universal settings dependency for runtime policy.
- Scope creep: mandatory Semble/`uvx`.
- Scope creep: task-sync, web-dev process supervision, and unused sidecar changes.

Axis summary: 6 hard + 3 judgment-call Standards findings; 7 Spec findings. Worst Standards issue: read-only enforcement/fallback behavior. Worst Spec issue: runtime-specific lifecycle behavior replacing the existing adapter boundary.

## Exhaustive file inventory

### KEEP, FIX BEFORE MERGE (26)

These files legitimately belong to Claude support, but contain one or more defects described above.

- `packages/host-client/src/claude-runtime-response-parsers.ts`
- `packages/host/src/adapters/claude/claude-agent-sdk-cli-resume.test.ts`
- `packages/host/src/adapters/claude/claude-agent-sdk-cli-resume.ts`
- `packages/host/src/adapters/claude/claude-agent-sdk-dependencies.ts`
- `packages/host/src/adapters/claude/claude-agent-sdk-events.results.test.ts`
- `packages/host/src/adapters/claude/claude-agent-sdk-events.session-state.test.ts`
- `packages/host/src/adapters/claude/claude-agent-sdk-file-edits.ts`
- `packages/host/src/adapters/claude/claude-agent-sdk-history-support.ts`
- `packages/host/src/adapters/claude/claude-agent-sdk-history.test.ts`
- `packages/host/src/adapters/claude/claude-agent-sdk-history.ts`
- `packages/host/src/adapters/claude/claude-agent-sdk-lifecycle.ts`
- `packages/host/src/adapters/claude/claude-agent-sdk-messages.ts`
- `packages/host/src/adapters/claude/claude-agent-sdk-options.test.ts`
- `packages/host/src/adapters/claude/claude-agent-sdk-options.ts`
- `packages/host/src/adapters/claude/claude-agent-sdk-permissions.test.ts`
- `packages/host/src/adapters/claude/claude-agent-sdk-permissions.ts`
- `packages/host/src/adapters/claude/claude-agent-sdk-queue.ts`
- `packages/host/src/adapters/claude/claude-agent-sdk-service.test.ts`
- `packages/host/src/adapters/claude/claude-agent-sdk-service.ts`
- `packages/host/src/adapters/claude/claude-agent-sdk-session-io.test.ts`
- `packages/host/src/adapters/claude/claude-agent-sdk-session-io.ts`
- `packages/host/src/adapters/claude/claude-agent-sdk-shell-mutation.ts`
- `packages/host/src/adapters/claude/claude-workspace-runtime-starter.test.ts`
- `packages/host/src/adapters/claude/claude-workspace-runtime-starter.ts`
- `packages/host/src/interface/commands/claude-runtime-command-handlers.test.ts`
- `packages/host/src/interface/commands/claude-runtime-command-handlers.ts`

### PARTIAL REVERT (83)

These files contain both legitimate integration and one of the hunk groups in the partial-revert map.

- `apps/electron/src/main/electron-host.test.ts`
- `docs/contracts/opencode-runtime-descriptor.fixture.json`
- `packages/contracts/src/agent-runtime-schemas.ts`
- `packages/contracts/src/runtime-descriptors.ts`
- `packages/contracts/src/runtime-schemas.test.ts`
- `packages/core/src/ports/agent-engine.ts`
- `packages/core/src/types/agent-orchestrator.ts`
- `packages/frontend/src/components/features/agents/agent-chat/agent-chat-message-card-model.test.ts`
- `packages/frontend/src/components/features/agents/agent-chat/agent-chat-message-card-model.ts`
- `packages/frontend/src/components/features/agents/agent-chat/agent-chat-message-card.test.ts`
- `packages/frontend/src/components/features/agents/agent-chat/agent-chat-thread-row.test.tsx`
- `packages/frontend/src/components/features/agents/agent-chat/agent-chat-thread-session.test.ts`
- `packages/frontend/src/components/features/agents/agent-chat/agent-chat-thread-session.ts`
- `packages/frontend/src/components/features/agents/agent-chat/agent-chat-thread.test.ts`
- `packages/frontend/src/components/features/agents/agent-chat/agent-chat-thread.tsx`
- `packages/frontend/src/components/features/agents/agent-chat/agent-session-approval-card.test.ts`
- `packages/frontend/src/components/features/agents/agent-chat/agent-session-approval-card.tsx`
- `packages/frontend/src/components/features/agents/agent-chat/readonly-transcript/readonly-transcript-session.test.ts`
- `packages/frontend/src/components/features/agents/agent-chat/readonly-transcript/readonly-transcript-session.ts`
- `packages/frontend/src/components/features/agents/agent-chat/readonly-transcript/use-runtime-transcript-session-history.test.tsx`
- `packages/frontend/src/components/features/agents/agent-chat/readonly-transcript/use-runtime-transcript-session-history.ts`
- `packages/frontend/src/components/features/agents/agent-chat/readonly-transcript/use-session-transcript-surface-model.test.tsx`
- `packages/frontend/src/components/features/agents/agent-chat/readonly-transcript/use-session-transcript-surface-model.ts`
- `packages/frontend/src/components/features/agents/agent-chat/use-agent-chat-attachment-preview.ts`
- `packages/frontend/src/lib/agent-runtime.test.ts`
- `packages/frontend/src/lib/agent-runtime.ts`
- `packages/frontend/src/pages/agents/selected-session/use-agent-studio-selected-session-view.ts`
- `packages/frontend/src/pages/agents/use-agent-studio-selection-controller.test.tsx`
- `packages/frontend/src/pages/agents/use-agent-studio-selection-controller.ts`
- `packages/frontend/src/state/agent-runtime-services.test.ts`
- `packages/frontend/src/state/agent-runtime-services.ts`
- `packages/frontend/src/state/operations/agent-orchestrator/events/session-context-idle.test.ts`
- `packages/frontend/src/state/operations/agent-orchestrator/events/session-event-types.ts`
- `packages/frontend/src/state/operations/agent-orchestrator/events/session-events-test-harness.ts`
- `packages/frontend/src/state/operations/agent-orchestrator/events/session-helpers.ts`
- `packages/frontend/src/state/operations/agent-orchestrator/events/session-lifecycle.ts`
- `packages/frontend/src/state/operations/agent-orchestrator/events/session-transcript-events.test.ts`
- `packages/frontend/src/state/operations/agent-orchestrator/handlers/pending-input-actions.ts`
- `packages/frontend/src/state/operations/agent-orchestrator/handlers/send-agent-message.ts`
- `packages/frontend/src/state/operations/agent-orchestrator/handlers/session-actions-send.test.ts`
- `packages/frontend/src/state/operations/agent-orchestrator/handlers/start-session-fork-strategy.ts`
- `packages/frontend/src/state/operations/agent-orchestrator/handlers/start-session-fresh-strategy.ts`
- `packages/frontend/src/state/operations/agent-orchestrator/handlers/start-session.test.ts`
- `packages/frontend/src/state/operations/agent-orchestrator/history/session-history-load-policy.ts`
- `packages/frontend/src/state/operations/agent-orchestrator/history/session-history-loader.test.ts`
- `packages/frontend/src/state/operations/agent-orchestrator/history/session-history-loader.ts`
- `packages/frontend/src/state/operations/agent-orchestrator/history/use-selected-session-history-load.test.tsx`
- `packages/frontend/src/state/operations/agent-orchestrator/history/use-selected-session-history-load.ts`
- `packages/frontend/src/state/operations/agent-orchestrator/hooks/use-agent-session-observers.test.tsx`
- `packages/frontend/src/state/operations/agent-orchestrator/hooks/use-agent-session-observers.ts`
- `packages/frontend/src/state/operations/agent-orchestrator/hooks/use-repo-session-read-model.test.tsx`
- `packages/frontend/src/state/operations/agent-orchestrator/hooks/use-repo-session-read-model.ts`
- `packages/frontend/src/state/operations/agent-orchestrator/hooks/use-session-runtime-data.test.tsx`
- `packages/frontend/src/state/operations/agent-orchestrator/hooks/use-session-runtime-data.ts`
- `packages/frontend/src/state/operations/agent-orchestrator/session-read-model/repo-session-read-model-loader.test.ts`
- `packages/frontend/src/state/operations/agent-orchestrator/session-read-model/repo-session-read-model-loader.ts`
- `packages/frontend/src/state/operations/agent-orchestrator/session-read-model/repo-session-read-model.test.ts`
- `packages/frontend/src/state/operations/agent-orchestrator/session-read-model/repo-session-read-model.ts`
- `packages/frontend/src/state/operations/agent-orchestrator/session-read-model/session-runtime-snapshot.test.ts`
- `packages/frontend/src/state/operations/agent-orchestrator/session-read-model/session-runtime-snapshot.ts`
- `packages/frontend/src/state/operations/agent-orchestrator/session-read-model/source-session-loader.test.ts`
- `packages/frontend/src/state/operations/agent-orchestrator/session-read-model/source-session-loader.ts`
- `packages/frontend/src/state/operations/agent-orchestrator/support/history-message-merge.test.ts`
- `packages/frontend/src/state/operations/agent-orchestrator/support/history-message-merge.ts`
- `packages/frontend/src/state/operations/agent-orchestrator/support/messages.ts`
- `packages/frontend/src/state/operations/agent-orchestrator/support/session-history-chat-messages.test.ts`
- `packages/frontend/src/state/operations/agent-orchestrator/support/session-history-chat-messages.ts`
- `packages/frontend/src/state/operations/agent-orchestrator/support/session-runtime-policy.ts`
- `packages/frontend/src/state/operations/agent-orchestrator/use-agent-orchestrator-operations.ts`
- `packages/frontend/src/state/providers/app-runtime-provider.tsx`
- `packages/frontend/src/types/state-slices.ts`
- `packages/frontend/src/types/agent-orchestrator.ts`
- `packages/host/src/adapters/runtimes/runtime-health-probe.test.ts`
- `packages/host/src/adapters/runtimes/runtime-health-probe.ts`
- `packages/host/src/adapters/system/tool-discovery-descriptors.ts`
- `packages/host/src/adapters/system/tool-discovery.test.ts`
- `packages/host/src/application/tasks/sync/task-sync-service.test.ts`
- `packages/host/src/application/tasks/sync/task-sync-service.ts`
- `packages/host/src/composition/node/node-host-default-ports.ts`
- `packages/host/src/ports/tool-discovery-port.ts`
- `packages/openducktor-web/src/local-host-transport.test.ts`
- `packages/openducktor-web/src/local-host-transport.ts`
- `packages/openducktor-web/src/typescript-host-backend.test.ts`

### REVERT (29)

Listed in full under “Changes to revert completely.”

### KEEP (152)

These changes are legitimate cross-layer integration or Claude-owned implementation with no specific revert finding from this audit.

- `apps/electron/src/renderer/electron-shell-bridge.ts`
- `bun.lock`
- `docs/runtime-integration-guide.md`
- `packages/adapters-codex-app-server/src/codex-app-server-adapter.ts`
- `packages/adapters-codex-app-server/src/codex-session-policy.ts`
- `packages/adapters-opencode-sdk/src/opencode-sdk-adapter.test.ts`
- `packages/adapters-opencode-sdk/src/opencode-sdk-adapter.ts`
- `packages/contracts/src/claude-runtime-command-contracts.test.ts`
- `packages/contracts/src/claude-runtime-command-contracts.ts`
- `packages/contracts/src/config-schemas.test.ts`
- `packages/contracts/src/config-schemas.ts`
- `packages/contracts/src/exports.contract.test.ts`
- `packages/contracts/src/host-event-channel-schemas.ts`
- `packages/contracts/src/index.ts`
- `packages/frontend/src/components/features/agents/agent-accent-color.test.ts`
- `packages/frontend/src/components/features/agents/agent-accent-color.ts`
- `packages/frontend/src/components/features/agents/agent-chat/agent-chat-attachments.test.ts`
- `packages/frontend/src/components/features/agents/agent-chat/agent-chat-attachments.ts`
- `packages/frontend/src/components/features/agents/agent-chat/agent-chat-composer-model-state.test.ts`
- `packages/frontend/src/components/features/agents/agent-runtime-icon.test.tsx`
- `packages/frontend/src/components/features/agents/agent-runtime-icon.tsx`
- `packages/frontend/src/components/features/agents/session-start-modal.test.tsx`
- `packages/frontend/src/components/features/agents/session-start-modal.tsx`
- `packages/frontend/src/components/features/settings/use-settings-modal-runtime-validation.test.ts`
- `packages/frontend/src/features/agent-chat-composer/model-selection/model-selection-options.test.ts`
- `packages/frontend/src/features/agent-chat-composer/model-selection/model-selection-options.ts`
- `packages/frontend/src/features/agent-chat-composer/model-selection/model-selection-preferences.test.ts`
- `packages/frontend/src/features/agent-chat-composer/model-selection/model-selection-preferences.ts`
- `packages/frontend/src/features/agent-chat-composer/model-selection/model-update-error.ts`
- `packages/frontend/src/features/agent-chat-composer/model-selection/use-model-selection-actions.test.tsx`
- `packages/frontend/src/features/agent-chat-composer/model-selection/use-model-selection-actions.ts`
- `packages/frontend/src/features/agent-chat-composer/prompt-input/runtime-prompt-input-support.test.ts`
- `packages/frontend/src/features/agent-chat-composer/prompt-input/use-chat-composer-slash-commands.ts`
- `packages/frontend/src/features/session-start/session-start-modal-reuse-state.ts`
- `packages/frontend/src/features/session-start/session-start-modal-runtime-state.ts`
- `packages/frontend/src/features/session-start/session-start-modal-selection.test.ts`
- `packages/frontend/src/features/session-start/session-start-modal-selection.ts`
- `packages/frontend/src/features/session-start/session-start-modal-types.ts`
- `packages/frontend/src/features/session-start/session-start-orchestration.ts`
- `packages/frontend/src/features/session-start/session-start-selection.ts`
- `packages/frontend/src/features/session-start/use-session-start-modal-runner.ts`
- `packages/frontend/src/features/session-start/use-session-start-modal-state.test.tsx`
- `packages/frontend/src/features/session-start/use-session-start-modal-state.ts`
- `packages/frontend/src/lib/host-client.ts`
- `packages/frontend/src/lib/question-tools.test.ts`
- `packages/frontend/src/lib/question-tools.ts`
- `packages/frontend/src/lib/shell-bridge.ts`
- `packages/frontend/src/pages/agents/agent-studio-test-utils.tsx`
- `packages/frontend/src/pages/agents/chat-composer/use-agent-studio-chat-composer.test.tsx`
- `packages/frontend/src/pages/agents/chat-composer/use-agent-studio-chat-composer.ts`
- `packages/frontend/src/pages/agents/selected-session/selected-session-view-projection.test.ts`
- `packages/frontend/src/pages/agents/selected-session/selected-session-view-projection.ts`
- `packages/frontend/src/pages/agents/session-actions/agent-studio-session-action-state.test.ts`
- `packages/frontend/src/pages/agents/session-actions/agent-studio-session-action-state.ts`
- `packages/frontend/src/pages/agents/session-start/use-agent-studio-session-start-flow.ts`
- `packages/frontend/src/pages/agents/shell/use-agents-page-shell-model.test.tsx`
- `packages/frontend/src/pages/agents/use-agent-studio-chat-model.ts`
- `packages/frontend/src/pages/agents/use-agent-studio-chat-settings.test.tsx`
- `packages/frontend/src/pages/agents/use-agent-studio-session-actions.test.tsx`
- `packages/frontend/src/pages/agents/use-agent-studio-session-start-flow.test.tsx`
- `packages/frontend/src/pages/agents/use-repo-navigation-persistence.test.tsx`
- `packages/frontend/src/pages/kanban/kanban-page.test.tsx`
- `packages/frontend/src/state/app-state-contexts.ts`
- `packages/frontend/src/state/operations/agent-orchestrator/events/session-assistant-subagents.test.ts`
- `packages/frontend/src/state/operations/agent-orchestrator/events/session-event-batching.test.ts`
- `packages/frontend/src/state/operations/agent-orchestrator/events/session-event-batching.ts`
- `packages/frontend/src/state/operations/agent-orchestrator/events/session-event-router.ts`
- `packages/frontend/src/state/operations/agent-orchestrator/events/session-event-routing.test.ts`
- `packages/frontend/src/state/operations/agent-orchestrator/events/session-events.ts`
- `packages/frontend/src/state/operations/agent-orchestrator/events/session-parts.runtime-isolation.test.ts`
- `packages/frontend/src/state/operations/agent-orchestrator/events/session-parts.ts`
- `packages/frontend/src/state/operations/agent-orchestrator/events/session-pending-input.ts`
- `packages/frontend/src/state/operations/agent-orchestrator/events/session-tool-parts.ts`
- `packages/frontend/src/state/operations/agent-orchestrator/handlers/prepare-session-send.test.ts`
- `packages/frontend/src/state/operations/agent-orchestrator/handlers/prepare-session-send.ts`
- `packages/frontend/src/state/operations/agent-orchestrator/handlers/public-operations.test.ts`
- `packages/frontend/src/state/operations/agent-orchestrator/handlers/public-operations.ts`
- `packages/frontend/src/state/operations/agent-orchestrator/handlers/session-actions-model.test.ts`
- `packages/frontend/src/state/operations/agent-orchestrator/handlers/session-actions.ts`
- `packages/frontend/src/state/operations/agent-orchestrator/handlers/session-model-actions.ts`
- `packages/frontend/src/state/operations/agent-orchestrator/handlers/start-session-local-state.ts`
- `packages/frontend/src/state/operations/agent-orchestrator/support/history-tool-message-merge.ts`
- `packages/frontend/src/state/operations/agent-orchestrator/support/persistence.ts`
- `packages/frontend/src/state/operations/agent-orchestrator/support/session-turn-metadata.ts`
- `packages/frontend/src/state/operations/agent-orchestrator/use-agent-orchestrator-operations.session-state.test.tsx`
- `packages/frontend/src/state/operations/agent-orchestrator/use-agent-orchestrator-operations.test-harness.tsx`
- `packages/frontend/src/state/operations/shared/runtime-catalog.test.ts`
- `packages/frontend/src/state/operations/shared/runtime-catalog.ts`
- `packages/frontend/src/state/queries/runtime-catalog.test.ts`
- `packages/frontend/src/state/queries/runtime-catalog.ts`
- `packages/frontend/src/state/runtime-adapters/agent-runtime-adapter.ts`
- `packages/frontend/src/state/runtime-adapters/claude-runtime-adapter.test.ts`
- `packages/frontend/src/state/runtime-adapters/claude-runtime-adapter.ts`
- `packages/frontend/src/styles.css`
- `packages/host-client/src/build-runtime-client.ts`
- `packages/host-client/src/index.ts`
- `packages/host/package.json`
- `packages/host/src/adapters/claude/claude-agent-sdk-catalog.test.ts`
- `packages/host/src/adapters/claude/claude-agent-sdk-catalog.ts`
- `packages/host/src/adapters/claude/claude-agent-sdk-context-usage.test.ts`
- `packages/host/src/adapters/claude/claude-agent-sdk-context-usage.ts`
- `packages/host/src/adapters/claude/claude-agent-sdk-event-session.ts`
- `packages/host/src/adapters/claude/claude-agent-sdk-events.subagents.test.ts`
- `packages/host/src/adapters/claude/claude-agent-sdk-events.test-support.ts`
- `packages/host/src/adapters/claude/claude-agent-sdk-events.test.ts`
- `packages/host/src/adapters/claude/claude-agent-sdk-events.tools.test.ts`
- `packages/host/src/adapters/claude/claude-agent-sdk-events.ts`
- `packages/host/src/adapters/claude/claude-agent-sdk-history-entry.ts`
- `packages/host/src/adapters/claude/claude-agent-sdk-history-import.ts`
- `packages/host/src/adapters/claude/claude-agent-sdk-live-tool-result-enrichment.ts`
- `packages/host/src/adapters/claude/claude-agent-sdk-questions.test.ts`
- `packages/host/src/adapters/claude/claude-agent-sdk-questions.ts`
- `packages/host/src/adapters/claude/claude-agent-sdk-result-events.ts`
- `packages/host/src/adapters/claude/claude-agent-sdk-result-lifecycle.ts`
- `packages/host/src/adapters/claude/claude-agent-sdk-session-cli-resume.test.ts`
- `packages/host/src/adapters/claude/claude-agent-sdk-session-consume-lifecycle.test.ts`
- `packages/host/src/adapters/claude/claude-agent-sdk-session-factory.ts`
- `packages/host/src/adapters/claude/claude-agent-sdk-session-io.test-support.ts`
- `packages/host/src/adapters/claude/claude-agent-sdk-session-shape.test.ts`
- `packages/host/src/adapters/claude/claude-agent-sdk-session-shape.ts`
- `packages/host/src/adapters/claude/claude-agent-sdk-session-store.test.ts`
- `packages/host/src/adapters/claude/claude-agent-sdk-session-store.ts`
- `packages/host/src/adapters/claude/claude-agent-sdk-subagent-transcripts.ts`
- `packages/host/src/adapters/claude/claude-agent-sdk-subagents.ts`
- `packages/host/src/adapters/claude/claude-agent-sdk-tool-input-stream.ts`
- `packages/host/src/adapters/claude/claude-agent-sdk-tool-results.ts`
- `packages/host/src/adapters/claude/claude-agent-sdk-tool-shapes.ts`
- `packages/host/src/adapters/claude/claude-agent-sdk-transcript-mirror-events.ts`
- `packages/host/src/adapters/claude/claude-agent-sdk-transcript-mirror-store.test.ts`
- `packages/host/src/adapters/claude/claude-agent-sdk-transcript-mirror-store.ts`
- `packages/host/src/adapters/claude/claude-agent-sdk-transcript-retractions.ts`
- `packages/host/src/adapters/claude/claude-agent-sdk-types.ts`
- `packages/host/src/adapters/claude/claude-agent-sdk-usage.ts`
- `packages/host/src/adapters/claude/claude-agent-sdk-utils.test.ts`
- `packages/host/src/adapters/claude/claude-agent-sdk-utils.ts`
- `packages/host/src/adapters/claude/claude-code-executable.ts`
- `packages/host/src/adapters/runtimes/runtime-registry.test.ts`
- `packages/host/src/adapters/runtimes/runtime-registry.ts`
- `packages/host/src/adapters/runtimes/runtime-session-operations.ts`
- `packages/host/src/application/dev-servers/dev-server-state.ts`
- `packages/host/src/application/runtimes/claude-agent-sdk-service.ts`
- `packages/host/src/application/runtimes/runtime-definitions-service.test.ts`
- `packages/host/src/application/workspaces/workspace-settings-service.test.ts`
- `packages/host/src/composition/node/create-node-host-command-router.ts`
- `packages/host/src/events/host-event-bus.ts`
- `packages/host/src/interface/commands/host-command-registry.ts`
- `packages/openducktor-mcp/src/store-context.test.ts`
- `packages/openducktor-mcp/src/store-context.ts`
- `packages/openducktor-web/package.json`
- `packages/openducktor-web/src/browser-shell-bridge.ts`
- `packages/openducktor-web/src/typescript-host-backend-support.ts`
- `scripts/prepare-web-publish-packages.ts`

## Evidence and limits

- Semble search was used first to map the runtime integrations and compare Claude with OpenCode/Codex.
- GitNexus `detect_changes` used the exact worktree path and reported the CRITICAL branch footprint.
- GitNexus impact analysis was run on the policy, observer, task-sync, and subagent-key seams.
- The pinned SDK type/source confirms `query`, `resume`, `forkSession`, `settingSources`, permission callbacks, `pathToClaudeCodeExecutable`, supported-command queries, and SDK-native `duration_ms` surfaces. It also defaults the entrypoint to `sdk-ts`.
- The two unsafe shell classifications were reproduced directly against the current function.
- React Doctor 0.7.4 scanned the changed React surface and scored the workspaces 98/100 overall (Electron 100, frontend 98) without actionable diagnostics. This does not supersede the architecture and runtime-contract findings above.
- This task produced an audit document only. No production code was changed, and a full test suite was not used as evidence of correctness; several findings are specifically cases that current tests incorrectly bless or do not cover.
