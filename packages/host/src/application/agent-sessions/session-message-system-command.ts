import type { AgentSessionUserMessagePart } from "@openducktor/contracts";
import { type AgentUserMessagePart, classifySystemSlashCommandInvocation } from "@openducktor/core";

/** Classifies the system slash command of message parts that the host parsed. */
export const classifySessionMessageSystemCommand = (parts: AgentSessionUserMessagePart[]) =>
  // SAFETY: Parsed parts never hold an explicit undefined field, which is the only difference
  // between the contract parts and the core parts.
  classifySystemSlashCommandInvocation(parts as AgentUserMessagePart[]);
