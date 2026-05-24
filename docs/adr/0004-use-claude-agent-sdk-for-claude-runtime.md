---
status: accepted
date: 2026-05-24
---

# Use Claude Agent SDK for the Managed Claude Runtime

OpenDucktor will integrate Claude as a managed workflow runtime through the official Claude Agent SDK, not through `claude -p` as the primary adapter path. The SDK is the only documented Claude Code integration surface that directly exposes the runtime capabilities OpenDucktor needs: client-owned system prompt configuration, MCP/tool wiring, permission control, session lifecycle controls, streaming events, and resume/fork behavior.

## Context

OpenDucktor workflow runtimes must satisfy the native runtime contract before they can run Spec, Planner, Builder, or QA sessions. That contract requires privileged role prompts, ODT workflow tool execution, read-only role safety, session lifecycle support, history behavior, and explicit capability descriptors. The previous ACP decision records the same baseline: role prompts must be privileged runtime instructions, not ordinary user prompt text.

Claude Code can be integrated through multiple documented surfaces:

- the Claude Agent SDK,
- `claude -p` / headless CLI usage,
- interactive Claude Code in a terminal or IDE,
- background CLI sessions managed with commands such as `claude --bg`, `claude agents --json`, `claude logs`, `claude attach`, and `claude stop`.

These surfaces are not equivalent for OpenDucktor. Some expose a typed programmable agent loop; some expose process streams; some require a terminal interaction model. A terminal-based integration is technically possible and introducing a new terminal surface is not a blocker by itself, but terminal capability is a separate question from whether the runtime can satisfy OpenDucktor's managed `AgentEnginePort` contract.

Anthropic's current Claude plan policy also changes the trade-off. Starting June 15, 2026, subscription usage of the Claude Agent SDK, `claude -p`, and similar programmatic surfaces uses a separate Agent SDK monthly credit. Interactive Claude Code in the terminal or IDE continues to use the normal subscription usage limits. API-key usage through Claude Platform remains pay-as-you-go.

## Decision

Use the Claude Agent SDK as the primary implementation path for a first-class OpenDucktor Claude runtime.

The Claude runtime adapter should treat the SDK as the owned integration surface for:

- injecting OpenDucktor role prompts through the SDK `systemPrompt` option,
- exposing ODT workflow tools through SDK-supported MCP configuration or in-process MCP tooling,
- enforcing read-only role safety through SDK permission controls such as `canUseTool`, `disallowedTools`, `permissionMode`, and OpenDucktor runtime descriptors,
- streaming Claude events into OpenDucktor transcript and tool-call events,
- mapping Claude session identifiers into OpenDucktor session records,
- using SDK resume/fork/session-store capabilities only where they can be represented faithfully in OpenDucktor's session lifecycle model.

Do not use `allowedTools` as a restriction mechanism. The SDK documents `allowedTools` as auto-approval, not as a tool allowlist. Tool blocking must use deny rules, custom permission decisions, and runtime-owned blocked tool declarations.

Prefer an OpenDucktor-authored system prompt for managed workflow sessions. Anthropic's system prompt guidance says the `claude_code` preset is best for CLI or IDE-like coding tools where a human watches and steers the work, while a custom prompt is appropriate for agents with a different surface, identity, or permission model. OpenDucktor's role-based workflow runtime has a different surface and permission model from the stock Claude Code terminal, so the adapter should not assume the Claude Code preset is sufficient. The preset with `append` may still be evaluated experimentally, but it is not the default architectural decision.

Treat terminal Claude Code integration as a separate capability path. OpenDucktor may later offer a terminal-backed Claude workflow or launcher that uses interactive Claude Code with ODT MCP configuration and prompt files. That path is technically possible, and it may be valuable for users who want subscription-limit interactive usage, but it should not be conflated with the managed SDK runtime unless it can expose the same structured lifecycle, history, permission, and event semantics.

## Considered Options

- Claude Agent SDK. Accepted because it exposes the most complete documented programmable surface: system prompt configuration, MCP server configuration, custom permission callbacks, deny rules, sessions, resume/fork controls, streaming messages, session storage, model selection, and optional bundled Claude Code binary resolution.
- `claude -p`. Rejected as the primary path because it is a CLI process interface over programmatic usage. It can technically support system prompt flags, JSON or streaming JSON output, MCP config, permission-prompt tooling, resume, fork, and model selection, but it would make OpenDucktor own process lifecycle, stream parsing, pending-permission routing, and error mapping that the SDK exposes directly.
- Interactive Claude Code in a terminal. Rejected as the managed-runtime path, not as a capability. It can technically run Claude Code with system prompt files, MCP config, tool flags, and normal subscription interactive usage, but OpenDucktor would need a terminal or PTY-backed runtime model to represent it honestly. It should be considered a separate terminal integration or launch workflow.
- Claude CLI background sessions. Rejected as the managed-runtime path because the documented CLI management commands provide session start/list/log/attach/stop controls, not the full structured `AgentEnginePort` contract. They remain useful evidence for a future terminal/background workflow.
- Direct Anthropic Messages API. Rejected as a Claude Code integration because it would require OpenDucktor to build its own coding-agent loop, tool policy, file editing, shell execution, session model, and MCP behavior instead of integrating Claude Code's documented agent runtime.

## Consequences

The Claude runtime should be designed like the existing OpenCode and Codex runtimes: contracts first, descriptor first, then host starter and adapter behavior. It needs its own `runtimeKind`, capability descriptor, native mutating-tool blocklist, workflow tool alias map, runtime binary or SDK package resolution, and explicit auth/billing configuration.

The subscription policy must be visible in product and setup decisions. A managed SDK runtime is programmatic usage and is affected by the June 15, 2026 Agent SDK credit model for subscription users. For shared production automation or predictable billing, Claude Platform API-key usage is the safer default.

The SDK's bundled native Claude Code binary is useful for local setup, but packaging must be handled deliberately. The SDK documentation notes that Bun single-executable packaging needs the native binary extracted to a real path and passed as `pathToClaudeCodeExecutable`.

Capability claims must stay conservative until verified against the SDK. In particular, approvals, questions, history fidelity, todos, diff, file status, slash commands, and subagents should only be marked supported when the adapter can expose them through OpenDucktor's existing contracts without flattening or fallback behavior.

Relevant evidence:

- [Claude Agent SDK TypeScript reference](https://code.claude.com/docs/en/agent-sdk/typescript)
- [Claude Agent SDK system prompt guidance](https://code.claude.com/docs/en/agent-sdk/modifying-system-prompts)
- [Claude CLI reference](https://code.claude.com/docs/en/cli-reference)
- [Claude headless mode documentation](https://code.claude.com/docs/en/headless)
- [Claude plan policy for Agent SDK usage](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)
- [OpenDucktor runtime integration guide](../runtime-integration-guide.md)
- [ADR 0001: Do Not Adopt ACP Without Client-Owned System Prompts](./0001-do-not-adopt-acp-without-client-owned-system-prompts.md)
