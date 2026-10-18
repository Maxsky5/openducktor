import { expect, test } from "bun:test";
import { HostInvokeError } from "@openducktor/host-client";
import { AgentRuntimeTestAdapter } from "../../../test-support/agent-runtime-test-adapter";
import { createOpenCodeAgentEngineTestAdapter } from "./opencode-agent-engine.test-support";
import { acceptedSubmitResult } from "./session-actions-send.test-support";
import {
  buildSession,
  createSessionActions,
  createSessionsRef,
  getSession,
} from "./session-actions.test-helpers";

test.each(["opencode", "codex", "claude"] as const)(
  "a stopped %s session sends one host intent without local reattachment",
  async (runtimeKind) => {
    const adapter = createOpenCodeAgentEngineTestAdapter(new AgentRuntimeTestAdapter());
    const session = buildSession({
      runtimeKind,
      status: "stopped",
      sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },
    });
    const sessionsRef = createSessionsRef([session]);
    let sends = 0;
    adapter.resumeSession = async () => {
      throw new Error("The host owns reattachment.");
    };
    adapter.submitUserMessage = async (input) => {
      sends += 1;
      expect(input).not.toHaveProperty("model");
      expect(input).not.toHaveProperty("systemPrompt");
      expect(input).toMatchObject({
        externalSessionId: session.externalSessionId,
        runtimeKind,
        sessionScope: session.sessionAssociation,
      });
      return acceptedSubmitResult(input);
    };
    const actions = createSessionActions({ adapter, sessionsRef });
    expect(
      await actions.sendAgentMessage(getSession(sessionsRef), [{ kind: "text", text: "Continue" }]),
    ).toMatchObject({ outcome: "accepted" });
    expect(sends).toBe(1);
  },
);

test("a lost host response stays uncertain and never becomes an unsent draft", async () => {
  const adapter = createOpenCodeAgentEngineTestAdapter(new AgentRuntimeTestAdapter());
  const sessionsRef = createSessionsRef([buildSession({ status: "stopped" })]);
  adapter.submitUserMessage = async () => {
    throw new Error("Connection ended after dispatch.");
  };
  const actions = createSessionActions({ adapter, sessionsRef });
  const receipt = await actions.sendAgentMessage(getSession(sessionsRef), [
    { kind: "text", text: "Continue" },
  ]);
  const submissionId = receipt?.outcome === "uncertain" ? receipt.submissionId : undefined;
  expect(submissionId).toEqual(expect.any(String));
  expect(receipt?.outcome).toBe("uncertain");
  expect(getSession(sessionsRef)?.pendingSubmissionId).toBe(submissionId);
});

test("a confirmed host refusal keeps the draft eligible for correction", async () => {
  const adapter = createOpenCodeAgentEngineTestAdapter(new AgentRuntimeTestAdapter());
  const sessionsRef = createSessionsRef([buildSession({ status: "stopped" })]);
  adapter.submitUserMessage = async () => {
    throw new HostInvokeError("Review the selected model.", { kind: "workflow_intent_rejected" });
  };
  const actions = createSessionActions({ adapter, sessionsRef });
  await expect(
    actions.sendAgentMessage(getSession(sessionsRef), [{ kind: "text", text: "Continue" }]),
  ).rejects.toThrow("Review the selected model.");
  expect(getSession(sessionsRef)?.pendingSubmissionId).toBeUndefined();
});
