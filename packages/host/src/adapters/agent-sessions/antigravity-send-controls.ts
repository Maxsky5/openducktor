import type { AgentWorkStartOptions } from "@openducktor/core";
import type { AgentSessionSendOptions } from "../../ports/agent-session-live-adapter-port";

/** The work start controls of a send. The host guard and the caller options run together. */
export const toSendControls = (
  input: AgentWorkStartOptions & { readonly submissionId?: string | undefined },
  options?: Pick<AgentSessionSendOptions, "assertCurrent" | "onSent">,
) => ({
  submissionId: input.submissionId,
  workStartGuard: {
    assertCurrent: () => {
      input.workStartGuard?.assertCurrent();
      options?.assertCurrent?.();
    },
  },
  onWorkIssued: () => {
    input.onWorkIssued?.();
    options?.onSent?.();
  },
  onWorkAccepted: input.onWorkAccepted,
});
