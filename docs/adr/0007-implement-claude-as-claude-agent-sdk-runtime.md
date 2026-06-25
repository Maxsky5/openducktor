---
status: accepted
date: 2026-06-25
---

# Implement Claude as a Claude Agent SDK Runtime

OpenDucktor will implement Claude as a first-class Runtime through the official Claude Agent SDK. This supersedes [ADR 0004](./0004-use-claude-agent-sdk-for-claude-runtime.md): the previous decision treated the SDK as the right path if OpenDucktor later built a managed Claude Runtime, while this decision says to build that Runtime. Anthropic has paused the planned June 15, 2026 separate Agent SDK credit model, so subscription-authenticated Claude Agent SDK usage, `claude -p`, Claude Code GitHub Actions, and third-party Agent SDK app usage currently still draw from subscription usage limits; the managed Runtime choice should therefore be based on integration control, where the SDK is the better surface because it gives OpenDucktor structured control over system prompts, MCP servers, permission decisions, streaming messages, settings sources, and session lifecycle.

## Considered Options

- Claude Agent SDK. Accepted because it is the documented programmable Claude Code surface for TypeScript/Python applications and exposes the controls OpenDucktor needs for a managed Runtime.
- `claude -p`. Rejected as the primary Runtime path because it has the same current subscription-usage treatment as SDK usage, while making OpenDucktor own process lifecycle, stream parsing, pending-permission routing, and error mapping that the SDK exposes directly.
- Interactive Claude Code in a terminal or IDE. Rejected as the managed Runtime path because it still uses normal subscription limits but does not expose OpenDucktor's structured Runtime contract. It can remain a separate launcher or terminal integration later.

## Consequences

Claude Runtime implementation work should add a `claude` Runtime Descriptor, host starter, Runtime Adapter, permission policy, MCP wiring, settings/auth/billing setup, and focused contract tests across the same runtime seams used by OpenCode and Codex. Product setup must link users to Anthropic's current plan policy instead of hard-coding quota assumptions, because subscription-authenticated SDK billing and usage treatment has already changed direction once. Shared production automation should prefer Claude Platform API-key billing when predictable pay-as-you-go usage is more important than using a user's Claude subscription limits.

Relevant references:

- [ADR 0004: Use Claude Agent SDK for the Managed Claude Runtime](./0004-use-claude-agent-sdk-for-claude-runtime.md)
- [Claude Agent SDK TypeScript reference](https://docs.anthropic.com/en/docs/claude-code/sdk/sdk-typescript)
- [Run Claude Code programmatically](https://docs.anthropic.com/en/docs/claude-code/headless)
- [Claude plan policy for Agent SDK usage](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)
- [OpenDucktor runtime integration guide](../runtime-integration-guide.md)
