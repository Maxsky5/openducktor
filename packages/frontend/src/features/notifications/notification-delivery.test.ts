import { describe, expect, mock, test } from "bun:test";
import type { NotificationOccurrence } from "@openducktor/contracts";
import {
  createCuelumeNotificationSoundAdapter,
  createSonnerNotificationAdapter,
  type GestureTarget,
  installCuelumeGestureUnlock,
} from "./notification-delivery";

const occurrence: NotificationOccurrence = {
  occurrenceId: "agent.session_started:/repo:session-1",
  kind: "agent.session_started",
  repoPath: "/repo",
  repositoryLabel: "Repo",
  task: { id: "task-1", title: "Build notifications" },
  status: "Agent Session started.",
  navigationTarget: {
    type: "agent_session",
    repoPath: "/repo",
    taskId: "task-1",
    session: {
      externalSessionId: "session-1",
      runtimeKind: "codex",
      workingDirectory: "/repo/worktree",
    },
  },
};

describe("notification delivery adapters", () => {
  test("shows one actionable 10-second Sonner toast", async () => {
    const showToast = mock(
      (
        _title: string,
        _options: {
          description: string;
          duration: number;
          action: { label: string; onClick(): void };
        },
      ) => "toast-id",
    );
    const navigate = mock(async () => {});
    const adapter = createSonnerNotificationAdapter({ showToast, navigate });

    await adapter.deliver(
      { title: "Agent Session Started - task-1", body: "Repo - Build notifications" },
      occurrence,
    );

    expect(showToast).toHaveBeenCalledTimes(1);
    const options = showToast.mock.calls[0]?.[1];
    expect(options).toMatchObject({ duration: 10000, description: "Repo - Build notifications" });
    options?.action?.onClick();
    expect(navigate).toHaveBeenCalledWith(occurrence.navigationTarget);
  });

  test("plays Cuelume through its imperative API with a normalized volume", async () => {
    const play = mock((_sound?: string, _options?: { volume?: number }) => {});
    const adapter = createCuelumeNotificationSoundAdapter(play);

    await adapter.play("arrival", 65);

    expect(play).toHaveBeenCalledWith("arrival", { volume: 0.65 });
  });

  test("unlocks Cuelume once from the first pointer or keyboard gesture", () => {
    const play = mock((_sound?: string, _options?: { volume?: number }) => {});
    const listeners = new Map<string, EventListener>();
    const target = {
      addEventListener(type: string, listener: EventListener) {
        listeners.set(type, listener);
      },
      removeEventListener(type: string) {
        listeners.delete(type);
      },
    } satisfies GestureTarget;

    const dispose = installCuelumeGestureUnlock({ play, target });
    listeners.get("pointerdown")?.(new Event("pointerdown"));
    listeners.get("keydown")?.(new Event("keydown"));

    expect(play).toHaveBeenCalledTimes(1);
    expect(play.mock.calls[0]?.[1]?.volume).toBeGreaterThan(0);
    dispose();
  });
});
