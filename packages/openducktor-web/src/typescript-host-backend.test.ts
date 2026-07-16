import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createLocalAttachmentAdapter,
  createSourceRuntimeDistribution,
  type EffectHostCommandRouter,
} from "@openducktor/host";
import { Effect } from "effect";
import {
  type AgentSessionLiveSseLeaseRegistry,
  createAgentSessionLiveSseLeaseRegistry,
} from "./agent-session-live-sse-lease";
import {
  BufferedHostEventBus,
  stopTypescriptHostBackendServices,
  validateWebFrontendOrigin,
} from "./typescript-host-backend-support";

const nativeResponse = await Bun.fetch("data:,");
(globalThis as typeof globalThis & { Response: typeof Response }).Response =
  nativeResponse.constructor as typeof Response;

const { handleTypescriptHostBackendRequest, startTypescriptHostBackend } = await import(
  "./typescript-host-backend"
);

const APP_TOKEN = "app-token";
const CONTROL_TOKEN = "control-token";
const FRONTEND_ORIGIN = "http://127.0.0.1:1420";
const SOURCE_RUNTIME_DISTRIBUTION = createSourceRuntimeDistribution(
  path.resolve(import.meta.dir, "../../.."),
);

class StructuredHostCommandFailure extends Error {
  readonly details: { readonly command: string; readonly failureKind: "timeout" };

  constructor(command: string) {
    super(`Failed to invoke ${command}.`);
    this.name = "StructuredHostCommandFailure";
    this.details = { command, failureKind: "timeout" };
  }
}

type TestHostCommandInvoke = (
  command: string,
  args?: Record<string, unknown>,
) => Effect.Effect<unknown, unknown>;

const PENDING_STREAM_READ = Symbol("pending-stream-read");
type StreamReadResult = Awaited<ReturnType<ReadableStreamDefaultReader<Uint8Array>["read"]>>;

const readImmediateStreamChunk = async (
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<StreamReadResult> => {
  const readPromise = reader.read().then((value): StreamReadResult => value);
  await Promise.resolve();
  const result = await Promise.race([readPromise, Promise.resolve(PENDING_STREAM_READ)]);
  if (result === PENDING_STREAM_READ) {
    await reader.cancel();
    throw new Error("Expected the SSE response to flush an initial frame immediately.");
  }

  return result;
};

const createTestHostCommandRouter = (
  invoke: TestHostCommandInvoke = () => Effect.succeed(null),
): EffectHostCommandRouter => ({
  dispose: () => Effect.void,
  initialize: () => Effect.void,
  invoke: (command, args) => invoke(command, args) as ReturnType<EffectHostCommandRouter["invoke"]>,
});

const snapshotEnvelope = (attachmentId: string) => ({
  type: "snapshot" as const,
  attachmentId,
  sessions: [],
});

type TestRequestOptions = Partial<{
  appToken: string;
  controlToken: string;
  eventBus: BufferedHostEventBus;
  hostCommandRouter: EffectHostCommandRouter;
  agentSessionLiveSseLeases: AgentSessionLiveSseLeaseRegistry;
  beginShutdown: () => void;
  shutdownStarted: boolean;
  stop: () => Promise<void>;
}>;

const handleTestRequest = (
  request: Request,
  options: TestRequestOptions = {},
): Promise<Response> => {
  const hostCommandRouter = options.hostCommandRouter ?? createTestHostCommandRouter();
  const agentSessionLiveSseLeases =
    options.agentSessionLiveSseLeases ?? createAgentSessionLiveSseLeaseRegistry(hostCommandRouter);
  return Effect.runPromise(
    handleTypescriptHostBackendRequest({
      agentSessionLiveSseLeases,
      allowedOrigins: new Set(),
      appToken: options.appToken ?? APP_TOKEN,
      controlToken: options.controlToken ?? CONTROL_TOKEN,
      eventBus: options.eventBus ?? new BufferedHostEventBus(),
      localAttachments: createLocalAttachmentAdapter(),
      request,
      shutdownStarted: options.shutdownStarted ?? false,
      beginShutdown: options.beginShutdown ?? (() => {}),
      stop: options.stop ?? (async () => {}),
    }),
  );
};

const attachLiveSession = (attachmentId: string, options: TestRequestOptions): Promise<Response> =>
  handleTestRequest(
    new Request("http://127.0.0.1/invoke/agent_session_live_attach", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-openducktor-app-token": APP_TOKEN,
      },
      body: JSON.stringify({ attachmentId, repoPath: "/repo" }),
    }),
    options,
  );

const detachLiveSession = (attachmentId: string, options: TestRequestOptions): Promise<Response> =>
  handleTestRequest(
    new Request("http://127.0.0.1/invoke/agent_session_live_detach", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-openducktor-app-token": APP_TOKEN,
      },
      body: JSON.stringify({ attachmentId }),
    }),
    options,
  );

describe("TypeScript web host backend", () => {
  test("serves health, session, invoke, and shutdown through the browser HTTP contract", async () => {
    const previousConfigDir = process.env.OPENDUCKTOR_CONFIG_DIR;
    const tempConfigDir = await mkdtemp(path.join(tmpdir(), "openducktor-web-host-"));
    process.env.OPENDUCKTOR_CONFIG_DIR = tempConfigDir;
    let backend: Awaited<ReturnType<typeof startTypescriptHostBackend>> | undefined;

    try {
      backend = await startTypescriptHostBackend({
        port: 0,
        frontendOrigin: FRONTEND_ORIGIN,
        controlToken: CONTROL_TOKEN,
        appToken: APP_TOKEN,
        runtimeDistribution: SOURCE_RUNTIME_DISTRIBUTION,
      });
      const backendUrl = `http://127.0.0.1:${backend.port}`;

      const health = await Bun.fetch(`${backendUrl}/health`);
      expect(health.status).toBe(200);
      expect(await health.json()).toEqual({ ok: true });

      const session = await Bun.fetch(`${backendUrl}/session`, {
        method: "POST",
        headers: { "x-openducktor-app-token": APP_TOKEN },
      });
      expect(session.status).toBe(200);
      expect(session.headers.get("set-cookie")).toContain("openducktor_web_session=app-token");

      const invoke = await Bun.fetch(`${backendUrl}/invoke/runtime_definitions_list`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-openducktor-app-token": APP_TOKEN,
        },
        body: JSON.stringify({}),
      });
      expect(invoke.status).toBe(200);
      expect(await invoke.json()).toMatchObject([{ kind: "opencode" }, { kind: "codex" }]);

      const theme = await Bun.fetch(`${backendUrl}/invoke/set_theme`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-openducktor-app-token": APP_TOKEN,
        },
        body: JSON.stringify({ theme: "dark" }),
      });
      expect(theme.status).toBe(200);
      expect(await theme.json()).toBeNull();

      const shutdown = await Bun.fetch(`${backendUrl}/shutdown`, {
        method: "POST",
        headers: { "x-openducktor-control-token": CONTROL_TOKEN },
      });
      expect(shutdown.status).toBe(202);
      await expect(backend.exited).resolves.toBe(0);
    } finally {
      if (backend) {
        await backend.stop();
      }
      if (previousConfigDir === undefined) {
        delete process.env.OPENDUCKTOR_CONFIG_DIR;
      } else {
        process.env.OPENDUCKTOR_CONFIG_DIR = previousConfigDir;
      }
      await rm(tempConfigDir, { force: true, recursive: true });
    }
  }, 5_000);

  test("rejects invalid browser frontend origins before opening a host port", () => {
    expect(() => validateWebFrontendOrigin("https://127.0.0.1:1420")).toThrow(
      "browser frontend origin must use http",
    );
    expect(() => validateWebFrontendOrigin("http://example.com:1420")).toThrow(
      "browser frontend origin must target 127.0.0.1, localhost, or [::1]",
    );
  });

  test("preserves structured host command failure kind in invoke error responses", async () => {
    const hostCommandRouter = createTestHostCommandRouter((command) =>
      Effect.fail(new StructuredHostCommandFailure(command)),
    );

    const response = await handleTestRequest(
      new Request("http://127.0.0.1/invoke/runtime_ensure", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-openducktor-app-token": APP_TOKEN,
        },
        body: JSON.stringify({}),
      }),
      { hostCommandRouter },
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "Failed to invoke runtime_ensure.",
      failureKind: "timeout",
      message: "Failed to invoke runtime_ensure.",
    });
  });

  test("flushes an initial SSE frame for idle dev-server streams", async () => {
    const response = await handleTestRequest(
      new Request("http://127.0.0.1/dev-server-events", {
        method: "GET",
        headers: { "x-openducktor-app-token": APP_TOKEN },
      }),
      { eventBus: new BufferedHostEventBus() },
    );

    expect(response.status).toBe(200);
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("Expected SSE response body.");
    }
    try {
      const chunk = await readImmediateStreamChunk(reader);
      expect(chunk.done).toBe(false);
      expect(new TextDecoder().decode(chunk.value)).toBe(": openducktor-ready\n\n");
    } finally {
      await reader.cancel();
    }
  });

  test("rejects an unscoped live-session SSE subscription", async () => {
    const response = await handleTestRequest(
      new Request("http://127.0.0.1/agent-session-live-events", {
        method: "GET",
        headers: { "x-openducktor-app-token": APP_TOKEN },
      }),
      { eventBus: new BufferedHostEventBus() },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Live-session event subscriber identity is required.",
      message: "Live-session event subscriber identity is required.",
    });
  });

  test("does not replay stale live-session envelopes to a new attachment transport", async () => {
    const eventBus = new BufferedHostEventBus();
    const hostCommandRouter = createTestHostCommandRouter();
    const agentSessionLiveSseLeases = createAgentSessionLiveSseLeaseRegistry(hostCommandRouter);
    const requestOptions = { agentSessionLiveSseLeases, eventBus, hostCommandRouter };
    const activeAttachment =
      "agent-session-live-events?subscriber=active-renderer:0:active-attachment";
    eventBus.publish("openducktor://agent-session-live-event", {
      type: "snapshot",
      attachmentId: "stale-attachment",
      sessions: [],
    });
    const response = await handleTestRequest(
      new Request("http://127.0.0.1/agent-session-live-events?subscriber=active-renderer", {
        method: "GET",
        headers: { "x-openducktor-app-token": APP_TOKEN },
      }),
      requestOptions,
    );

    expect(response.status).toBe(200);
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("Expected SSE response body.");
    }
    try {
      const readyChunk = await readImmediateStreamChunk(reader);
      expect(new TextDecoder().decode(readyChunk.value)).toBe(": openducktor-ready\n\n");
      expect((await attachLiveSession(activeAttachment, requestOptions)).status).toBe(200);

      eventBus.publish("openducktor://agent-session-live-event", {
        type: "snapshot",
        attachmentId: activeAttachment,
        sessions: [],
      });
      const liveChunk = await readImmediateStreamChunk(reader);
      const livePayload = new TextDecoder().decode(liveChunk.value);
      expect(livePayload).toContain("active-attachment");
      expect(livePayload).not.toContain("stale-attachment");
    } finally {
      await reader.cancel();
    }
  });

  test("delivers live-session envelopes only to the matching browser attachment scope", async () => {
    const eventBus = new BufferedHostEventBus();
    const hostCommandRouter = createTestHostCommandRouter();
    const agentSessionLiveSseLeases = createAgentSessionLiveSseLeaseRegistry(hostCommandRouter);
    const requestOptions = { agentSessionLiveSseLeases, eventBus, hostCommandRouter };
    const attachmentA = "agent-session-live-events?subscriber=renderer-a:0:attachment-a";
    const attachmentB = "agent-session-live-events?subscriber=renderer-b:0:attachment-b";
    const responseA = await handleTestRequest(
      new Request("http://127.0.0.1/agent-session-live-events?subscriber=renderer-a", {
        method: "GET",
        headers: { "x-openducktor-app-token": APP_TOKEN },
      }),
      requestOptions,
    );
    const responseB = await handleTestRequest(
      new Request("http://127.0.0.1/agent-session-live-events?subscriber=renderer-b", {
        method: "GET",
        headers: { "x-openducktor-app-token": APP_TOKEN },
      }),
      requestOptions,
    );
    const readerA = responseA.body?.getReader();
    const readerB = responseB.body?.getReader();
    if (!readerA || !readerB) {
      throw new Error("Expected both SSE response bodies.");
    }

    try {
      await readImmediateStreamChunk(readerA);
      await readImmediateStreamChunk(readerB);
      expect((await attachLiveSession(attachmentA, requestOptions)).status).toBe(200);
      expect((await attachLiveSession(attachmentB, requestOptions)).status).toBe(200);
      eventBus.publish("openducktor://agent-session-live-event", {
        type: "snapshot",
        attachmentId: attachmentA,
        sessions: [],
      });
      eventBus.publish("openducktor://agent-session-live-event", {
        type: "snapshot",
        attachmentId: attachmentB,
        sessions: [],
      });

      const payloadA = new TextDecoder().decode((await readImmediateStreamChunk(readerA)).value);
      const payloadB = new TextDecoder().decode((await readImmediateStreamChunk(readerB)).value);
      expect(payloadA).toContain("attachment-a");
      expect(payloadA).not.toContain("attachment-b");
      expect(payloadB).toContain("attachment-b");
      expect(payloadB).not.toContain("attachment-a");
    } finally {
      await readerA.cancel();
      await readerB.cancel();
    }
  });

  test("rejects a live-session attach outside every active subscriber lease", async () => {
    const eventBus = new BufferedHostEventBus();
    const attachedAttachmentIds: string[] = [];
    const hostCommandRouter = createTestHostCommandRouter((command, args) => {
      if (command === "agent_session_live_attach") {
        const attachmentId = args?.attachmentId;
        if (typeof attachmentId !== "string") {
          return Effect.fail(new Error("Expected attachmentId."));
        }
        attachedAttachmentIds.push(attachmentId);
      }
      return Effect.succeed(null);
    });
    const agentSessionLiveSseLeases = createAgentSessionLiveSseLeaseRegistry(hostCommandRouter);
    const requestOptions = { agentSessionLiveSseLeases, eventBus, hostCommandRouter };
    const response = await handleTestRequest(
      new Request("http://127.0.0.1/agent-session-live-events?subscriber=renderer-a", {
        method: "GET",
        headers: { "x-openducktor-app-token": APP_TOKEN },
      }),
      requestOptions,
    );
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("Expected SSE response body.");
    }
    await readImmediateStreamChunk(reader);

    const attachmentA = "agent-session-live-events?subscriber=renderer-a:0:attachment-a";
    const attachmentB = "agent-session-live-events?subscriber=renderer-b:0:attachment-b";
    expect((await attachLiveSession(attachmentA, requestOptions)).status).toBe(200);
    const foreignAttachResponse = await attachLiveSession(attachmentB, requestOptions);

    expect(foreignAttachResponse.status).toBe(409);
    expect(await foreignAttachResponse.json()).toMatchObject({
      message: `Live-session attachment '${attachmentB}' does not belong to an active browser transport.`,
    });
    expect(attachedAttachmentIds).toEqual([attachmentA]);
    await reader.cancel();
  });

  test("does not invoke a replacement attach while its subscriber transport is disconnected", async () => {
    const eventBus = new BufferedHostEventBus();
    const attachedAttachmentIds: string[] = [];
    const hostCommandRouter = createTestHostCommandRouter((command, args) => {
      if (command === "agent_session_live_attach") {
        const attachmentId = args?.attachmentId;
        if (typeof attachmentId !== "string") {
          return Effect.fail(new Error("Expected attachmentId."));
        }
        attachedAttachmentIds.push(attachmentId);
      }
      return Effect.succeed(null);
    });
    const agentSessionLiveSseLeases = createAgentSessionLiveSseLeaseRegistry(hostCommandRouter);
    const requestOptions = { agentSessionLiveSseLeases, eventBus, hostCommandRouter };
    const streamRequest = () =>
      handleTestRequest(
        new Request("http://127.0.0.1/agent-session-live-events?subscriber=renderer-a", {
          method: "GET",
          headers: { "x-openducktor-app-token": APP_TOKEN },
        }),
        requestOptions,
      );
    const response = await streamRequest();
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("Expected SSE response body.");
    }
    await readImmediateStreamChunk(reader);
    const oldAttachment = "agent-session-live-events?subscriber=renderer-a:0:old-attachment";
    const replacementAttachment =
      "agent-session-live-events?subscriber=renderer-a:0:replacement-attachment";
    expect((await attachLiveSession(oldAttachment, requestOptions)).status).toBe(200);
    await reader.cancel();

    expect((await attachLiveSession(replacementAttachment, requestOptions)).status).toBe(409);
    expect(attachedAttachmentIds).toEqual([oldAttachment]);

    const reconnectedResponse = await streamRequest();
    const reconnectedReader = reconnectedResponse.body?.getReader();
    if (!reconnectedReader) {
      throw new Error("Expected reconnected SSE response body.");
    }
    await readImmediateStreamChunk(reconnectedReader);
    expect((await attachLiveSession(replacementAttachment, requestOptions)).status).toBe(200);
    expect(attachedAttachmentIds).toEqual([oldAttachment, replacementAttachment]);
    await reconnectedReader.cancel();
  });

  test("disconnects a live-session transport lease without detaching another subscriber", async () => {
    const eventBus = new BufferedHostEventBus();
    const detachedAttachmentIds: string[] = [];
    const hostCommandRouter = createTestHostCommandRouter((command, args) => {
      if (command === "agent_session_live_detach") {
        const attachmentId = args?.attachmentId;
        if (typeof attachmentId !== "string") {
          return Effect.fail(new Error("Expected attachmentId."));
        }
        detachedAttachmentIds.push(attachmentId);
      }
      return Effect.succeed(null);
    });
    const agentSessionLiveSseLeases = createAgentSessionLiveSseLeaseRegistry(hostCommandRouter);
    const requestOptions = { agentSessionLiveSseLeases, eventBus, hostCommandRouter };
    const responseA = await handleTestRequest(
      new Request("http://127.0.0.1/agent-session-live-events?subscriber=renderer-a", {
        method: "GET",
        headers: { "x-openducktor-app-token": APP_TOKEN },
      }),
      requestOptions,
    );
    const responseB = await handleTestRequest(
      new Request("http://127.0.0.1/agent-session-live-events?subscriber=renderer-b", {
        method: "GET",
        headers: { "x-openducktor-app-token": APP_TOKEN },
      }),
      requestOptions,
    );
    const readerA = responseA.body?.getReader();
    const readerB = responseB.body?.getReader();
    if (!readerA || !readerB) {
      throw new Error("Expected both SSE response bodies.");
    }
    const attachmentA = "agent-session-live-events?subscriber=renderer-a:0:attachment-a";
    const attachmentB = "agent-session-live-events?subscriber=renderer-b:0:attachment-b";

    await readImmediateStreamChunk(readerA);
    await readImmediateStreamChunk(readerB);
    expect((await attachLiveSession(attachmentA, requestOptions)).status).toBe(200);
    expect((await attachLiveSession(attachmentB, requestOptions)).status).toBe(200);
    eventBus.publish("openducktor://agent-session-live-event", snapshotEnvelope(attachmentA));
    eventBus.publish("openducktor://agent-session-live-event", snapshotEnvelope(attachmentB));
    expect(new TextDecoder().decode((await readImmediateStreamChunk(readerA)).value)).toContain(
      attachmentA,
    );
    expect(new TextDecoder().decode((await readImmediateStreamChunk(readerB)).value)).toContain(
      attachmentB,
    );

    await readerA.cancel("abrupt renderer reload");

    expect(detachedAttachmentIds).toEqual([attachmentA]);
    eventBus.publish("openducktor://agent-session-live-event", {
      type: "session_removed",
      attachmentId: attachmentB,
      ref: {
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        externalSessionId: "thread-1",
      },
    });
    expect(new TextDecoder().decode((await readImmediateStreamChunk(readerB)).value)).toContain(
      attachmentB,
    );
    expect(detachedAttachmentIds).not.toContain(attachmentB);

    await readerB.cancel();
    expect(detachedAttachmentIds).toEqual([attachmentA, attachmentB]);
  });

  test("disconnect during an in-flight live-session attach detaches after the attach completes", async () => {
    const eventBus = new BufferedHostEventBus();
    const attachmentId =
      "agent-session-live-events?subscriber=renderer-race:0:in-flight-attachment";
    const detachedAttachmentIds: string[] = [];
    let resolveAttachStarted: () => void = () => {};
    const attachStarted = new Promise<void>((resolve) => {
      resolveAttachStarted = resolve;
    });
    let resolveAttach: () => void = () => {};
    const attachGate = new Promise<void>((resolve) => {
      resolveAttach = resolve;
    });
    const hostCommandRouter = createTestHostCommandRouter((command, args) => {
      if (command === "agent_session_live_attach") {
        return Effect.promise(async () => {
          resolveAttachStarted();
          await attachGate;
          eventBus.publish(
            "openducktor://agent-session-live-event",
            snapshotEnvelope(attachmentId),
          );
          return null;
        });
      }
      if (command === "agent_session_live_detach") {
        const detachedAttachmentId = args?.attachmentId;
        if (typeof detachedAttachmentId !== "string") {
          return Effect.fail(new Error("Expected attachmentId."));
        }
        detachedAttachmentIds.push(detachedAttachmentId);
      }
      return Effect.succeed(null);
    });
    const agentSessionLiveSseLeases = createAgentSessionLiveSseLeaseRegistry(hostCommandRouter);
    const response = await handleTestRequest(
      new Request("http://127.0.0.1/agent-session-live-events?subscriber=renderer-race", {
        method: "GET",
        headers: { "x-openducktor-app-token": APP_TOKEN },
      }),
      { agentSessionLiveSseLeases, eventBus, hostCommandRouter },
    );
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("Expected SSE response body.");
    }
    await readImmediateStreamChunk(reader);

    const attachResponsePromise = handleTestRequest(
      new Request("http://127.0.0.1/invoke/agent_session_live_attach", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-openducktor-app-token": APP_TOKEN,
        },
        body: JSON.stringify({ attachmentId, repoPath: "/repo" }),
      }),
      { agentSessionLiveSseLeases, eventBus, hostCommandRouter },
    );
    await attachStarted;

    const cancelPromise = reader.cancel("renderer disconnected before the snapshot");
    resolveAttach();
    const [attachResponse] = await Promise.all([attachResponsePromise, cancelPromise]);

    expect(attachResponse.status).toBe(200);
    expect(detachedAttachmentIds).toEqual([attachmentId]);
  });

  test("a failed disconnect cleanup remains explicitly retriable", async () => {
    const eventBus = new BufferedHostEventBus();
    const attachmentId = "agent-session-live-events?subscriber=renderer-retry:0:retry-attachment";
    let detachAttempts = 0;
    const hostCommandRouter = createTestHostCommandRouter((command) => {
      if (command === "agent_session_live_detach") {
        detachAttempts += 1;
        if (detachAttempts === 1) {
          return Effect.fail(new Error("first detach failed"));
        }
      }
      return Effect.succeed(null);
    });
    const agentSessionLiveSseLeases = createAgentSessionLiveSseLeaseRegistry(hostCommandRouter);
    const requestOptions = { agentSessionLiveSseLeases, eventBus, hostCommandRouter };
    const response = await handleTestRequest(
      new Request("http://127.0.0.1/agent-session-live-events?subscriber=renderer-retry", {
        method: "GET",
        headers: { "x-openducktor-app-token": APP_TOKEN },
      }),
      requestOptions,
    );
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("Expected SSE response body.");
    }
    await readImmediateStreamChunk(reader);
    expect((await attachLiveSession(attachmentId, requestOptions)).status).toBe(200);

    await expect(reader.cancel("renderer disconnected")).rejects.toThrow(
      "Failed to release 1 live-session browser attachment(s).",
    );
    expect(detachAttempts).toBe(1);

    expect((await detachLiveSession(attachmentId, requestOptions)).status).toBe(200);
    expect(detachAttempts).toBe(2);
  });

  test("same-subscriber reconnect generations retain independent ownership", async () => {
    const eventBus = new BufferedHostEventBus();
    const detachedAttachmentIds: string[] = [];
    const hostCommandRouter = createTestHostCommandRouter((command, args) => {
      if (command === "agent_session_live_detach") {
        const attachmentId = args?.attachmentId;
        if (typeof attachmentId !== "string") {
          return Effect.fail(new Error("Expected attachmentId."));
        }
        detachedAttachmentIds.push(attachmentId);
      }
      return Effect.succeed(null);
    });
    const agentSessionLiveSseLeases = createAgentSessionLiveSseLeaseRegistry(hostCommandRouter);
    const requestOptions = { agentSessionLiveSseLeases, eventBus, hostCommandRouter };
    const streamRequest = () =>
      handleTestRequest(
        new Request("http://127.0.0.1/agent-session-live-events?subscriber=renderer-a", {
          method: "GET",
          headers: { "x-openducktor-app-token": APP_TOKEN },
        }),
        requestOptions,
      );
    const oldResponse = await streamRequest();
    const oldReader = oldResponse.body?.getReader();
    if (!oldReader) {
      throw new Error("Expected the old SSE response body.");
    }
    await readImmediateStreamChunk(oldReader);
    const oldAttachment = "agent-session-live-events?subscriber=renderer-a:0:old-attachment";
    expect((await attachLiveSession(oldAttachment, requestOptions)).status).toBe(200);

    const newResponse = await streamRequest();
    const newReader = newResponse.body?.getReader();
    if (!newReader) {
      throw new Error("Expected the new SSE response body.");
    }
    await readImmediateStreamChunk(newReader);
    const newAttachment = "agent-session-live-events?subscriber=renderer-a:1:new-attachment";
    expect((await attachLiveSession(newAttachment, requestOptions)).status).toBe(200);

    eventBus.publish("openducktor://agent-session-live-event", snapshotEnvelope(oldAttachment));
    eventBus.publish("openducktor://agent-session-live-event", snapshotEnvelope(newAttachment));
    expect(new TextDecoder().decode((await readImmediateStreamChunk(oldReader)).value)).toContain(
      oldAttachment,
    );
    expect(new TextDecoder().decode((await readImmediateStreamChunk(newReader)).value)).toContain(
      newAttachment,
    );

    await oldReader.cancel();
    expect(detachedAttachmentIds).toEqual([oldAttachment]);
    eventBus.publish("openducktor://agent-session-live-event", {
      type: "session_removed",
      attachmentId: newAttachment,
      ref: {
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        externalSessionId: "thread-1",
      },
    });
    expect(new TextDecoder().decode((await readImmediateStreamChunk(newReader)).value)).toContain(
      newAttachment,
    );
    await newReader.cancel();
    expect(detachedAttachmentIds).toEqual([oldAttachment, newAttachment]);
  });

  test("a reconnect waits for its fresh host snapshot instead of replaying a stale attachment", async () => {
    const eventBus = new BufferedHostEventBus();
    const hostCommandRouter = createTestHostCommandRouter();
    const agentSessionLiveSseLeases = createAgentSessionLiveSseLeaseRegistry(hostCommandRouter);
    const requestOptions = { agentSessionLiveSseLeases, eventBus, hostCommandRouter };
    const staleAttachment = "agent-session-live-events?subscriber=renderer-a:0:stale-attachment";
    eventBus.publish("openducktor://agent-session-live-event", snapshotEnvelope(staleAttachment));

    const response = await handleTestRequest(
      new Request("http://127.0.0.1/agent-session-live-events?subscriber=renderer-a", {
        method: "GET",
        headers: {
          "last-event-id": "0",
          "x-openducktor-app-token": APP_TOKEN,
        },
      }),
      requestOptions,
    );
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("Expected SSE response body.");
    }

    const ready = await readImmediateStreamChunk(reader);
    expect(new TextDecoder().decode(ready.value)).toBe(": openducktor-ready\n\n");
    const freshAttachment = "agent-session-live-events?subscriber=renderer-a:1:fresh-attachment";
    expect((await attachLiveSession(freshAttachment, requestOptions)).status).toBe(200);
    eventBus.publish("openducktor://agent-session-live-event", snapshotEnvelope(freshAttachment));
    const snapshot = new TextDecoder().decode((await readImmediateStreamChunk(reader)).value);

    expect(snapshot).toContain(freshAttachment);
    expect(snapshot).not.toContain(staleAttachment);
    await reader.cancel();
  });

  test("emits a stream warning when dev-server SSE replay cannot cover the reconnect gap", async () => {
    const eventBus = new BufferedHostEventBus();
    for (let index = 0; index < 258; index += 1) {
      eventBus.publish("openducktor://dev-server-event", {
        type: "terminal_chunk",
        repoPath: "/repo",
        taskId: "task-1",
        terminalChunk: {
          scriptId: "web",
          sequence: index,
          data: `line-${index}\r\n`,
          timestamp: "2026-03-19T15:30:00.000Z",
        },
      });
    }

    const response = await handleTestRequest(
      new Request("http://127.0.0.1/dev-server-events", {
        method: "GET",
        headers: {
          "last-event-id": "1",
          "x-openducktor-app-token": APP_TOKEN,
        },
      }),
      { eventBus },
    );

    expect(response.status).toBe(200);
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("Expected SSE response body.");
    }
    try {
      const readyChunk = await readImmediateStreamChunk(reader);
      expect(readyChunk.done).toBe(false);
      expect(new TextDecoder().decode(readyChunk.value)).toBe(": openducktor-ready\n\n");

      const warningChunk = await readImmediateStreamChunk(reader);
      expect(warningChunk.done).toBe(false);
      expect(new TextDecoder().decode(warningChunk.value)).toBe(
        "event: stream-warning\n" +
          "data: Dev server stream skipped 1 event; reconnect will replay buffered events.\n\n",
      );

      const replayChunk = await readImmediateStreamChunk(reader);
      expect(replayChunk.done).toBe(false);
      expect(new TextDecoder().decode(replayChunk.value)).toContain('"data":"line-2\\r\\n"');
    } finally {
      await reader.cancel();
    }
  });

  test("rejects malformed invoke command URI components as typed host request errors", async () => {
    const response = await handleTestRequest(
      new Request("http://127.0.0.1/invoke/%E0%A4%A", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-openducktor-app-token": APP_TOKEN,
        },
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Invalid command URI component: %E0%A4%A",
      message: "Invalid command URI component: %E0%A4%A",
    });
  });

  test("resolves host backend exit after stop server failures", async () => {
    const resolvedExitCodes: number[] = [];

    await expect(
      stopTypescriptHostBackendServices({
        disposeHost: () => Effect.void,
        resolveExited: (exitCode) => {
          resolvedExitCodes.push(exitCode);
        },
        stopServer: () => {
          throw new Error("stop server failed");
        },
      }),
    ).rejects.toMatchObject({ _tag: "WebOperationError" });
    expect(resolvedExitCodes).toEqual([1]);
  });

  test("rejects missing or invalid backend auth through typed route errors", async () => {
    const sessionMissing = await handleTestRequest(
      new Request("http://127.0.0.1/session", { method: "POST" }),
    );
    expect(sessionMissing.status).toBe(401);
    expect(await sessionMissing.json()).toEqual({
      error: "Missing OpenDucktor web host app token.",
      message: "Missing OpenDucktor web host app token.",
    });

    const sessionInvalid = await handleTestRequest(
      new Request("http://127.0.0.1/session", {
        method: "POST",
        headers: { "x-openducktor-app-token": "wrong" },
      }),
    );
    expect(sessionInvalid.status).toBe(403);
    expect(await sessionInvalid.json()).toEqual({
      error: "Invalid OpenDucktor web host app token.",
      message: "Invalid OpenDucktor web host app token.",
    });

    let stopCalls = 0;
    const stop = async () => {
      stopCalls += 1;
    };
    const shutdownMissing = await handleTestRequest(
      new Request("http://127.0.0.1/shutdown", { method: "POST" }),
      { stop },
    );
    expect(shutdownMissing.status).toBe(401);
    expect(await shutdownMissing.json()).toEqual({
      error: "Missing OpenDucktor web host control token.",
      message: "Missing OpenDucktor web host control token.",
    });
    expect(stopCalls).toBe(0);

    const shutdownInvalid = await handleTestRequest(
      new Request("http://127.0.0.1/shutdown", {
        method: "POST",
        headers: { "x-openducktor-control-token": "wrong" },
      }),
      { stop },
    );
    expect(shutdownInvalid.status).toBe(403);
    expect(await shutdownInvalid.json()).toEqual({
      error: "Invalid OpenDucktor web host control token.",
      message: "Invalid OpenDucktor web host control token.",
    });
    expect(stopCalls).toBe(0);

    const previewUrl = "http://127.0.0.1/local-attachment-preview?path=/tmp/file";
    const previewMissing = await handleTestRequest(new Request(previewUrl));
    expect(previewMissing.status).toBe(401);
    expect(await previewMissing.json()).toEqual({
      error: "Missing OpenDucktor web host app token.",
      message: "Missing OpenDucktor web host app token.",
    });

    const previewInvalid = await handleTestRequest({
      headers: new Headers([["cookie", "openducktor_web_session=wrong"]]),
      method: "GET",
      url: previewUrl,
    } as Request);
    expect(previewInvalid.status).toBe(403);
    expect(await previewInvalid.json()).toEqual({
      error: "Invalid OpenDucktor web host app token.",
      message: "Invalid OpenDucktor web host app token.",
    });
  });

  test("marks shutdown as started before deferred host teardown runs", async () => {
    let shutdownStarted = false;
    let stopCalls = 0;

    const response = await handleTestRequest(
      new Request("http://127.0.0.1/shutdown", {
        method: "POST",
        headers: { "x-openducktor-control-token": CONTROL_TOKEN },
      }),
      {
        beginShutdown: () => {
          shutdownStarted = true;
        },
        stop: async () => {
          stopCalls += 1;
        },
      },
    );

    expect(response.status).toBe(202);
    expect(shutdownStarted).toBe(true);
    expect(stopCalls).toBe(0);
  });

  test("keeps the backend server alive until host disposal finishes", async () => {
    const calls: string[] = [];
    let releaseDispose: () => void = () => {};
    const disposeReleased = new Promise<void>((resolve) => {
      releaseDispose = resolve;
    });
    let disposeStarted: () => void = () => {};
    const disposeStartedPromise = new Promise<void>((resolve) => {
      disposeStarted = resolve;
    });

    const stopPromise = stopTypescriptHostBackendServices({
      disposeHost: () =>
        Effect.promise(async () => {
          calls.push("dispose-started");
          disposeStarted();
          await disposeReleased;
          calls.push("dispose-finished");
        }),
      resolveExited: (exitCode) => {
        calls.push(`exited-${exitCode}`);
      },
      stopServer: () => {
        calls.push("server-stopped");
      },
    });

    await disposeStartedPromise;
    expect(calls).toEqual(["dispose-started"]);

    releaseDispose();
    await stopPromise;
    expect(calls).toEqual(["dispose-started", "dispose-finished", "server-stopped", "exited-0"]);
  });
});
