---
status: superseded by ADR-0007
date: 2026-05-24
---

# Use Claude Agent SDK for the managed Claude runtime

## Context

This decision selected the Claude Agent SDK if OpenDucktor built a managed Claude runtime. [ADR 0007](./0007-implement-claude-as-claude-agent-sdk-runtime.md) later approved that implementation.

An OpenDucktor workflow runtime must provide privileged role prompts, ODT tools, read-only role rules, session lifecycle, history, and capability descriptors. Claude Code offered several ways to run it: the Agent SDK, `claude -p`, an interactive terminal or IDE, and background CLI commands.

Only the Agent SDK exposed the needed controls through one documented TypeScript API. It provided system prompts, MCP setup, permission decisions, stream events, session IDs, resume, and fork.

At the time of this decision, Anthropic planned a separate Agent SDK credit model for subscription use. ADR 0007 records the later policy change.

## Decision

Use the Claude Agent SDK for a managed Claude runtime.

- Send OpenDucktor role prompts with the SDK `systemPrompt` option.
- Add ODT tools through SDK MCP support.
- Enforce read-only roles with `canUseTool`, `disallowedTools`, `permissionMode`, and runtime descriptors.
- Map SDK stream messages to OpenDucktor transcript and tool events.
- Map Claude session IDs to OpenDucktor session records.
- Use SDK resume, fork, and session storage only when they match the OpenDucktor lifecycle contract.

Do not use `allowedTools` as a tool limit. In this SDK it grants approval. Use deny rules, permission decisions, and runtime blocked-tool declarations to block tools.

Use an OpenDucktor system prompt for managed workflow sessions. The `claude_code` preset targets a human-led CLI or IDE. A future test can assess the preset with appended instructions, but it is not the default.

Treat interactive terminal use as a separate product path. It must meet the same lifecycle, history, permission, and event contracts before it can act as the managed runtime.

## Options we rejected

- `claude -p` as the main path. OpenDucktor would have to own process control, stream parsing, permission routing, and error mapping.
- Interactive Claude Code as the managed runtime. A terminal does not provide the full `AgentEnginePort` contract.
- Claude background CLI sessions. Their start, list, log, attach, and stop commands do not provide the full runtime contract.
- The Anthropic Messages API. OpenDucktor would have to build the coding-agent loop, tools, session model, and MCP support.

## Consequences

A Claude adapter needs its own runtime kind, descriptor, mutating-tool blocklist, tool aliases, SDK or binary discovery, and auth setup.

Bun single-executable packages must extract the SDK's native Claude Code binary to a real path and pass it as `pathToClaudeCodeExecutable`.

Keep a capability disabled until the adapter proves that it can map the native feature without losing data or adding a fallback. This rule applies to approvals, questions, history, todos, diff, file status, slash commands, and subagents.

## References

- [Claude Agent SDK TypeScript reference](https://code.claude.com/docs/en/agent-sdk/typescript)
- [Claude Agent SDK system prompt guidance](https://code.claude.com/docs/en/agent-sdk/modifying-system-prompts)
- [Claude CLI reference](https://code.claude.com/docs/en/cli-reference)
- [Claude headless mode documentation](https://code.claude.com/docs/en/headless)
- [Claude plan policy](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)
- [Runtime integration guide](../runtime-integration-guide.md)
- [ADR 0001](./0001-do-not-adopt-acp-without-client-owned-system-prompts.md)
