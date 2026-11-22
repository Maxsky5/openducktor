import {
  type AgentSessionAuthorizedRoot,
  type AgentSessionLiveRef,
  type AgentSessionLiveSnapshot,
  type AgentSessionTranscriptEvent,
  agentSessionTranscriptEventSchema,
  isAgentSessionTranscriptEventType,
  type SlashCommandCatalog,
} from "@openducktor/contracts";
import type { AgentEvent } from "@openducktor/core";

/** One ordered change of the live state of this runtime. */
export type AntigravityLiveChange = {
  readonly snapshots: AgentSessionLiveSnapshot[];
  readonly removedRefs: AgentSessionLiveRef[];
  readonly events: AgentSessionTranscriptEvent[];
  readonly slashCommands?: {
    readonly ref: AgentSessionLiveRef;
    readonly catalog: SlashCommandCatalog;
  };
  readonly provenance?: "baseline";
  readonly admittedRoot?: AgentSessionAuthorizedRoot;
};

/** Applies a change in order. The promise settles when the host applied it. */
export type AntigravityLivePublisher = (change: AntigravityLiveChange) => Promise<void>;

export type AntigravityPublishOptions = Partial<
  Pick<AntigravityLiveChange, "provenance" | "admittedRoot">
>;

/** Keeps the events of the ordered session stream and adds the session ref. */
export const toTranscriptEvents = (
  ref: AgentSessionLiveRef,
  events: readonly AgentEvent[],
): AgentSessionTranscriptEvent[] =>
  events.flatMap((event) =>
    isAgentSessionTranscriptEventType(event.type)
      ? [agentSessionTranscriptEventSchema.parse({ ...event, sessionRef: ref })]
      : [],
  );
