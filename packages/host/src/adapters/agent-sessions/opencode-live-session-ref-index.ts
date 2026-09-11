import type { AgentSessionLiveRef } from "@openducktor/contracts";
import { HostValidationError } from "../../effect/host-errors";
import { refKey, toSessionRef } from "./opencode-live-session-normalization";

export class OpenCodeSessionRefIndex {
  private readonly byExternalId = new Map<string, Map<string, AgentSessionLiveRef>>();

  constructor(private readonly runtimeId: string) {}

  set(ref: AgentSessionLiveRef): void {
    let refs = this.byExternalId.get(ref.externalSessionId);
    if (!refs) {
      refs = new Map();
      this.byExternalId.set(ref.externalSessionId, refs);
    }
    refs.set(refKey(ref), ref);
  }

  delete(ref: AgentSessionLiveRef): void {
    const refs = this.byExternalId.get(ref.externalSessionId);
    refs?.delete(refKey(ref));
    if (refs?.size === 0) this.byExternalId.delete(ref.externalSessionId);
  }

  find(externalSessionId: string): AgentSessionLiveRef | null {
    const matches = this.byExternalId.get(externalSessionId);
    if (matches && matches.size > 1) {
      throw new HostValidationError({
        field: "externalSessionId",
        message: `OpenCode runtime '${this.runtimeId}' cannot route ambiguous session id '${externalSessionId}'.`,
        details: { runtimeId: this.runtimeId, externalSessionId },
      });
    }
    const ref = matches?.values().next().value;
    return ref ? toSessionRef(ref) : null;
  }

  clear(): void {
    this.byExternalId.clear();
  }
}
