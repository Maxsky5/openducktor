---
status: accepted
date: 2026-06-25
---

# Implement Claude as a Claude Agent SDK runtime

## Decision

Implement Claude as a runtime with the official Claude Agent SDK. This decision supersedes [ADR 0004](./0004-use-claude-agent-sdk-for-claude-runtime.md), which chose the SDK but did not approve the implementation.

Anthropic paused its planned June 15, 2026 Agent SDK credit model. At the date of this decision, subscription-authenticated SDK use, `claude -p`, Claude Code GitHub Actions, and third-party SDK apps use subscription limits. Choose the SDK for its runtime controls, not for a billing assumption. It gives OpenDucktor structured system prompts, MCP servers, permission decisions, stream messages, settings sources, and session lifecycle.

## Options we rejected

- `claude -p` as the main runtime. It has the same subscription treatment, but OpenDucktor would own process control, stream parsing, permission routing, and error mapping.
- Interactive Claude Code as the managed runtime. It does not expose the structured OpenDucktor runtime contract. A later terminal launcher can remain separate.

## Consequences

Add a `claude` descriptor, host starter, runtime adapter, permission policy, MCP setup, settings, auth, billing guidance, and focused contract tests. Use the same runtime boundaries as OpenCode and Codex.

Link users to Anthropic's current plan policy instead of hard-coding quota rules. For shared automation, prefer Claude Platform API-key billing when fixed pay-as-you-go use matters more than a user's subscription limits.

## References

- [ADR 0004](./0004-use-claude-agent-sdk-for-claude-runtime.md)
- [Claude Agent SDK TypeScript reference](https://docs.anthropic.com/en/docs/claude-code/sdk/sdk-typescript)
- [Run Claude Code programmatically](https://docs.anthropic.com/en/docs/claude-code/headless)
- [Claude plan policy](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)
- [Runtime integration guide](../runtime-integration-guide.md)
