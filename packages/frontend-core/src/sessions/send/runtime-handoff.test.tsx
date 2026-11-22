import "../../test-support/dom-environment";
import { expect, mock, test } from "bun:test";
import type { HandoffLink } from "@openducktor/contracts";
import { act, renderHook } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import type { HostClient } from "@openducktor/host-client";
import { HostChannelRequestError, hostChannelInvokeError } from "@openducktor/host-client/channel";
import { RemoteRefusalError } from "@openducktor/host-client/remote";
import { ClientConnectionProvider } from "../../connection/client-connection-react";
import { createTestClientConnection } from "../../test-support/test-client-connection";
import {
  acceptedLink,
  attach,
  chat,
  destination,
  missing,
  outcome,
  parts,
  source,
  target,
} from "../../test-support/runtime-handoff-fixture";
import {
  createTextSegment,
  draftHasMeaningfulContent,
} from "../../drafts/agent-chat-composer-draft";
import { createAppVisibilityFake } from "../../test-support/app-visibility-fake";
import { createAgentSessionsStore } from "../agent-sessions-store";
import { AgentSessionsContext } from "../session-contexts";
import { sendWithPendingItems, type PendingSendSource } from "../composer/agent-chat-pending-send";
import { createWorkspaceSessionChatDraftPersistence } from "../composer/workspace-session-chat-draft";
import { useAgentChatComposerDraftState } from "../composer/use-agent-chat-composer-draft-state";
import { useAgentChatComposerSubmit } from "../composer/use-agent-chat-composer-submit";
import { subscribeHandoffCommit, useHandoffSelection, useRuntimeHandoff } from "./runtime-handoff";

const model = {
  ...destination,
  id: "gpt-5.5",
  providerName: "OpenAI",
  modelName: "GPT-5.5",
  variants: [],
};

const setup = (client: Pick<HostClient, "agentChatHandoffSend" | "agentChatHandoffCheck">) => {
  const connection = createTestClientConnection({ client });
  const sessions = createAgentSessionsStore(chat.repoPath);
  attach(sessions, "host-one");
  const wrapper = ({ children }: PropsWithChildren) => (
    <ClientConnectionProvider connection={connection}>
      <AgentSessionsContext value={sessions}>{children}</AgentSessionsContext>
    </ClientConnectionProvider>
  );
  const mount = (identity: typeof source | typeof target = source) =>
    renderHook(
      () => ({
        delivery: useRuntimeHandoff(chat, identity),
        selection: useHandoffSelection(chat.repoPath, identity),
      }),
      { wrapper },
    );
  const initial = mount();
  act(() => {
    initial.result.current.selection.choose(destination, model);
  });
  return { connection, initial, mount, sessions, wrapper };
};

test.each(["local", "remote"] as const)(
  "a %s channel refusal keeps the draft editable and offers the host's next action",
  async (kind) => {
    const failure = {
      code: "remote_disabled",
      message: "Remote control is off.",
      nextAction: "Enable remote control and retry.",
    } as const;
    const refused =
      kind === "local"
        ? hostChannelInvokeError(new HostChannelRequestError({ kind: "refused", failure }))
        : new RemoteRefusalError(failure);
    const send = mock<HostClient["agentChatHandoffSend"]>(async () => {
      throw refused;
    });
    const check = mock<HostClient["agentChatHandoffCheck"]>(async ({ submissionId }) => {
      throw missing(submissionId);
    });
    const { initial, sessions } = setup({
      agentChatHandoffSend: send,
      agentChatHandoffCheck: check,
    });
    const sent = await act(() => initial.result.current.delivery.send([...parts]));
    act(() => attach(sessions, "host-one"));
    expect(sent).toBe(false);
    expect(initial.result.current.delivery.blocked).toBe(false);
    expect(initial.result.current.delivery.notice).toMatchObject({
      check: null,
      details: "Remote control is off. Enable remote control and retry.",
    });
    act(() => initial.result.current.delivery.notice?.cancel?.());
    expect(initial.result.current.delivery.notice).toBeNull();
    expect(check).not.toHaveBeenCalled();
  },
);

test.each(["uncertain", "lost reply", "accepted"] as const)(
  "keeps Check tied to the admitted submission after %s",
  async (firstResult) => {
    const send = mock<HostClient["agentChatHandoffSend"]>(async ({ submissionId }) => {
      if (firstResult === "lost reply") throw new Error("Connection closed");
      return outcome(submissionId, firstResult);
    });
    const check = mock<HostClient["agentChatHandoffCheck"]>(async ({ submissionId }) =>
      outcome(submissionId, "committed"),
    );
    const { initial } = setup({ agentChatHandoffSend: send, agentChatHandoffCheck: check });
    const pending = await act(() => initial.result.current.delivery.send([...parts]));
    if (pending === true || pending === false) throw new Error("Expected an unsettled handoff");
    expect(initial.result.current.delivery.blocked).toBe(true);
    expect(initial.result.current.delivery.acceptedLink).toEqual(
      firstResult === "accepted" ? acceptedLink : undefined,
    );
    act(() => {
      initial.result.current.selection.clear();
    });
    expect(initial.result.current.delivery.selection?.model).toEqual(destination);
    await act(() => initial.result.current.delivery.send([...parts]));
    expect(send).toHaveBeenCalledTimes(1);
    await act(async () => {
      await initial.result.current.delivery.notice?.check?.();
    });
    expect(check).toHaveBeenCalledWith(
      {
        chat,
        submissionId: send.mock.calls[0]![0].submissionId,
      },
      { expectedHostEpoch: "host-one" },
    );
    expect(await pending.settled).toBe(true);
    act(() => initial.result.current.delivery.releaseLocalDraft());
    expect(initial.result.current.delivery.blocked).toBe(false);
    expect(initial.result.current.delivery.committedLink).toEqual(acceptedLink);
  },
);

test("drops a checked staged destination from an observing client only on host replacement", async () => {
  const send = mock<HostClient["agentChatHandoffSend"]>(async ({ submissionId }) =>
    outcome(submissionId, "committed"),
  );
  const { initial, sessions } = setup({
    agentChatHandoffSend: send,
    agentChatHandoffCheck: async ({ submissionId }) => outcome(submissionId, "accepted"),
  });
  act(() => {
    initial.result.current.selection.clear();
    attach(sessions, "host-one", [outcome("other-client", "accepted")]);
  });
  await act(async () => {
    await initial.result.current.delivery.notice?.check?.();
  });
  act(() => attach(sessions, "host-one"));
  expect(initial.result.current.delivery.acceptedLink).toEqual(acceptedLink);
  act(() => attach(sessions, "host-two"));
  expect(initial.result.current.delivery.acceptedLink).toBeUndefined();
  expect(initial.result.current.delivery.blocked).toBe(false);
  expect(send).not.toHaveBeenCalled();
});

test("opening a source does not follow its already committed link from the initial snapshot", () => {
  const { connection, sessions } = setup({
    agentChatHandoffSend: async ({ submissionId }) => outcome(submissionId, "committed"),
    agentChatHandoffCheck: async ({ submissionId }) => outcome(submissionId, "committed"),
  });
  const follow = mock((_link: HandoffLink) => {});
  const stop = subscribeHandoffCommit(connection, sessions, chat.repoPath, source, follow);
  try {
    act(() => {
      sessions.applyLiveSessionEnvelope({
        type: "snapshot",
        isConnectionSnapshot: true,
        repoPath: chat.repoPath,
        sessions: [],
        messageQueues: [],
        sessionOperations: [outcome("existing-commit", "committed")],
      });
      sessions.setSessionCollection((current) => current);
    });
    expect(follow).not.toHaveBeenCalled();
  } finally {
    stop();
  }
});

test("follows a live destination after remount and settles on Check without another send", async () => {
  const send = mock<HostClient["agentChatHandoffSend"]>(async ({ submissionId }) =>
    outcome(submissionId, "uncertain"),
  );
  const { initial, mount, sessions } = setup({
    agentChatHandoffSend: send,
    agentChatHandoffCheck: async ({ submissionId }) => outcome(submissionId, "committed"),
  });
  const pending = await act(() => initial.result.current.delivery.send([...parts]));
  if (pending === true || pending === false) throw new Error("Expected an unsettled handoff");
  initial.unmount();
  const { submissionId } = send.mock.calls[0]![0];
  act(() =>
    sessions.applyLiveSessionEnvelope({
      type: "session_operation_updated",
      observation: outcome(submissionId, "accepted"),
    }),
  );
  const moved = mount(target);
  expect(moved.result.current.delivery.acceptedLink).toEqual(acceptedLink);
  expect(moved.result.current.delivery.blocked).toBe(true);
  await act(async () => {
    await moved.result.current.delivery.notice?.check?.();
  });
  expect(await pending.settled).toBe(true);
  expect(send).toHaveBeenCalledTimes(1);
});

test.each([false, true])(
  "late Check settles only the sent draft and pending items after remount, edited: %s",
  async (edited) => {
    const { connection, wrapper } = setup({
      agentChatHandoffSend: async ({ submissionId }) => outcome(submissionId, "uncertain"),
      agentChatHandoffCheck: async ({ submissionId }) => outcome(submissionId, "committed"),
    });
    const persistence = createWorkspaceSessionChatDraftPersistence(
      connection.drafts.chat,
      chat.workspaceId,
      chat.sessionId,
    );
    const scope = { key: persistence.targetKey, persistence };
    const visibility = createAppVisibilityFake();
    const complete = mock((_id: string) => {});
    const restore = mock((_id: string) => {});
    const items: PendingSendSource = {
      itemName: "comment",
      lock: (message) => ({ message, submissionId: "comment-revision-1" }),
      complete,
      restore,
    };
    const mountComposer = () =>
      renderHook(
        () => {
          const delivery = useRuntimeHandoff(chat, source);
          const draftState = useAgentChatComposerDraftState({ scope, visibility });
          const submit = useAgentChatComposerSubmit({
            model: {
              isSessionWorking: false,
              onSend: (draft, mode) =>
                sendWithPendingItems(
                  draft,
                  mode,
                  () => delivery.send([...parts]),
                  items,
                  connection.feedback,
                ),
              draftScope: scope,
              steerBlockedReason: null,
              runningTurnModel: null,
              handoff: delivery,
            },
            draftState,
            draftRef: { current: draftState.draft },
            defaultSendDisabled: delivery.blocked,
            sendInputBlocked: delivery.blocked,
            settingsReady: true,
            reportError: (failure) => {
              throw new Error(failure.message);
            },
            onDraftReplaced: () => {},
            onSettledInScope: () => {},
          });
          return { delivery, draftState, submit };
        },
        { wrapper },
      );
    const submitted = { segments: [createTextSegment("Original draft")] };
    const newer = { segments: [createTextSegment("New draft")] };
    const first = mountComposer();
    act(() => first.result.current.draftState.commitDraft(submitted));
    await act(() => first.result.current.submit("default"));
    expect(complete).not.toHaveBeenCalled();
    expect(restore).not.toHaveBeenCalled();
    first.unmount();
    const reopened = mountComposer();
    expect(reopened.result.current.draftState.draft.segments).toEqual(submitted.segments);
    if (edited) act(() => reopened.result.current.draftState.commitDraft(newer));
    await act(async () => {
      await reopened.result.current.delivery.notice?.check?.();
    });
    expect(complete).toHaveBeenCalledWith("comment-revision-1");
    expect(restore).not.toHaveBeenCalled();
    if (edited) expect(reopened.result.current.draftState.draft.segments).toEqual(newer.segments);
    else expect(draftHasMeaningfulContent(reopened.result.current.draftState.draft)).toBe(false);
  },
);
