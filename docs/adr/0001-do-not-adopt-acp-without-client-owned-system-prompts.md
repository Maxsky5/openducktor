---
status: accepted
date: 2026-05-17
---

# Do Not Adopt ACP Without Client-Owned System Prompts

OpenDucktor workflow runtimes must receive the Spec, Planner, Builder, and QA role prompts as privileged runtime instructions, not as ordinary user prompt text. The current ACP standard does not expose a client-owned system or developer prompt field on session creation, loading, forking, or prompt turns, so vanilla ACP agents are not eligible as OpenDucktor workflow runtimes.

## Context

OpenDucktor role prompts are part of the runtime contract. They define the role mission, allowed ODT workflow tools, task-id locking, lifecycle rules, artifact discipline, read-only expectations, and failure behavior for Spec, Planner, Builder, and QA sessions.

ACP is attractive because it standardizes client/agent communication and could theoretically let OpenDucktor reach many coding agents through one adapter. However, ACP `session/new` provides working directory and MCP server setup, `session/prompt` sends normal content blocks, and session modes are selected from modes advertised by the agent. ACP extensibility allows custom methods and metadata, but that only helps when an individual agent explicitly implements the extension.

Prepending the OpenDucktor role prompt as normal prompt text is not equivalent to privileged system prompt injection. A role-scoped MCP server can reject invalid workflow tool calls, but it cannot make a generic agent understand and follow the OpenDucktor role contract.

## Decision

OpenDucktor will not implement vanilla ACP as a workflow runtime while ACP lacks a standard client-owned privileged instruction channel.

ACP may be reconsidered only if one of these becomes true:

- ACP adds a stable standard way for the client to provide privileged session instructions that agents must apply as system or developer prompt material.
- A specific ACP-backed runtime provides a documented, tested, non-standard instruction channel that OpenDucktor can treat as part of that runtime's adapter contract.
- OpenDucktor explicitly scopes a future ACP integration to non-workflow experimentation where Spec, Planner, Builder, and QA guarantees are not required.

## Considered Options

- Adopt vanilla ACP and prepend role prompts as user text. Rejected because it weakens mandatory role instructions into ordinary prompt content.
- Use ACP session modes. Rejected as a generic solution because modes are agent-owned; OpenDucktor cannot define their prompt bodies.
- Define an OpenDucktor ACP extension. Rejected as a general interoperability solution because existing ACP agents will not implement it.
- Build ACP wrappers around native agents. Rejected as the reason to choose ACP for broad compatibility; this becomes per-agent native integration behind an ACP facade.
- Enforce only through MCP. Rejected because tool gating does not replace role instruction injection.

## Consequences

The next OpenDucktor runtime should be evaluated against the native runtime contract first: it must support privileged role prompt injection, ODT workflow tools, read-only role safety, session lifecycle requirements, and history behavior described in the runtime integration guide.

ACP can still be useful research material for transport, streaming event shapes, and ecosystem direction, but it is not currently a viable runtime-integration target for OpenDucktor's workflow agents.

Relevant evidence:

- [ACP session setup](https://agentclientprotocol.com/protocol/session-setup)
- [ACP prompt turn](https://agentclientprotocol.com/protocol/prompt-turn)
- [ACP session modes](https://agentclientprotocol.com/protocol/session-modes)
- [ACP extensibility](https://agentclientprotocol.com/protocol/extensibility)
- [OpenDucktor runtime integration guide](../runtime-integration-guide.md)
