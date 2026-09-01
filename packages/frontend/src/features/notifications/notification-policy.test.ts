import { describe, expect, mock, test } from "bun:test";
import {
  createDefaultNotificationSettings,
  type NotificationOccurrence,
} from "@openducktor/contracts";
import { createNotificationPolicy } from "./notification-policy";

const occurrence: NotificationOccurrence = {
  occurrenceId: "agent.permission_requested:/repo:session-1:permission-1",
  kind: "agent.permission_requested",
  repoPath: "/repo",
  repositoryLabel: "Repo",
  task: { id: "task-1", title: "Build notifications" },
  role: "build",
  sessionLabel: "Builder session",
  status: "Permission Prompt is waiting for input.",
  navigationTarget: {
    type: "pending_input",
    repoPath: "/repo",
    taskId: "task-1",
    session: {
      runtimeKind: "opencode",
      workingDirectory: "/repo",
      externalSessionId: "session-1",
    },
    inputKind: "permission",
    requestId: "permission-1",
  },
};

const createHarness = (target: "in_app" | "os" | "both", enabled = true) => {
  const settings = createDefaultNotificationSettings();
  settings.kinds[occurrence.kind] = { enabled, target, sound: "inherit" };
  const inApp = mock(async () => {});
  const os = mock(async () => {});
  const sound = mock(async () => {});
  const onFailure = mock(() => {});
  const policy = createNotificationPolicy({
    loadSettings: async () => settings,
    inApp: { deliver: inApp },
    os: { deliver: os },
    sound: { play: sound },
    onFailure,
  });
  return { policy, inApp, os, sound, onFailure, settings };
};

describe("notification policy", () => {
  test.each([
    ["in_app", 1, 0],
    ["os", 0, 1],
    ["both", 1, 1],
  ] as const)("delivers %s without rerouting", async (target, inAppCalls, osCalls) => {
    const harness = createHarness(target);

    await harness.policy.dispatch(occurrence, {
      appFocused: false,
      externalDeliveryOwner: true,
    });

    expect(harness.inApp).toHaveBeenCalledTimes(inAppCalls);
    expect(harness.os).toHaveBeenCalledTimes(osCalls);
    expect(harness.sound).toHaveBeenCalledTimes(1);
  });

  test("delivers nothing when the kind is disabled", async () => {
    const harness = createHarness("both", false);

    await harness.policy.dispatch(occurrence, {
      appFocused: false,
      externalDeliveryOwner: true,
    });

    expect(harness.inApp).not.toHaveBeenCalled();
    expect(harness.os).not.toHaveBeenCalled();
    expect(harness.sound).not.toHaveBeenCalled();
  });

  test("suppresses OS and sound while focused but keeps in-app delivery", async () => {
    const harness = createHarness("both");

    await harness.policy.dispatch(occurrence, {
      appFocused: true,
      externalDeliveryOwner: true,
    });

    expect(harness.inApp).toHaveBeenCalledTimes(1);
    expect(harness.os).not.toHaveBeenCalled();
    expect(harness.sound).not.toHaveBeenCalled();
  });

  test("lets only the external owner deliver OS and sound", async () => {
    const harness = createHarness("both");

    await harness.policy.dispatch(occurrence, {
      appFocused: false,
      externalDeliveryOwner: false,
    });

    expect(harness.inApp).toHaveBeenCalledTimes(1);
    expect(harness.os).not.toHaveBeenCalled();
    expect(harness.sound).not.toHaveBeenCalled();
  });

  test("delivers local once and external once when leadership replays an occurrence", async () => {
    const harness = createHarness("both");

    await harness.policy.dispatch(occurrence, {
      appFocused: false,
      externalDeliveryOwner: false,
    });
    await harness.policy.dispatch(occurrence, {
      appFocused: false,
      externalDeliveryOwner: true,
    });

    expect(harness.inApp).toHaveBeenCalledTimes(1);
    expect(harness.os).toHaveBeenCalledTimes(1);
    expect(harness.sound).toHaveBeenCalledTimes(1);
  });

  test("uses the current focus state when leadership changes", async () => {
    const harness = createHarness("both");

    await harness.policy.dispatch(occurrence, {
      appFocused: false,
      externalDeliveryOwner: false,
    });
    await harness.policy.dispatch(occurrence, {
      appFocused: true,
      externalDeliveryOwner: true,
    });

    expect(harness.inApp).toHaveBeenCalledTimes(1);
    expect(harness.os).not.toHaveBeenCalled();
    expect(harness.sound).not.toHaveBeenCalled();
  });

  test("deduplicates each semantic occurrence", async () => {
    const harness = createHarness("both");
    const context = { appFocused: false, externalDeliveryOwner: true };

    await harness.policy.dispatch(occurrence, context);
    await harness.policy.dispatch(occurrence, context);

    expect(harness.inApp).toHaveBeenCalledTimes(1);
    expect(harness.os).toHaveBeenCalledTimes(1);
    expect(harness.sound).toHaveBeenCalledTimes(1);
  });

  test("keeps selected channels independent when OS fails", async () => {
    const harness = createHarness("both");
    harness.os.mockImplementation(async () => {
      throw new Error("native delivery failed");
    });

    await harness.policy.dispatch(occurrence, {
      appFocused: false,
      externalDeliveryOwner: true,
    });

    expect(harness.inApp).toHaveBeenCalledTimes(1);
    expect(harness.sound).toHaveBeenCalledTimes(1);
    expect(harness.onFailure).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "os", occurrenceId: occurrence.occurrenceId }),
    );
  });
});
