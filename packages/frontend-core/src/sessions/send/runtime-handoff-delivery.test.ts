import { expect, mock, test } from "bun:test";
import type { AgentChatHandoffResult } from "@openducktor/contracts";
import type { HostClient } from "@openducktor/host-client";
import {
  acceptedLink,
  attach,
  chat,
  destination,
  missing,
  outcome,
  parts,
  source,
} from "../../test-support/runtime-handoff-fixture";
import { createAgentSessionsStore } from "../agent-sessions-store";
import {
  createHandoffDelivery,
  readHandoffDelivery,
  type HandoffDeliveryState,
} from "./runtime-handoff-delivery";

const setup = (client: Pick<HostClient, "agentChatHandoffSend" | "agentChatHandoffCheck">) => {
  const sessions = createAgentSessionsStore(chat.repoPath);
  attach(sessions, "host-one");
  let state: HandoffDeliveryState = {};
  const delivery = createHandoffDelivery({
    client,
    sessions,
    chat,
    identity: source,
    read: () => state,
    set: (changes) => {
      state = { ...state, ...changes };
    },
  });
  return {
    delivery,
    attachHost: (epoch: string) => attach(sessions, epoch),
    observe: (observation: AgentChatHandoffResult) => {
      sessions.applyLiveSessionEnvelope({ type: "session_operation_updated", observation });
      sessions.setSessionCollection((current) => current);
    },
    read: () =>
      readHandoffDelivery(
        sessions.getHandoffOperation(source),
        state,
        sessions.getHandoffHostEpoch(),
      ),
  };
};

test.each([false, true])(
  "a replacement host settles the original draft from the saved link, committed: %s",
  async (committed) => {
    const gate = Promise.withResolvers<void>();
    const started = Promise.withResolvers<void>();
    const send = mock<HostClient["agentChatHandoffSend"]>(async ({ submissionId }) =>
      outcome(submissionId, "accepted"),
    );
    const check = mock<HostClient["agentChatHandoffCheck"]>(async ({ submissionId }) => {
      started.resolve();
      await gate.promise;
      if (committed) return outcome(submissionId, "committed");
      throw missing(submissionId);
    });
    const { delivery, attachHost, read } = setup({
      agentChatHandoffSend: send,
      agentChatHandoffCheck: check,
    });
    const result = await delivery.send(destination, [...parts]);
    if (result === true || result === false) throw new Error("Expected an unresolved send");
    expect(read().latest?.handoff?.acceptedLink).toEqual(acceptedLink);

    attachHost("host-two");
    await started.promise;
    expect(read().latest?.handoff?.acceptedLink).toBeUndefined();
    expect(read().blocked).toBe(true);
    expect(check).toHaveBeenCalledWith(
      { chat, submissionId: send.mock.calls[0]![0].submissionId },
      { expectedHostEpoch: "host-two" },
    );
    expect(send.mock.calls[0]?.[1]).toEqual({ expectedHostEpoch: "host-one" });

    gate.resolve();
    expect(await result.settled).toBe(committed);
    if (committed) {
      expect(read().latest?.handoff).toMatchObject({ committed: true, acceptedLink });
    } else {
      expect(read().blocked).toBe(false);
    }
    expect(send).toHaveBeenCalledTimes(1);
  },
);

test.each(["host-one", "host-two"])(
  "keeps a Send pending across a snapshot from %s before its reply",
  async (epoch) => {
    const gate = Promise.withResolvers<void>();
    const send = mock<HostClient["agentChatHandoffSend"]>(async ({ submissionId }) => {
      await gate.promise;
      return outcome(submissionId, "committed");
    });
    const check = mock<HostClient["agentChatHandoffCheck"]>(async ({ submissionId }) =>
      outcome(submissionId, "committed"),
    );
    const { delivery, attachHost, read } = setup({
      agentChatHandoffSend: send,
      agentChatHandoffCheck: check,
    });
    const dispatch = delivery.send(destination, [...parts]);
    attachHost(epoch);
    expect(check).not.toHaveBeenCalled();
    expect(read().blocked).toBe(true);

    gate.resolve();
    const result = await dispatch;
    if (epoch === "host-one") {
      expect(result).toBe(true);
      expect(check).not.toHaveBeenCalled();
    } else {
      if (result === true || result === false)
        throw new Error("Expected the original pending send");
      expect(await result.settled).toBe(true);
      expect(check).toHaveBeenCalledTimes(1);
    }
    expect(read().latest?.handoff).toMatchObject({ committed: true, acceptedLink });
    expect(send).toHaveBeenCalledTimes(1);
  },
);

test("a missing same-host receipt leaves the draft pending until a live commit", async () => {
  const send = mock<HostClient["agentChatHandoffSend"]>(async () => {
    throw new Error("Send reply lost");
  });
  const { delivery, attachHost, observe, read } = setup({
    agentChatHandoffSend: send,
    agentChatHandoffCheck: async ({ submissionId }) => {
      throw missing(submissionId);
    },
  });
  const result = await delivery.send(destination, [...parts]);
  if (result === true || result === false) throw new Error("Expected an unresolved send");

  attachHost("host-one");
  await delivery.check();
  expect(read().blocked).toBe(true);
  expect(read().waitingForLocalDraft).toBe(true);

  const { submissionId } = send.mock.calls[0]![0];
  observe(outcome(submissionId, "committed"));
  expect(await result.settled).toBe(true);
  expect(send).toHaveBeenCalledTimes(1);
});
