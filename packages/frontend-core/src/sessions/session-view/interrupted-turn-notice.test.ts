import { describe, expect, test } from "bun:test";
import type { AgentSessionLiveRef, UsageLimitAutoResume } from "@openducktor/contracts";
import { buildInterruptedTurnNotice, interruptedTurnDetailText } from "./interrupted-turn-notice";

const now = Date.UTC(2026, 10, 15, 10, 0, 0);
const ref: AgentSessionLiveRef = {
  repoPath: "/repo",
  runtimeKind: "claude",
  workingDirectory: "/repo/worktree",
  externalSessionId: "session-1",
};
const resetsAtEpochMs = now + 90 * 60_000;
const planFields = { ref, stopId: "limit-1", resumeAtEpochMs: resetsAtEpochMs + 30_000 };
const autoResume = (state: "scheduled" | "resuming" = "scheduled"): UsageLimitAutoResume => ({
  ...planFields,
  state,
});
const text = (notice: ReturnType<typeof buildInterruptedTurnNotice>) =>
  interruptedTurnDetailText(notice.detail, (time) => time.toISOString());
const notice = (input: Partial<Parameters<typeof buildInterruptedTurnNotice>[0]>) =>
  buildInterruptedTurnNotice({
    usageLimit: { resetsAtEpochMs },
    autoResume: undefined,
    isResuming: false,
    resumeError: null,
    now,
    ...input,
  });

describe("interrupted turn notice", () => {
  test("a planned resume shows its time and offers Cancel", () => {
    const planned = notice({ autoResume: autoResume() });

    expect(planned.title).toBe("The session reached its usage limit.");
    expect(text(planned)).toBe(
      `Resumes automatically at ${new Date(resetsAtEpochMs + 30_000).toISOString()} (in 1h 31m).`,
    );
    expect(planned.canCancelAutoResume).toBe(true);
    expect(planned.isResuming).toBe(false);
  });

  test("without a planned resume, the reset countdown stays", () => {
    expect(text(notice({}))).toBe(
      `Resets in 1h 30m at ${new Date(resetsAtEpochMs).toISOString()}. Resume after the reset.`,
    );
    expect(text(notice({ now: resetsAtEpochMs + 60_000 }))).toBe(
      "The reported reset time has passed. Select Resume to try again.",
    );
    expect(text(notice({ usageLimit: {} }))).toBe(
      "Resume when usage is available. The runtime did not report a reset time.",
    );
  });

  test("a host resume shows Resuming without Cancel", () => {
    const resuming = notice({ autoResume: autoResume("resuming") });

    expect(resuming.isResuming).toBe(true);
    expect(resuming.canCancelAutoResume).toBe(false);
    expect(text(resuming)).toBe("Resuming after the reset.");
  });

  test("a failed resume shows its reason, and a newer local failure takes priority", () => {
    const failed: UsageLimitAutoResume = {
      ...planFields,
      state: "failed",
      failure: {
        stage: "continue",
        code: "runtime_unavailable",
        message: "The Claude runtime is not running.",
        nextAction: "Start the runtime, then select Resume.",
      },
    };

    expect(notice({ autoResume: failed }).error).toBe(
      "The Claude runtime is not running. Start the runtime, then select Resume.",
    );
    expect(notice({ autoResume: failed, resumeError: "Resume failed again." }).error).toBe(
      "Resume failed again.",
    );
  });

  test("a stop that is not a usage limit ignores the auto-resume", () => {
    const stopped = notice({ usageLimit: undefined, autoResume: autoResume() });

    expect(stopped.title).toBe("This turn stopped before it finished.");
    expect(text(stopped)).toBe("Resume continues from where it stopped, without a new message.");
    expect(stopped.canCancelAutoResume).toBe(false);
  });
});
