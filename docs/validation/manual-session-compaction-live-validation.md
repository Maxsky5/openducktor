# Manual session compaction live validation

## Scope

- Task: `openduckto-tni5`
- Feature: reserved `/compact` system command for OpenCode and Codex
- Validated implementation: `ce920ba179`
- Browser application: `http://127.0.0.1:1420`, served from the task worktree
- Runtime data: user-authorized `~/.openducktor-local4` workspace
- Validation date: 2026-07-10

The canonical `~/.openducktor` browser store was not used. The user explicitly required live
testing to stay in `~/.openducktor-local4` or be left for manual validation.

## Repository-scoped composer

The `fairnest-hztf` QA composer had no selected QA session and displayed `Send a message to start
a new session`. Opening its slash menu with `/` produced zero `/compact` entries. No session was
created and no message was sent.

## OpenCode

| Evidence | Result |
| --- | --- |
| Selected session | `ses_0bca779bfffeG6ck0q8KZ50egR` |
| Working directory | `/Users/maxsky5/.openducktor-local4/worktrees/fairnest/fairnest-hztf` |
| Menu | Exactly one `/compact` entry labeled `SYSTEM`, with no argument hints |
| Native operation | One `POST /session/ses_0bca779bfffeG6ck0q8KZ50egR/summarize` |
| Model input | Provider `opencode-go`, model `glm-5.2` |
| Native response | HTTP 200 |
| Forbidden operations | Zero session command, prompt, or V2 compact requests in the cleared request log |
| Lifecycle correlation | Initial compaction part `prt_f4c7fb8130017NVEo6z2OFoOKe` on message `msg_f4c7fb81100172sZ0xfKY745xy`; repeated validation part `prt_f4ccbd589001ZPILoi6497I4KS` on message `msg_f4ccbd586001g2DZy5zCHF5tII` |
| UI lifecycle | The selected tab changed from `Idle` to `Working`, a provider-labeled compaction card appeared without a completed notice, then `Session compacted.` appeared and the session returned to `Idle` |
| Continuation | Same-session follow-up returned exactly `opencode compact follow-up ok` |

## Codex

| Evidence | Result |
| --- | --- |
| Selected thread | `019f3e0b-7ce7-7d41-acde-9855b738ff57` |
| Menu | Exactly one `/compact` entry labeled `SYSTEM`, with no argument hints |
| Native operation | One `codex_app_server_request` with method `thread/compact/start` and the selected thread id |
| Native response | HTTP 200 |
| Forbidden operations | Zero `turn/start` or `turn/steer` requests for the compaction action in the cleared request log |
| Lifecycle correlation | Initial native `contextCompaction` item `item-3`; repeated validation item `item-6` |
| UI lifecycle | The selected tab changed from `Idle` to `Working`, then `Session compacted.` appeared and the thread returned to `Idle` |
| Continuation | Same-thread follow-up returned exactly `compact follow-up ok` |

## Failure and recovery evidence

The first Codex live attempt reached the host with exactly one `thread/compact/start` request and
failed with HTTP 500 and this visible error:

> Failed to send message: Codex failed to compact thread
> `019f3e0b-7ce7-7d41-acde-9855b738ff57`: Unsupported Codex app-server request method:
> `thread/compact/start`

The cleared request log contained no `turn/start` or `turn/steer` fallback. This failure exposed
the missing host request allowlist entry. Commit `ce920ba179` added the method to
`CODEX_APP_SERVER_REQUEST_METHODS` with a host command-router regression. After restarting the
host from the same worktree, the repeated native request returned HTTP 200 and completed through
the runtime lifecycle described above.

After the repaired success path, an isolated app-server request used the deliberately nonexistent
thread id `odt-validation-missing-thread`. Exactly one `thread/compact/start` request returned HTTP
500 with this actionable runtime error:

> Codex app-server request `thread/compact/start` failed: invalid thread id: invalid character:
> expected an optional prefix of `urn:uuid:` followed by `[0-9a-fA-F-]`, found `o` at 1

The cleared request log contained one compact request and zero `turn/start` or `turn/steer`
requests, so the failure did not retry or fall back. The rejection probe was deliberately issued
outside a persisted session and therefore created no running or completed transcript notice.
Adapter and frontend tests separately verify that a failure from a real selected-session send
removes its running notice and surfaces existing session error feedback. No persisted Fairnest
session identity was corrupted to manufacture the rejection.

## Fresh automated verification

After the live run, the critical contract, core, OpenCode, Codex, host, and frontend suites were
rerun together: 283 tests passed with zero failures. Monorepo typecheck and lint passed, including
the frontend boundary guard and host architecture guard. `git diff --check main...HEAD` passed and
the worktree was clean before this evidence document was added.

The complete repository test and build commands had already passed at the same implementation
HEAD before this evidence-only rework. No production code, schema, task-store record shape,
runtime-route persistence, or frontend cache changed while recording this validation.

## Requirement coverage

- AC-1 and AC-2: one system-labeled command was visible in selected OpenCode and Codex sessions.
- AC-3: the repository-scoped QA composer showed no `/compact` entry and created no session.
- AC-5 and AC-6: each provider received exactly one native request with zero forbidden fallback
  endpoints.
- AC-8: provider lifecycle identifiers were present and the shared UI settled to completed/idle.
- AC-9: both the pre-fix allowlist failure and the post-fix invalid-thread rejection were
  actionable, exact-once, and had zero fallback calls; the repaired valid path succeeded.
- AC-10: both providers accepted and completed an ordinary follow-up in the same session/thread.
- AC-12: focused automation and both provider success paths passed. Repository/new-session scope,
  unsupported structured parts, provider rejection, and unavailable prerequisites retain direct
  automated coverage.
