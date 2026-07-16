import { describe, expect, mock, test } from "bun:test";
import type { AgentSessionLiveEnvelope } from "@openducktor/contracts";
import {
  createElectronAgentSessionLiveAttachmentRegistry,
  createElectronAgentSessionLiveLifecycleHandlers,
} from "./electron-agent-session-live-attachments";

const LIVE_EVENT_CHANNEL = "openducktor://agent-session-live-event";

const snapshotEnvelope = (attachmentId: string): AgentSessionLiveEnvelope => ({
  type: "snapshot",
  attachmentId,
  sessions: [],
});

const attachRequest = (attachmentId: string, repoPath = "/repo") => ({
  command: "agent_session_live_attach" as const,
  args: { attachmentId, repoPath },
});

describe("Electron agent-session live attachment ownership", () => {
  test("claims the owner before host attach publishes the initial snapshot", async () => {
    const registry = createElectronAgentSessionLiveAttachmentRegistry({
      detachAttachment: async () => {},
    });
    const attachmentId = "electron-agent-session-live:0:attachment-1";
    let snapshotReachedOwnerDuringAttach = false;

    await registry.invoke(11, attachRequest(attachmentId), async () => {
      snapshotReachedOwnerDuringAttach = registry.shouldDeliverHostEvent(
        11,
        LIVE_EVENT_CHANNEL,
        snapshotEnvelope(attachmentId),
      );
      return null;
    });

    expect(snapshotReachedOwnerDuringAttach).toBe(true);
    expect(
      registry.shouldDeliverHostEvent(12, LIVE_EVENT_CHANNEL, snapshotEnvelope(attachmentId)),
    ).toBe(false);
  });

  test("an abrupt main-frame reload releases only that renderer's attachments", async () => {
    const detachAttachment = mock(async () => {});
    const registry = createElectronAgentSessionLiveAttachmentRegistry({ detachAttachment });
    const firstAttachmentId = "electron-agent-session-live:0:attachment-window-1";
    const secondAttachmentId = "electron-agent-session-live:0:attachment-window-2";

    await registry.invoke(11, attachRequest(firstAttachmentId), async () => null);
    await registry.invoke(12, attachRequest(secondAttachmentId), async () => null);
    const lifecycle = createElectronAgentSessionLiveLifecycleHandlers({
      ownerId: 11,
      registry,
      onCleanupError: (error) => {
        throw error;
      },
    });

    await lifecycle.onMainFrameNavigation({ isInPlace: false, isMainFrame: false });
    await lifecycle.onMainFrameNavigation({ isInPlace: true, isMainFrame: true });
    expect(detachAttachment).not.toHaveBeenCalled();

    await lifecycle.onMainFrameNavigation({ isInPlace: false, isMainFrame: true });

    expect(detachAttachment).toHaveBeenCalledTimes(1);
    expect(detachAttachment).toHaveBeenCalledWith({ attachmentId: firstAttachmentId });
    expect(
      registry.shouldDeliverHostEvent(11, LIVE_EVENT_CHANNEL, snapshotEnvelope(firstAttachmentId)),
    ).toBe(false);
    expect(
      registry.shouldDeliverHostEvent(12, LIVE_EVENT_CHANNEL, snapshotEnvelope(secondAttachmentId)),
    ).toBe(true);
  });

  test("renderer loss waits for an in-flight attach and then removes the stale host attachment", async () => {
    let finishAttach: (() => void) | null = null;
    const attachBlocked = new Promise<void>((resolve) => {
      finishAttach = resolve;
    });
    const operations: string[] = [];
    const registry = createElectronAgentSessionLiveAttachmentRegistry({
      detachAttachment: async ({ attachmentId }) => {
        operations.push(`detach:${attachmentId}`);
      },
    });
    const attachmentId = "electron-agent-session-live:0:attachment-racing-crash";

    const attach = registry.invoke(11, attachRequest(attachmentId), async () => {
      operations.push(`attach-start:${attachmentId}`);
      await attachBlocked;
      operations.push(`attach-finish:${attachmentId}`);
      return null;
    });
    const lifecycle = createElectronAgentSessionLiveLifecycleHandlers({
      ownerId: 11,
      registry,
      onCleanupError: (error) => {
        throw error;
      },
    });
    const rendererGone = lifecycle.onRenderProcessGone();

    finishAttach?.();
    await Promise.all([attach, rendererGone]);

    expect(operations).toEqual([
      `attach-start:${attachmentId}`,
      `attach-finish:${attachmentId}`,
      `detach:${attachmentId}`,
    ]);
    expect(
      registry.shouldDeliverHostEvent(11, LIVE_EVENT_CHANNEL, snapshotEnvelope(attachmentId)),
    ).toBe(false);
  });

  test("webContents destruction is idempotent after renderer-process cleanup", async () => {
    const detachAttachment = mock(async () => {});
    const registry = createElectronAgentSessionLiveAttachmentRegistry({ detachAttachment });
    const attachmentId = "electron-agent-session-live:0:attachment-destroyed";
    await registry.invoke(11, attachRequest(attachmentId), async () => null);
    const lifecycle = createElectronAgentSessionLiveLifecycleHandlers({
      ownerId: 11,
      registry,
      onCleanupError: (error) => {
        throw error;
      },
    });

    await lifecycle.onRenderProcessGone();
    await lifecycle.onDestroyed();

    expect(detachAttachment).toHaveBeenCalledTimes(1);
  });

  test("failed renderer cleanup keeps only failed attachments owned for the next lifecycle retry", async () => {
    const firstFailedAttachmentId = "electron-agent-session-live:0:attachment-failed-first";
    const detachedAttachmentId = "electron-agent-session-live:0:attachment-detached";
    const secondFailedAttachmentId = "electron-agent-session-live:0:attachment-failed-second";
    const independentAttachmentId = "electron-agent-session-live:0:attachment-independent";
    const detachAttempts: string[] = [];
    const attemptCounts = new Map<string, number>();
    const detachAttachment = mock(async ({ attachmentId }: { attachmentId: string }) => {
      detachAttempts.push(attachmentId);
      const attemptCount = (attemptCounts.get(attachmentId) ?? 0) + 1;
      attemptCounts.set(attachmentId, attemptCount);
      const failsFirstAttempt =
        attachmentId === firstFailedAttachmentId || attachmentId === secondFailedAttachmentId;
      if (failsFirstAttempt && attemptCount === 1) {
        throw new Error(`transient detach failure for ${attachmentId}`);
      }
    });
    const registry = createElectronAgentSessionLiveAttachmentRegistry({ detachAttachment });
    await registry.invoke(11, attachRequest(firstFailedAttachmentId), async () => null);
    await registry.invoke(11, attachRequest(detachedAttachmentId), async () => null);
    await registry.invoke(11, attachRequest(secondFailedAttachmentId), async () => null);
    await registry.invoke(12, attachRequest(independentAttachmentId), async () => null);
    const cleanupErrors: unknown[] = [];
    const lifecycle = createElectronAgentSessionLiveLifecycleHandlers({
      ownerId: 11,
      registry,
      onCleanupError: (error) => {
        cleanupErrors.push(error);
      },
    });

    await lifecycle.onRenderProcessGone();

    expect(detachAttempts).toEqual([
      firstFailedAttachmentId,
      detachedAttachmentId,
      secondFailedAttachmentId,
    ]);
    expect(cleanupErrors).toHaveLength(1);
    expect(cleanupErrors[0]).toBeInstanceOf(AggregateError);
    expect((cleanupErrors[0] as Error).message).toContain(firstFailedAttachmentId);
    expect((cleanupErrors[0] as Error).message).toContain(secondFailedAttachmentId);
    expect(
      registry.shouldDeliverHostEvent(
        11,
        LIVE_EVENT_CHANNEL,
        snapshotEnvelope(firstFailedAttachmentId),
      ),
    ).toBe(true);
    expect(
      registry.shouldDeliverHostEvent(
        11,
        LIVE_EVENT_CHANNEL,
        snapshotEnvelope(detachedAttachmentId),
      ),
    ).toBe(false);
    expect(
      registry.shouldDeliverHostEvent(
        11,
        LIVE_EVENT_CHANNEL,
        snapshotEnvelope(secondFailedAttachmentId),
      ),
    ).toBe(true);
    expect(
      registry.shouldDeliverHostEvent(
        12,
        LIVE_EVENT_CHANNEL,
        snapshotEnvelope(independentAttachmentId),
      ),
    ).toBe(true);

    await lifecycle.onDestroyed();

    expect(detachAttempts).toEqual([
      firstFailedAttachmentId,
      detachedAttachmentId,
      secondFailedAttachmentId,
      firstFailedAttachmentId,
      secondFailedAttachmentId,
    ]);
    expect(cleanupErrors).toHaveLength(1);
    expect(
      registry.shouldDeliverHostEvent(
        11,
        LIVE_EVENT_CHANNEL,
        snapshotEnvelope(firstFailedAttachmentId),
      ),
    ).toBe(false);
    expect(
      registry.shouldDeliverHostEvent(
        11,
        LIVE_EVENT_CHANNEL,
        snapshotEnvelope(secondFailedAttachmentId),
      ),
    ).toBe(false);
    expect(
      registry.shouldDeliverHostEvent(
        12,
        LIVE_EVENT_CHANNEL,
        snapshotEnvelope(independentAttachmentId),
      ),
    ).toBe(true);
  });

  test("non-live host events remain broadcast-compatible", () => {
    const registry = createElectronAgentSessionLiveAttachmentRegistry({
      detachAttachment: async () => {},
    });

    expect(
      registry.shouldDeliverHostEvent(11, "openducktor://task-event", { type: "task-updated" }),
    ).toBe(true);
  });
});
