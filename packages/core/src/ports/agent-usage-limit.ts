import type { AgentSessionLiveRef } from "@openducktor/contracts";

/** The usage-limit error that ends the latest turn of a session. */
export type UsageLimitStop = {
  /** The native message ID of the error, which the live `turn_error` also carries. */
  readonly stopId: string;
  readonly occurredAtEpochMs: number;
  readonly resetsAtEpochMs?: number;
};

/** Whether the account of a session can work again after a usage limit. */
export type UsageLimitRecovery =
  | { readonly kind: "recovered" }
  /** Usage is not back yet. The reset time tells when to ask again. */
  | { readonly kind: "waiting"; readonly resetsAtEpochMs: number }
  /** The runtime cannot tell. Only a manual Resume can continue. */
  | { readonly kind: "unknown" };

/** The usage-limit reads of a runtime that sets `supportsUsageLimitAutoResume`. */
export type AgentUsageLimitPort = {
  readLatestUsageLimitStop(input: AgentSessionLiveRef): Promise<UsageLimitStop | null>;
  readUsageLimitRecovery(input: AgentSessionLiveRef): Promise<UsageLimitRecovery>;
};
