import { describe, expect, mock, test } from "bun:test";
import {
  createDefaultNotificationSettings,
  type NotificationOccurrence,
  type NotificationOsDeliveryRequest,
  type NotificationSettings,
} from "@openducktor/contracts";
import type { NotificationBridge } from "@/lib/shell-bridge";
import { createNotificationRuntime as createProductionNotificationRuntime } from "./notification-runtime";
import {
  createBridge,
  createDeliveryAdapters,
  createNotificationRuntime,
  workflowClosedOccurrence,
} from "./notification-runtime.test-support";

describe("notification publication and coordination", () => {
  test("shows the local start error once without putting it in the shared or OS payload", async () => {
    const detail =
      "Could not start: set the runtime executable path. Private endpoint: secret.local";
    const occurrence = {
      ...workflowClosedOccurrence("start-failed"),
      kind: "agent.session_error" as const,
    };
    let listener: Parameters<NotificationBridge["subscribeOccurrences"]>[0] = () => {};
    const published: NotificationOccurrence[] = [];
    const osRequests: NotificationOsDeliveryRequest[] = [];
    const deliverInApp = mock(
      async (_copy: { body: string }, _occurrence: NotificationOccurrence) => {},
    );
    const runtime = createNotificationRuntime({
      bridge: createBridge({
        subscribeOccurrences: (next) => {
          listener = next;
          return () => {};
        },
        publishOccurrence: async (value, settings) => {
          published.push(value);
          listener(value, settings);
          return { occurrence: value, settings };
        },
        showOsNotification: async (request) => {
          osRequests.push(request);
          return { status: "shown" };
        },
      }),
      selectSettings: async () => createDefaultNotificationSettings(),
      navigate: async () => {},
      onFailure: () => {},
      inApp: { dismiss: () => {}, deliver: deliverInApp },
    });
    const stop = runtime.subscribe();
    expect(await runtime.publishAndWait(occurrence, detail)).toBe(true);
    expect(deliverInApp).toHaveBeenCalledTimes(1);
    expect(deliverInApp.mock.calls[0]?.[0].body).toContain(detail);
    expect(JSON.stringify(published)).not.toContain("secret.local");
    expect(osRequests).toHaveLength(1);
    expect(JSON.stringify(osRequests)).not.toContain("secret.local");
    stop();
  });

  test.each(["permission", "question"] as const)(
    "publishes a long %s ID without changing the click target",
    async (inputKind) => {
      const requestId = "request-".repeat(300);
      const target = {
        type: "pending_input" as const,
        repoPath: "/repo",
        taskId: "task-1",
        session: {
          externalSessionId: "session",
          runtimeKind: "codex" as const,
          workingDirectory: "/repo",
        },
        inputKind,
        requestId,
      };
      const published: NotificationOccurrence[] = [];
      const requests: NotificationOsDeliveryRequest[] = [];
      const runtime = createNotificationRuntime({
        bridge: createBridge({
          publishOccurrence: async (occurrence, settings) => {
            published.push(occurrence);
            return { occurrence, settings };
          },
          showOsNotification: async (request) => {
            requests.push(request);
            return { status: "shown" };
          },
        }),
        selectSettings: async () => createDefaultNotificationSettings(),
        navigate: async () => {},
        onFailure: () => {},
      });
      expect(
        await runtime.publishAndWait({
          ...workflowClosedOccurrence(requestId),
          kind: inputKind === "permission" ? "agent.permission_requested" : "agent.question_asked",
          navigationTarget: target,
        }),
      ).toBe(true);
      expect(published[0]?.occurrenceId).toStartWith("sha256:");
      expect(published[0]?.navigationTarget).toEqual(target);
      expect(requests[0]?.navigationTarget).toEqual(target);
    },
  );

  test("bounds display text before publishing the occurrence", async () => {
    let resolvePublished = (_occurrence: NotificationOccurrence): void => {};
    const publishedOccurrence = new Promise<NotificationOccurrence>((resolve) => {
      resolvePublished = resolve;
    });
    const publishOccurrence = mock(
      async (published: NotificationOccurrence, settings: NotificationSettings) => {
        resolvePublished(published);
        return { occurrence: published, settings };
      },
    );
    const runtime = createNotificationRuntime({
      bridge: createBridge({ publishOccurrence }),
      selectSettings: async () => createDefaultNotificationSettings(),
      navigate: async () => {},
      onFailure: () => {},
    });

    runtime.publish({
      occurrenceId: "occurrence-long-copy",
      kind: "agent.session_idle",
      repoPath: "/repo",
      repositoryLabel: "r".repeat(140),
      task: { id: "task-1", title: "t".repeat(260) },
      sessionLabel: "s".repeat(140),
      status: "Agent Session is idle.",
      navigationTarget: {
        type: "agent_session",
        repoPath: "/repo",
        session: {
          externalSessionId: "session-1",
          runtimeKind: "codex",
          workingDirectory: "/repo/worktree",
        },
      },
    });

    const published = await publishedOccurrence;
    expect(published?.repositoryLabel).toHaveLength(120);
    expect(published?.task?.title).toHaveLength(240);
    expect(published?.sessionLabel).toHaveLength(120);
  });

  test("publishes the settings snapshot selected for the occurrence", async () => {
    const settings = createDefaultNotificationSettings();
    settings.kinds["workflow.closed"] = { enabled: true, target: "in_app", sound: "none" };
    let resolvePublished = (_settings: NotificationSettings | undefined): void => {};
    const published = new Promise<NotificationSettings | undefined>((resolve) => {
      resolvePublished = resolve;
    });
    const publishOccurrence = mock(
      async (occurrence: NotificationOccurrence, publishedSettings: NotificationSettings) => {
        resolvePublished(publishedSettings);
        return { occurrence, settings: publishedSettings };
      },
    );
    const delivery = createDeliveryAdapters();
    const runtime = createNotificationRuntime({
      bridge: createBridge({ publishOccurrence }),
      selectSettings: async () => settings,
      navigate: async () => {},
      onFailure: () => {},
      inApp: delivery.inApp,
      sound: delivery.sound,
    });

    runtime.publish(workflowClosedOccurrence("event-settings-snapshot"));

    expect(await published).toEqual(settings);
  });

  test("uses one settings snapshot when another tab receives the occurrence", async () => {
    let receiveOccurrence:
      | ((occurrence: NotificationOccurrence, settings: NotificationSettings) => void)
      | null = null;
    let resolveDelivery = (): void => {};
    const delivered = new Promise<void>((resolve) => {
      resolveDelivery = resolve;
    });
    const recipientInApp = mock(async () => resolveDelivery());
    const recipientLoadSettings = mock(async () => {
      const settings = createDefaultNotificationSettings();
      settings.kinds["workflow.closed"].enabled = false;
      return settings;
    });
    const recipient = createNotificationRuntime({
      bridge: createBridge({
        subscribeOccurrences(listener) {
          receiveOccurrence = listener;
          return () => {};
        },
      }),
      selectSettings: recipientLoadSettings,
      navigate: async () => {},
      onFailure: () => {},
      inApp: { dismiss: () => {}, deliver: recipientInApp },
      sound: { play: async () => {} },
    });
    recipient.subscribe();

    const publisherSettings = createDefaultNotificationSettings();
    publisherSettings.kinds["workflow.closed"] = {
      enabled: true,
      target: "in_app",
      sound: "none",
    };
    const publisherDelivery = createDeliveryAdapters();
    const publisher = createNotificationRuntime({
      bridge: createBridge({
        async publishOccurrence(occurrence, settings) {
          receiveOccurrence?.(occurrence, settings);
          return { occurrence, settings };
        },
      }),
      selectSettings: async () => publisherSettings,
      navigate: async () => {},
      onFailure: () => {},
      inApp: publisherDelivery.inApp,
      sound: publisherDelivery.sound,
    });

    publisher.publish(workflowClosedOccurrence("event-two-tabs"));
    await delivered;

    expect(recipientInApp).toHaveBeenCalledTimes(1);
    expect(recipientLoadSettings).not.toHaveBeenCalled();
  });

  test("keeps the host settings and reports a changed coordination selection", async () => {
    const settings = createDefaultNotificationSettings();
    settings.volumePercent = 0;
    settings.kinds["agent.session_started"] = {
      enabled: true,
      target: "both",
      sound: "none",
    };
    const changedSettings = structuredClone(settings);
    changedSettings.kinds["agent.session_started"].enabled = false;
    const occurrence = {
      ...workflowClosedOccurrence("host-settings"),
      kind: "agent.session_started" as const,
    };
    const publishAction = mock(async () => ({ occurrence, settings, preferenceRevision: 1 }));
    const publishOccurrence = mock(async (item: NotificationOccurrence) => ({
      occurrence: item,
      settings: changedSettings,
    }));
    const withExternalDeliveryOwnership = mock(async () => {});
    const showOsNotification = mock(async () => ({ status: "shown" as const }));
    const onFailure = mock(() => {});
    const delivery = createDeliveryAdapters();
    const runtime = createProductionNotificationRuntime({
      bridge: createBridge({
        publishOccurrence,
        withExternalDeliveryOwnership,
        showOsNotification,
      }),
      publishAction,
      subscribeStream: async () => () => {},
      navigate: async () => {},
      onFailure,
      onCoordinationRecovered: () => {},
      inApp: delivery.inApp,
      sound: delivery.sound,
    });

    expect(await runtime.publishAndWait(occurrence)).toBe(true);
    expect(publishAction).toHaveBeenCalledWith(occurrence);
    expect(publishOccurrence).toHaveBeenCalledWith(occurrence, settings);
    expect(delivery.deliverInApp).toHaveBeenCalledTimes(1);
    expect(onFailure).toHaveBeenCalledWith({
      channel: "coordination",
      kind: occurrence.kind,
      occurrenceId: occurrence.occurrenceId,
      repoPath: occurrence.repoPath,
      message: "Notification coordination changed the host selection. Reload to reconnect.",
    });
    expect(withExternalDeliveryOwnership).not.toHaveBeenCalled();
    expect(showOsNotification).not.toHaveBeenCalled();
    expect(delivery.playSound).not.toHaveBeenCalled();
  });

  test("does not send OS delivery when another browser tab owns external delivery", async () => {
    const showOsNotification = mock(async (_request: NotificationOsDeliveryRequest) => ({
      status: "shown" as const,
    }));
    const withExternalDeliveryOwnership = mock(
      async (_occurrenceId: string, dispatch: (owner: boolean) => Promise<void>) => dispatch(false),
    );
    const onFailure = mock(() => {});
    const runtime = createNotificationRuntime({
      bridge: createBridge({
        withExternalDeliveryOwnership,
        showOsNotification,
      }),
      selectSettings: async () => {
        const settings = createDefaultNotificationSettings();
        settings.volumePercent = 0;
        settings.kinds["workflow.closed"].target = "both";
        return settings;
      },
      navigate: async () => {},
      onFailure,
    });

    await runtime.publishAndWait({
      occurrenceId: "workflow.closed:/repo:task-1:event-1",
      kind: "workflow.closed",
      repoPath: "/repo",
      repositoryLabel: "Repo",
      task: { id: "task-1", title: "Build notifications" },
      status: "Task moved to Closed.",
      navigationTarget: { type: "kanban_task", repoPath: "/repo", taskId: "task-1" },
    });

    expect(showOsNotification).not.toHaveBeenCalled();
    expect(withExternalDeliveryOwnership).toHaveBeenCalledWith(
      "workflow.closed:/repo:task-1:event-1",
      expect.any(Function),
    );
    expect(onFailure).not.toHaveBeenCalled();
  });

  test("keeps the local toast when browser ownership fails", async () => {
    const delivery = createDeliveryAdapters();
    const showOsNotification = mock(async (_request: NotificationOsDeliveryRequest) => ({
      status: "shown" as const,
    }));
    const onFailure = mock(() => {});
    const runtime = createNotificationRuntime({
      bridge: createBridge({
        withExternalDeliveryOwnership: async () => {
          throw new Error("Claim propagation failed.");
        },
        showOsNotification,
      }),
      selectSettings: async () => {
        const settings = createDefaultNotificationSettings();
        settings.volumePercent = 0;
        settings.kinds["workflow.closed"].target = "both";
        return settings;
      },
      navigate: async () => {},
      onFailure,
      inApp: delivery.inApp,
      sound: delivery.sound,
    });

    await runtime.publishAndWait(workflowClosedOccurrence("event-claim-failure"));

    expect(delivery.deliverInApp).toHaveBeenCalledTimes(1);
    expect(showOsNotification).not.toHaveBeenCalled();
    expect(onFailure).toHaveBeenCalledWith({
      channel: "coordination",
      kind: "workflow.closed",
      occurrenceId: "workflow.closed:/repo:task-1:event-claim-failure",
      repoPath: "/repo",
      message: "Claim propagation failed.",
    });
  });

  test("reports recovery after a later healthy coordination cycle", async () => {
    let attempt = 0;
    const onCoordinationRecovered = mock(() => {});
    const runtime = createNotificationRuntime({
      bridge: createBridge({
        withExternalDeliveryOwnership: async (_occurrenceId, dispatch) => {
          attempt += 1;
          if (attempt === 1) {
            throw new Error("Claim propagation failed.");
          }
          await dispatch(true);
        },
      }),
      selectSettings: async () => createDefaultNotificationSettings(),
      navigate: async () => {},
      onFailure: () => {},
      onCoordinationRecovered,
    });
    const occurrence = workflowClosedOccurrence("event-coordination-recovery");

    await runtime.publishAndWait(occurrence);
    expect(onCoordinationRecovered).not.toHaveBeenCalled();
    await runtime.publishAndWait(occurrence);

    expect(onCoordinationRecovered).toHaveBeenCalledTimes(1);
  });

  test("reports publication recovery after a later non-owner publication succeeds", async () => {
    let publishAttempt = 0;
    let resolveFailure = (): void => {};
    const failed = new Promise<void>((resolve) => {
      resolveFailure = resolve;
    });
    let resolveDelivery = (): void => {};
    const delivered = new Promise<void>((resolve) => {
      resolveDelivery = resolve;
    });
    const onCoordinationRecovered = mock(() => {});
    const onFailure = mock(() => resolveFailure());
    const runtime = createNotificationRuntime({
      bridge: createBridge({
        async publishOccurrence(publishedOccurrence, publishedSettings) {
          publishAttempt += 1;
          if (publishAttempt === 1) {
            throw new Error("Occurrence publication failed.");
          }
          return { occurrence: publishedOccurrence, settings: publishedSettings };
        },
        withExternalDeliveryOwnership: async (_occurrenceId, dispatch) => dispatch(false),
      }),
      selectSettings: async () => createDefaultNotificationSettings(),
      navigate: async () => {},
      onFailure,
      onCoordinationRecovered,
      inApp: { dismiss: () => {}, deliver: async () => resolveDelivery() },
      sound: { play: async () => {} },
    });

    runtime.publish(workflowClosedOccurrence("event-publication-failure"));
    await failed;
    expect(onFailure).toHaveBeenCalledWith({
      channel: "coordination",
      kind: "workflow.closed",
      occurrenceId: "workflow.closed:/repo:task-1:event-publication-failure",
      repoPath: "/repo",
      message: "Occurrence publication failed.",
    });
    await runtime.publishAndWait(workflowClosedOccurrence("event-publication-recovery"));
    await delivered;

    expect(onCoordinationRecovered).toHaveBeenCalledTimes(1);
  });

  test("uses current focus when a later dispatch owns external delivery", async () => {
    const delivery = createDeliveryAdapters();
    const owners = [false, true];
    const showOsNotification = mock(async (_request: NotificationOsDeliveryRequest) => ({
      status: "shown" as const,
    }));
    const runtime = createNotificationRuntime({
      bridge: createBridge({
        isAppFocused: async () => true,
        withExternalDeliveryOwnership: async (_occurrenceId, dispatch) =>
          dispatch(owners.shift() ?? false),
        showOsNotification,
      }),
      selectSettings: async () => {
        const settings = createDefaultNotificationSettings();
        settings.volumePercent = 0;
        settings.kinds["workflow.closed"].target = "both";
        return settings;
      },
      navigate: async () => {},
      onFailure: () => {},
      inApp: delivery.inApp,
      sound: delivery.sound,
    });

    const occurrence = workflowClosedOccurrence("event-owner-handoff");
    await runtime.publishAndWait(occurrence);
    await runtime.publishAndWait(occurrence);

    expect(delivery.deliverInApp).toHaveBeenCalledTimes(1);
    expect(showOsNotification).not.toHaveBeenCalled();
  });

  test("does not coordinate an occurrence again after external delivery is complete", async () => {
    const delivery = createDeliveryAdapters();
    const isAppFocused = mock(async () => false);
    const withExternalDeliveryOwnership = mock(
      async (_occurrenceId: string, dispatch: (owner: boolean) => Promise<void>) => dispatch(true),
    );
    const onFailure = mock(() => {});
    const runtime = createNotificationRuntime({
      bridge: createBridge({ isAppFocused, withExternalDeliveryOwnership }),
      selectSettings: async () => createDefaultNotificationSettings(),
      navigate: async () => {},
      onFailure,
      inApp: delivery.inApp,
      sound: delivery.sound,
    });
    const occurrence = workflowClosedOccurrence("event-complete");

    await runtime.publishAndWait(occurrence);
    isAppFocused.mockImplementation(async () => {
      throw new Error("Late focus failure.");
    });
    await runtime.publishAndWait(occurrence);

    expect(withExternalDeliveryOwnership).toHaveBeenCalledTimes(1);
    expect(isAppFocused).toHaveBeenCalledTimes(1);
    expect(onFailure).not.toHaveBeenCalled();
  });

  test("publishes valid long source identities with bounded deterministic occurrence IDs", async () => {
    const longPath = `/repo/${"nested/".repeat(200)}`;
    const published: NotificationOccurrence[] = [];
    const onFailure = mock(() => {});
    const runtime = createNotificationRuntime({
      bridge: createBridge({
        publishOccurrence: async (item, settings) => {
          published.push(item);
          return { occurrence: item, settings };
        },
      }),
      selectSettings: async () => createDefaultNotificationSettings(),
      navigate: async () => {},
      onFailure,
    });
    const item: NotificationOccurrence = {
      occurrenceId: `workflow.closed:${longPath}:task-1:event-1`,
      kind: "workflow.closed",
      repoPath: longPath,
      repositoryLabel: "Repo",
      status: "Closed",
      navigationTarget: { type: "kanban_task", repoPath: longPath, taskId: "task-1" },
    };
    await runtime.publishAndWait(item);
    await runtime.publishAndWait(item);
    expect(onFailure).not.toHaveBeenCalled();
    expect(published).toHaveLength(1);
    expect(published[0]?.occurrenceId.length).toBeLessThan(1024);
    expect(published[0]?.repoPath).toBe(longPath);
  });

  test("reports malformed fire-and-forget publications without an unhandled rejection", async () => {
    const onFailure = mock(() => {});
    const runtime = createNotificationRuntime({
      bridge: createBridge(),
      selectSettings: async () => createDefaultNotificationSettings(),
      navigate: async () => {},
      onFailure,
    });
    const item: NotificationOccurrence = {
      occurrenceId: "invalid-occurrence",
      kind: "workflow.closed",
      repoPath: "",
      repositoryLabel: "Repo",
      status: "Closed",
      navigationTarget: { type: "kanban_task", repoPath: "/repo", taskId: "task-1" },
    };
    expect(await runtime.publishAndWait(item)).toBe(false);
    expect(onFailure).toHaveBeenCalledTimes(1);
  });
});
