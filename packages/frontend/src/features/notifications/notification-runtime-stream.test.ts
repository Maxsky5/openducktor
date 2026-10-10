import { expect, mock, test } from "bun:test";
import { waitFor } from "@testing-library/react";
import {
  createDefaultNotificationSettings,
  type NotificationHealth,
  type NotificationStreamFrame,
  type SelectedNotification,
} from "@openducktor/contracts";
import { createNotificationRuntime } from "./notification-runtime";
import {
  createBridge,
  createDeliveryAdapters,
  workflowClosedOccurrence,
} from "./notification-runtime.test-support";

const epoch = "11111111-1111-4111-8111-111111111111";

test("delivers host selections once and drops frames at or before the current cursor", async () => {
  const h = harness();
  const stop = h.runtime.subscribe();
  h.finishAttachment();
  await h.attachment;
  try {
    h.emit({ type: "attached", reason: "new", cursor: { epoch, sequence: 4 }, health: [] });
    h.emit(h.occurrence("baseline", 4));
    h.emit(h.occurrence("first", 5));
    h.emit(h.occurrence("duplicate-cursor", 5));
    h.emit(h.occurrence("older", 3));
    h.emit(h.occurrence("next", 6));
    await waitFor(() => expect(h.delivery.playSound).toHaveBeenCalledTimes(2), { timeout: 500 });

    expect(h.delivery.deliverInApp).toHaveBeenCalledTimes(2);
    expect(h.delivery.deliverInApp).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      workflowClosedOccurrence("first"),
    );
    expect(h.delivery.deliverInApp).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      workflowClosedOccurrence("next"),
    );
    expect(h.publishOccurrence).toHaveBeenCalledTimes(2);
    expect(h.publishOccurrence).toHaveBeenCalledWith(workflowClosedOccurrence("first"), h.settings);
    expect(h.delivery.playSound).toHaveBeenNthCalledWith(1, "chime", 17);
    expect(h.showOsNotification).toHaveBeenCalledTimes(2);
    expect(h.publishAction).not.toHaveBeenCalled();
    expect(h.onFailure).not.toHaveBeenCalled();
  } finally {
    stop();
  }
});

test.each(["gap", "epoch_changed"] as const)(
  "reports %s and workspace health while live delivery continues",
  async (reason) => {
    const h = harness();
    const stop = h.runtime.subscribe();
    h.finishAttachment();
    await h.attachment;
    const health: NotificationHealth = {
      scope: "/repo",
      source: "session",
      message: "Runtime observation failed. Restart the host.",
    };
    try {
      h.emit({ type: "attached", reason, cursor: { epoch, sequence: 10 }, health: [health] });
      h.emit({
        type: "health",
        cursor: { epoch, sequence: 11 },
        health: { ...health, message: null },
      });
      h.emit(h.occurrence("after-reconnect", 12));
      await waitFor(() => expect(h.delivery.playSound).toHaveBeenCalledTimes(1), { timeout: 500 });

      expect(h.onFailure).toHaveBeenCalledTimes(1);
      expect(h.onFailure).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: "coordination",
          message:
            "Notification replay is unavailable. Earlier alerts were not restored. Live notification delivery continues.",
        }),
      );
      expect(h.onObservationHealth.mock.calls).toEqual([[health], [{ ...health, message: null }]]);
      expect(h.delivery.deliverInApp).toHaveBeenCalledTimes(1);
      expect(h.publishAction).not.toHaveBeenCalled();
      expect(h.onCoordinationRecovered).not.toHaveBeenCalled();
    } finally {
      stop();
    }
  },
);

test.each(["new", "replay"] as const)(
  "clears a stream failure on %s attachment without another notification",
  async (reason) => {
    const h = harness();
    const stop = h.runtime.subscribe();
    h.finishAttachment();
    await h.attachment;
    try {
      h.fail(new Error("Connection lost."));
      h.emit({ type: "attached", reason, cursor: { epoch, sequence: 0 }, health: [] });
      h.emit({ type: "attached", reason, cursor: { epoch, sequence: 0 }, health: [] });

      expect(h.onFailure).toHaveBeenCalledTimes(1);
      expect(h.onCoordinationRecovered).toHaveBeenCalledTimes(1);
      expect(h.delivery.deliverInApp).not.toHaveBeenCalled();
    } finally {
      stop();
    }
  },
);

test("a session error that another view shows skips or closes its in-app toast", async () => {
  const h = harness();
  const stop = h.runtime.subscribe();
  h.finishAttachment();
  await h.attachment;
  const sessionError = (errorId: string, sequence: number): NotificationStreamFrame => ({
    type: "occurrence",
    cursor: { epoch, sequence },
    selected: {
      occurrence: {
        occurrenceId: `agent.session_error:session-1:${errorId}`,
        kind: "agent.session_error",
        repoPath: "/repo",
        repositoryLabel: "Repo",
        status: "The session launch failed.",
        navigationTarget: {
          type: "session_error",
          repoPath: "/repo",
          session: {
            externalSessionId: "session-1",
            runtimeKind: "codex",
            workingDirectory: "/repo",
          },
          errorId,
        },
      },
      settings: h.settings,
      preferenceRevision: 1,
    },
  });
  try {
    h.emit({ type: "attached", reason: "new", cursor: { epoch, sequence: 1 }, health: [] });
    // The other view shows the error first, so the host notification has no in-app toast.
    h.runtime.markInAppFeedbackHandled("early");
    h.emit(sessionError("early", 2));
    await waitFor(() => expect(h.showOsNotification).toHaveBeenCalledTimes(1), { timeout: 500 });
    expect(h.delivery.deliverInApp).not.toHaveBeenCalled();

    // The host toast shows first, so the mark closes it.
    h.emit(sessionError("late", 3));
    await waitFor(() => expect(h.delivery.deliverInApp).toHaveBeenCalledTimes(1), {
      timeout: 500,
    });
    h.runtime.markInAppFeedbackHandled("late");
    await waitFor(
      () =>
        expect(h.delivery.dismissInApp).toHaveBeenCalledWith("agent.session_error:session-1:late"),
      { timeout: 500 },
    );
  } finally {
    stop();
  }
});

test("recovers stream and publication failures only when both paths are healthy", async () => {
  const h = harness();
  const stop = h.runtime.subscribe();
  h.finishAttachment();
  await h.attachment;
  try {
    h.fail(new Error("Connection lost."));
    await h.runtime.publishAndWait(workflowClosedOccurrence("while-disconnected"));
    expect(h.onCoordinationRecovered).not.toHaveBeenCalled();

    h.publishAction.mockRejectedValueOnce(new Error("Publication failed."));
    await h.runtime.publishAndWait(workflowClosedOccurrence("failed-publication"));
    h.emit({ type: "attached", reason: "replay", cursor: { epoch, sequence: 0 }, health: [] });
    expect(h.onCoordinationRecovered).not.toHaveBeenCalled();

    await h.runtime.publishAndWait(workflowClosedOccurrence("healthy-publication"));
    expect(h.onFailure).toHaveBeenCalledTimes(2);
    expect(h.onCoordinationRecovered).toHaveBeenCalledTimes(1);
  } finally {
    stop();
  }
});

test.each(["new", "replay", "epoch_changed"] as const)(
  "clears only absent health errors on %s attachment",
  async (reason) => {
    const h = harness();
    let stop = h.runtime.subscribe();
    h.finishAttachment();
    await h.attachment;
    const session: NotificationHealth = {
      scope: "/repo",
      source: "session",
      message: "Session observation failed.",
    };
    const other: NotificationHealth = { ...session, scope: "/other" };
    const task: NotificationHealth = { ...session, source: "task", message: "Task read failed." };
    const current: NotificationHealth = {
      ...session,
      message: "Session observation still failed.",
    };
    const clear = (health: NotificationHealth): NotificationHealth => ({
      ...health,
      message: null,
    });
    try {
      h.emit({
        type: "attached",
        reason: "new",
        cursor: { epoch, sequence: 0 },
        health: [session, other],
      });
      h.emit({ type: "health", cursor: { epoch, sequence: 1 }, health: task });
      h.emit({ type: "health", cursor: { epoch, sequence: 2 }, health: clear(other) });
      if (reason === "new") {
        stop();
        stop = h.runtime.subscribe();
      }
      const cursor = {
        epoch: reason === "epoch_changed" ? "22222222-2222-4222-8222-222222222222" : epoch,
        sequence: 3,
      };
      h.emit({ type: "attached", reason, cursor, health: reason === "replay" ? [current] : [] });
      const expected = [
        session,
        other,
        task,
        clear(other),
        ...(reason === "replay" ? [clear(task), current] : [clear(session), clear(task)]),
      ];
      const reported = h.onObservationHealth.mock.calls.map(([health]) => health);
      expect(reported).toHaveLength(expected.length);
      expect(reported).toEqual(expect.arrayContaining(expected));

      if (reason === "replay")
        h.emit({ type: "health", cursor: { ...cursor, sequence: 4 }, health: clear(current) });
      const count = h.onObservationHealth.mock.calls.length;
      h.emit({
        type: "attached",
        reason: "replay",
        cursor: { ...cursor, sequence: 4 },
        health: [],
      });
      expect(h.onObservationHealth).toHaveBeenCalledTimes(count);
    } finally {
      stop();
    }
  },
);

test.each(["before", "after"] as const)(
  "stops a stream whose attachment finishes %s disposal and ignores later frames",
  async (when) => {
    const h = harness();
    const stop = h.runtime.subscribe();
    if (when === "before") {
      h.finishAttachment();
      await h.attachment;
    }
    stop();
    if (when === "after") {
      h.finishAttachment();
      await h.attachment;
    }
    await waitFor(() => expect(h.stopStream).toHaveBeenCalledTimes(1), { timeout: 500 });
    h.emit(h.occurrence("after-disposal", 1));
    h.emit({
      type: "health",
      cursor: { epoch, sequence: 2 },
      health: { scope: "/repo", source: "session", message: "Late failure" },
    });

    expect(h.stopOccurrences).toHaveBeenCalledTimes(1);
    expect(h.stopClicks).toHaveBeenCalledTimes(1);
    expect(h.delivery.deliverInApp).not.toHaveBeenCalled();
    expect(h.publishOccurrence).not.toHaveBeenCalled();
    expect(h.onObservationHealth).not.toHaveBeenCalled();
    expect(h.onFailure).not.toHaveBeenCalled();
  },
);

test.each(["attachment", "live"] as const)(
  "reports a failed %s stream to the user",
  async (phase) => {
    const h = harness();
    const stop = h.runtime.subscribe();
    const failure = new Error("Notification stream disconnected. Reload to reconnect.");
    try {
      if (phase === "attachment") h.rejectAttachment(failure);
      else {
        h.finishAttachment();
        await h.attachment;
        h.fail(failure);
      }
      await waitFor(() => expect(h.onFailure).toHaveBeenCalledTimes(1), { timeout: 500 });
      expect(h.onFailure).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: "coordination",
          message: failure.message,
        }),
      );
      expect(h.delivery.deliverInApp).not.toHaveBeenCalled();
    } finally {
      stop();
    }
  },
);

const harness = () => {
  const settings = createDefaultNotificationSettings();
  settings.volumePercent = 17;
  settings.osFocus = "always_send";
  settings.soundFocus = "always_play";
  settings.kinds["workflow.closed"] = { enabled: true, target: "both", sound: "chime" };
  const delivery = createDeliveryAdapters();
  const stopStream = mock(() => {});
  const stopOccurrences = mock(() => {});
  const stopClicks = mock(() => {});
  const onFailure = mock(() => {});
  const onCoordinationRecovered = mock(() => {});
  const onObservationHealth = mock((_health: NotificationHealth) => {});
  const publishAction = mock(async (occurrence: SelectedNotification["occurrence"]) => ({
    occurrence,
    settings,
    preferenceRevision: 1,
  }));
  const publishOccurrence = mock(
    async (
      occurrence: SelectedNotification["occurrence"],
      selected: SelectedNotification["settings"],
    ) => ({ occurrence, settings: selected }),
  );
  const showOsNotification = mock(async () => ({ status: "shown" as const }));
  let receive: ((frame: NotificationStreamFrame) => void) | null = null;
  let failure: ((cause: unknown) => void) | null = null;
  let resolveAttachment = (_stop: () => void) => {};
  let rejectAttachment = (_cause: Error) => {};
  const attachment = new Promise<() => void>((resolve, reject) => {
    resolveAttachment = resolve;
    rejectAttachment = reject;
  });
  const runtime = createNotificationRuntime({
    bridge: createBridge({
      publishOccurrence,
      showOsNotification,
      subscribeOccurrences: () => stopOccurrences,
      subscribeClicks: () => stopClicks,
    }),
    publishAction,
    subscribeStream: (_input, onFrame, onFailure) => {
      receive = onFrame;
      failure = onFailure;
      return attachment;
    },
    navigate: async () => {},
    onFailure,
    onObservationHealth,
    onCoordinationRecovered,
    inApp: delivery.inApp,
    sound: delivery.sound,
  });
  return {
    runtime,
    settings,
    delivery,
    publishAction,
    publishOccurrence,
    showOsNotification,
    stopStream,
    stopOccurrences,
    stopClicks,
    onFailure,
    onCoordinationRecovered,
    onObservationHealth,
    attachment,
    finishAttachment: () => resolveAttachment(stopStream),
    rejectAttachment,
    emit(frame: NotificationStreamFrame) {
      if (!receive) throw new Error("Subscribe before sending a notification frame.");
      receive(frame);
    },
    fail(cause: unknown) {
      if (!failure) throw new Error("Subscribe before reporting a notification failure.");
      failure(cause);
    },
    occurrence(id: string, sequence: number): NotificationStreamFrame {
      return {
        type: "occurrence",
        cursor: { epoch, sequence },
        selected: { occurrence: workflowClosedOccurrence(id), settings, preferenceRevision: 1 },
      };
    },
  };
};
