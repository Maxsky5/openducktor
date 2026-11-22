import type { AgentTurnOutcome, RuntimeKind } from "@openducktor/contracts";
import type { AgentModelSelection } from "@openducktor/core";
import type { Effect } from "effect";
import type { HostError } from "../effect/host-errors";

/** The runtime session that a turn belongs to. */
export type AgentSessionTurnSessionKey = {
  readonly runtimeKind: RuntimeKind;
  readonly externalSessionId: string;
};

/** A user message that the runtime accepted. It starts a turn; a steer starts its own turn. */
type AgentSessionTurnStart = AgentSessionTurnSessionKey & {
  readonly workspaceId: string;
  readonly userMessageId: string;
  /** A hash of the user message text. A reader uses a turn only when its message still matches. */
  readonly userMessageHash: string;
  readonly startedAt: string;
  readonly model?: AgentModelSelection | undefined;
};

/** The end of a run, saved on the turn of its last user message. */
type AgentSessionTurnEnd = AgentSessionTurnSessionKey & {
  readonly userMessageId: string;
  readonly completedAt: string;
  readonly outcome: AgentTurnOutcome;
  /** The time from the first user message of the run to its end. */
  readonly durationMs?: number | undefined;
  readonly finalMessageId?: string | undefined;
  /** The notice of a run that the user stopped. */
  readonly interruption?: { readonly messageId: string; readonly message: string } | undefined;
};

/** One turn that the host saw while the session was live. */
export type AgentSessionTurnRecord = Omit<AgentSessionTurnStart, "workspaceId"> &
  Partial<Omit<AgentSessionTurnEnd, keyof AgentSessionTurnSessionKey | "userMessageId">>;

/**
 * Keeps the facts of each turn that the host saw live, for every runtime. History reads use them
 * where the runtime history lacks them, and turns of several sessions can form one conversation.
 */
export type AgentSessionTurnStorePort = {
  /** Saves a turn once. A later start of the same user message keeps the first one. */
  readonly recordTurnStart: (start: AgentSessionTurnStart) => Effect.Effect<void, HostError>;
  readonly recordTurnEnd: (end: AgentSessionTurnEnd) => Effect.Effect<void, HostError>;
  /** The turns of a session in start order. */
  readonly listTurns: (
    session: AgentSessionTurnSessionKey,
  ) => Effect.Effect<AgentSessionTurnRecord[], HostError>;
};
