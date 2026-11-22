---
status: accepted
date: 2026-11-21
---

# Run Antigravity as an ACP workflow runtime

## Context

[ADR 0001](./0001-do-not-adopt-acp-without-client-owned-system-prompts.md) blocks ACP as a workflow runtime until a runtime has a client-owned instruction channel that its adapter can require.

The Google Antigravity CLI serves ACP v1 over stdio with `agy acp`. Version 1.5.14 advertises `agentCapabilities._meta.antigravity.systemPrompt.append: true` in its `initialize` result. Its `session/new` and `session/load` requests accept `_meta.antigravity.systemPrompt.append`, and the runtime appends that text to its own system prompt. A check with 1.5.14 confirmed that the instructions apply to new and loaded sessions.

One `agy acp` process can serve concurrent sessions in different directories, each with its own stdio MCP server. `session/load` replays the full conversation, and `session/list` returns every session with its directory.

## Decision

Add Antigravity as the runtime kind `antigravity`. It is an exception to ADR 0001 for Antigravity only.

- The host starts one shared `agy acp` process in the user home directory, with no flags, so the native sandbox and permission settings apply.
- The adapter uses the official `@agentclientprotocol/sdk`. It needs the `/unstable` entrypoint for `elicitation/create`.
- The runtime start requires version 1.5.14 or later, `session/load`, `session/list`, `session/close`, and the system prompt extension. A missing fact fails the start with "Run `agy update`."
- Each `session/new` and `session/load` sends the saved worktree, the role or workspace instructions, and a managed OpenDucktor MCP server named `openducktor_session`. That server allows only the tools of the session role and carries a host-issued caller binding ID.
- The model list comes from `agy models`, because ACP 1.5.14 has no session-free model read. It keeps every model of the account, because the ACP server offers the same models to the session. One adapter module groups the lines into models with thinking levels as variants.
- The adapter keeps the live transcript of each session. History of a session that the runtime does not hold comes from `session/load` with no MCP servers, followed by `session/close`.
- OpenDucktor uses the `fff` file finder of [ADR 0008](./0008-use-fff-native-file-finder-for-claude-file-references.md) for file references, because ACP has no file search.

## Options we rejected

- One `agy acp` process for each session. It adds a process start to each session and breaks the one-runtime-for-each-kind lifecycle.
- A separate adapter package, as for Codex. It adds a package and a second Promise-to-Effect layer.
- The stable SDK entrypoint. It has no `elicitation/create`, which questions need.
- Hand-written JSON-RPC. It is more code that can drift from the protocol.
- A probe session for the model list. `session/new` saves a conversation for each read.
- `session/resume` to reopen a session. It replays nothing, so the transcript would need a second load.
- The native `plan` mode for read-only roles. It runs no command and waits for the user to approve its plan.

## Consequences

The system prompt extension is not in the public Antigravity documentation. If a release stops advertising it, the runtime start fails with an update action, and Antigravity sessions are unavailable until the user updates.

The managed MCP process starts before `session/new` returns the session ID, so the MCP server names a caller binding instead of the session. The live adapter resolves the binding for each tool call that needs the calling session.

Read-only roles are best effort. The adapter refuses permission requests for file changes, but Antigravity's `auto` mode can approve workspace edits without a request, and shell commands follow the native permissions.

ACP history has no message times, approval decisions, or stop markers. The host saves the times, model, and outcome of each turn of every runtime in the `agent_session_turns` table, and a history read adds them to the replay. A turn that ran in another client has approximate times, and a tool that Stop interrupted shows as failed.

Antigravity has no model call without a saved session, so a text generation opens a session in an empty temporary directory and fails when the model asks for a tool. Antigravity keeps that session in its history. The user accepted this exception to the text generation rule.

## References

- [Antigravity ACP guide](https://antigravity.google/docs/ide/extensions/acp/)
- [ACP TypeScript SDK](https://github.com/agentclientprotocol/typescript-sdk)
- [Runtime integration guide](../runtime-integration-guide.md)
- [External MCP](../external-mcp.md)
