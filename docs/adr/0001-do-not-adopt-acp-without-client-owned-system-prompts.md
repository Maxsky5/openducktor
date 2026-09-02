---
status: accepted
date: 2026-05-17
---

# Do not adopt ACP without client-owned system prompts

## Context

OpenDucktor sends the Spec, Planner, Builder, and QA role prompts as privileged runtime instructions. These prompts define the role, allowed ODT tools, task ID lock, lifecycle rules, artifacts, read-only rules, and failure behavior.

ACP standardizes client and agent messages, but its standard session and prompt methods do not accept client-owned system or developer instructions. `session/new` accepts the working directory and MCP setup. `session/prompt` sends normal content blocks. The agent owns its session modes. An agent can add a custom ACP method, but other ACP agents do not gain that method.

A role-scoped MCP server can reject a bad tool call. It cannot make a general agent follow the OpenDucktor role contract. A role prompt sent as user text is not a privileged instruction.

## Decision

Do not use standard ACP for an OpenDucktor workflow runtime until ACP has a client-owned privileged instruction channel.

Review this decision again only if one of these conditions becomes true:

- ACP adds a stable standard field for client-owned system or developer instructions.
- An ACP runtime has a documented and tested instruction channel that its OpenDucktor adapter can require.
- OpenDucktor limits the ACP integration to work that does not need the Spec, Planner, Builder, or QA contract.

## Options we rejected

- Prepend the role prompt as user text. User text cannot enforce the role contract.
- Use ACP session modes. The agent owns the mode and its prompt.
- Define an OpenDucktor ACP extension. Existing ACP agents would not support it.
- Wrap each native agent with ACP. This still needs one native integration for each agent.
- Enforce the role only through MCP. Tool access does not replace role instructions.

## Consequences

Evaluate each runtime against the native runtime contract. It must support privileged role prompts, ODT tools, read-only roles, the required session lifecycle, and history.

ACP can still inform transport and stream design. It is not a workflow runtime target under this decision.

## References

- [ACP session setup](https://agentclientprotocol.com/protocol/session-setup)
- [ACP prompt turn](https://agentclientprotocol.com/protocol/prompt-turn)
- [ACP session modes](https://agentclientprotocol.com/protocol/session-modes)
- [ACP extensibility](https://agentclientprotocol.com/protocol/extensibility)
- [Runtime integration guide](../runtime-integration-guide.md)
