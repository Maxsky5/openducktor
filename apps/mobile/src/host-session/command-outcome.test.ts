import { describe, expect, test } from "bun:test";
import { RemoteConnectionError } from "@openducktor/host-client/remote";
import { toCommandFailure, toFlowFailure } from "./command-outcome";

const lost = new RemoteConnectionError({
  code: "outcome_unknown",
  message: "The result of task_close was lost.",
  nextAction:
    "Read current host state to check the outcome. Do not resend the operation automatically.",
});

describe("toCommandFailure", () => {
  test("shows a lost result as Result unknown with the host guidance", () => {
    expect(toCommandFailure(lost, "Close failed")).toEqual({
      kind: "unknown",
      title: "Result unknown",
      message:
        "The result of task_close was lost. Read current host state to check the outcome. Do not resend the operation automatically.",
    });
  });

  test("shows another failure with the action title and the host reason", () => {
    expect(toCommandFailure(new Error("Task TASK-1 is not closable."), "Close failed")).toEqual({
      kind: "failed",
      title: "Close failed",
      message: "Task TASK-1 is not closable.",
    });
  });

  test("keeps a connection failure that is not a lost result as a failure", () => {
    const refused = new RemoteConnectionError({
      code: "unavailable",
      message: "The host is not reachable.",
      nextAction: "Check the network.",
    });
    expect(toCommandFailure(refused, "Save failed").kind).toBe("failed");
  });
});

describe("toFlowFailure", () => {
  test("maps the outcome flag of a frontend-core flow", () => {
    expect(toFlowFailure("Lost.", true, "Approval failed").title).toBe("Result unknown");
    expect(toFlowFailure("Merge failed.", false, "Approval failed")).toEqual({
      kind: "failed",
      title: "Approval failed",
      message: "Merge failed.",
    });
  });
});
