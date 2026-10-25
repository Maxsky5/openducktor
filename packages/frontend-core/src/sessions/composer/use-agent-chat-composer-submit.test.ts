import "../../test-support/dom-environment";
import { describe, expect, mock, test } from "bun:test";
import { VISIBLE_APP } from "../../test-support/app-visibility-fake";
import type { AgentMessageSubmitMode } from "@openducktor/contracts";
import { useLayoutEffect, useRef } from "react";
import {
  type AgentChatComposerDraft,
  createTextSegment,
  draftToSerializedText,
} from "../../drafts/agent-chat-composer-draft";
import { createHookHarness } from "../../test-support/react-hook-harness";
import { remoteError } from "@openducktor/host-client/remote";
import type { AgentChatSendResult } from "../send/agent-chat-send-result";
import type { ComposerFailure } from "./composer-failure";
import { useAgentChatComposerDraftState } from "./use-agent-chat-composer-draft-state";
import {
  type ComposerSubmitModel,
  useAgentChatComposerSubmit,
} from "./use-agent-chat-composer-submit";

const draftWith = (text: string): AgentChatComposerDraft => ({
  segments: [createTextSegment(text, "text-1")],
  attachments: [],
});

type Props = {
  onSend: ComposerSubmitModel["onSend"];
  isSessionWorking?: boolean;
  steerBlockedReason?: string | null;
  reportError: (failure: ComposerFailure) => void;
};

const useComposer = ({
  onSend,
  isSessionWorking = false,
  steerBlockedReason = null,
  reportError,
}: Props) => {
  const draftState = useAgentChatComposerDraftState({
    scope: { key: "chat-1", persistence: null },
    // The test client never hides.
    visibility: VISIBLE_APP,
  });
  const draftRef = useRef(draftState.draft);
  useLayoutEffect(() => {
    draftRef.current = draftState.draft;
  }, [draftState.draft]);
  const submit = useAgentChatComposerSubmit({
    model: {
      isSessionWorking,
      onSend,
      draftScope: { key: "chat-1" },
      steerBlockedReason,
      runningTurnModel: null,
    },
    draftState,
    draftRef,
    settingsReady: true,
    sendInputBlocked: false,
    defaultSendDisabled: false,
    reportError,
    onDraftReplaced: () => {},
    onSettledInScope: () => {},
  });
  return { draftState, submit };
};

/** A send that ends when the test settles it, so the cleared draft renders first. */
const deferredSend = () => {
  let settle: (outcome: () => AgentChatSendResult) => void = () => {};
  const onSend = mock(
    (_draft: AgentChatComposerDraft, _mode: AgentMessageSubmitMode) =>
      new Promise<AgentChatSendResult>((resolve, reject) => {
        settle = (outcome) => {
          try {
            resolve(outcome());
          } catch (cause) {
            reject(cause);
          }
        };
      }),
  );
  return { onSend, settle: (outcome: () => AgentChatSendResult) => settle(outcome) };
};

const mountComposer = async (props: Props) => {
  const harness = createHookHarness(useComposer, props);
  await harness.mount();
  await harness.run((state) => state.draftState.commitDraft(draftWith("Fix the build")));
  return harness;
};

describe("useAgentChatComposerSubmit", () => {
  test("clears the draft at once and keeps it cleared after a send", async () => {
    let finishSend: (result: AgentChatSendResult) => void = () => {};
    const onSend = mock(
      (_draft: AgentChatComposerDraft, _mode: AgentMessageSubmitMode) =>
        new Promise<AgentChatSendResult>((resolve) => {
          finishSend = resolve;
        }),
    );
    const harness = await mountComposer({ onSend, reportError: () => {} });
    let sending: Promise<void> = Promise.resolve();
    await harness.run((state) => {
      sending = state.submit("default");
    });

    expect(draftToSerializedText(harness.getLatest().draftState.draft)).toBe("");
    expect(draftToSerializedText(onSend.mock.calls[0]?.[0] ?? draftWith(""))).toBe("Fix the build");
    await harness.run(async () => {
      finishSend(true);
      await sending;
    });
    expect(draftToSerializedText(harness.getLatest().draftState.draft)).toBe("");
    await harness.unmount();
  });

  test("sends a draft once when a second submit comes before the cleared draft renders", async () => {
    const send = deferredSend();
    const harness = await mountComposer({ onSend: send.onSend, reportError: () => {} });
    let sending: Promise<void> = Promise.resolve();
    await harness.run((state) => {
      sending = state.submit("default");
      void state.submit("default");
    });
    expect(send.onSend).toHaveBeenCalledTimes(1);

    await harness.run(async () => {
      send.settle(() => {
        throw new Error("The host is not reachable.");
      });
      await sending;
    });
    // The failed send restores the draft, and the user can send it again.
    expect(draftToSerializedText(harness.getLatest().draftState.draft)).toBe("Fix the build");
    await harness.run((state) => {
      void state.submit("default");
    });
    expect(send.onSend).toHaveBeenCalledTimes(2);
    await harness.unmount();
  });

  test("restores the draft and reports the reason when the send fails", async () => {
    const reportError = mock((_failure: ComposerFailure) => {});
    const send = deferredSend();
    const harness = await mountComposer({ onSend: send.onSend, reportError });
    let sending: Promise<void> = Promise.resolve();
    await harness.run((state) => {
      sending = state.submit("default");
    });
    expect(draftToSerializedText(harness.getLatest().draftState.draft)).toBe("");
    await harness.run(async () => {
      send.settle(() => {
        throw new Error("The host is not reachable.");
      });
      await sending;
    });

    expect(draftToSerializedText(harness.getLatest().draftState.draft)).toBe("Fix the build");
    expect(reportError).toHaveBeenCalledWith({
      kind: "failed",
      title: "Unable to send message",
      message: "The host is not reachable.",
    });
    await harness.unmount();
  });

  test("reports a lost result as unknown when the send recovers the draft", async () => {
    const reportError = mock((_failure: ComposerFailure) => {});
    const send = deferredSend();
    const harness = await mountComposer({ onSend: send.onSend, reportError });
    let sending: Promise<void> = Promise.resolve();
    await harness.run((state) => {
      sending = state.submit("default");
    });
    await harness.run(async () => {
      send.settle(() => ({
        kind: "recover_draft",
        originKey: "chat-1",
        recoveryKey: "chat-1",
        error: remoteError("outcome_unknown", "The send result is unknown.", "Reconnect."),
      }));
      await sending;
    });

    expect(draftToSerializedText(harness.getLatest().draftState.draft)).toBe("Fix the build");
    expect(reportError).toHaveBeenCalledWith({
      kind: "result_unknown",
      title: "Result unknown",
      message:
        "The send result is unknown. Reconnect. Check the transcript before you send it again.",
    });
    await harness.unmount();
  });

  test("keeps the draft when a steer cannot join the running turn", async () => {
    const onSend = mock(async () => true);
    const reportError = mock((_failure: ComposerFailure) => {});
    const harness = await mountComposer({
      onSend,
      isSessionWorking: true,
      steerBlockedReason: "This runtime cannot steer a running turn.",
      reportError,
    });
    await harness.run((state) => state.submit("steer"));

    expect(onSend).not.toHaveBeenCalled();
    expect(reportError).toHaveBeenCalledWith({
      kind: "failed",
      title: "Cannot steer this message",
      message: "This runtime cannot steer a running turn.",
    });
    expect(draftToSerializedText(harness.getLatest().draftState.draft)).toBe("Fix the build");
    await harness.unmount();
  });

  test("restores the draft without a report when the chat cancels the send", async () => {
    const reportError = mock((_failure: ComposerFailure) => {});
    const send = deferredSend();
    const harness = await mountComposer({ onSend: send.onSend, reportError });
    let sending: Promise<void> = Promise.resolve();
    await harness.run((state) => {
      sending = state.submit("default");
    });
    await harness.run(async () => {
      send.settle(() => false);
      await sending;
    });

    expect(draftToSerializedText(harness.getLatest().draftState.draft)).toBe("Fix the build");
    expect(reportError).not.toHaveBeenCalled();
    await harness.unmount();
  });
});
