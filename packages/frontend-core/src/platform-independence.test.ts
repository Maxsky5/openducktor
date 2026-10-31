import { describe, expect, mock, spyOn, test } from "bun:test";
import {
  REMOTE_BASELINE_CAPABILITIES,
  REMOTE_PROTOCOL_VERSION,
  type RemoteHostDescriptor,
} from "@openducktor/contracts";
import { createHostClient } from "@openducktor/host-client";
import type { RemoteHttpResponse, RemoteTransport } from "@openducktor/host-client/remote";
import { QueryObserver } from "@tanstack/react-query";
import { connectionHost, createClientConnection } from "./connection/client-connection";
import { createClientQueryClient } from "./connection/client-query-client";
import { draftHasMeaningfulContent } from "./drafts/agent-chat-composer-draft";
import { errorMessage } from "./lib/errors";
import { createMemoryClientStorage } from "./platform/client-storage";
import { repoTaskDataQueryOptions, taskQueryKeys } from "./queries/tasks";
import type { ConnectionControlEvent } from "./recovery/connection-control-events";
import { createRemoteHostConnection } from "./recovery/remote-host-connection";
import { createFeedbackFake } from "./test-support/feedback-fake";
import { createTaskCardFixture } from "./test-support/shared-test-fixtures";
import {
  createTestClientConnection,
  createTestHostConnection,
} from "./test-support/test-client-connection";
import { waitForExpectation } from "./test-support/wait-for-expectation";
import type { BuiltinTaskCard as TaskCard } from "@openducktor/workflows";

const REPO_PATH = "/repo";
const chatDraftIdentity = { workspaceId: "workspace-1", workspaceSessionId: "session-1" };
const draftWithText = (text: string) => ({
  segments: [{ id: "text-1", kind: "text" as const, text }],
});
const INLINE_OWNER_KEY = "openducktor:git-diff-comments:v1:workspace-1:task-1";
const inlineComment = {
  filePath: "src/a.ts",
  diffScope: "uncommitted" as const,
  startLine: 1,
  endLine: 1,
  side: "new" as const,
  text: "Check this line.",
  codeContext: [],
};

const hostWithTasks = (tasks: TaskCard[]) =>
  createTestHostConnection({ client: { tasksList: async () => tasks } });

describe("frontend core without a DOM", () => {
  test("runs without browser globals", () => {
    expect(globalThis.document).toBeUndefined();
    expect(globalThis.window).toBeUndefined();
  });

  test("keeps caches and drafts apart for hosts with identical repository paths", async () => {
    const taskA = createTaskCardFixture({ id: "task-a", title: "Host A task" });
    const taskB = createTaskCardFixture({ id: "task-b", title: "Host B task" });
    const storageA = createMemoryClientStorage();
    const storageB = createMemoryClientStorage();
    const connectionA = createTestClientConnection({
      host: hostWithTasks([taskA]),
      storage: storageA,
    });
    const connectionB = createTestClientConnection({
      host: hostWithTasks([taskB]),
      storage: storageB,
    });
    try {
      const [dataA, dataB] = await Promise.all([
        connectionA.queryClient.fetchQuery(repoTaskDataQueryOptions(REPO_PATH)),
        connectionB.queryClient.fetchQuery(repoTaskDataQueryOptions(REPO_PATH)),
      ]);
      expect(dataA.tasks.map((task) => task.id)).toEqual(["task-a"]);
      expect(dataB.tasks.map((task) => task.id)).toEqual(["task-b"]);

      connectionA.drafts.chat.set(chatDraftIdentity, null, draftWithText("Only on host A"));
      await connectionA.drafts.chat.flush(chatDraftIdentity);
      expect(storageA.length).toBe(1);
      expect(storageB.length).toBe(0);
      expect(
        draftHasMeaningfulContent(connectionB.drafts.chat.hydrate(chatDraftIdentity, null)),
      ).toBe(false);

      const inlineDrafts = (connection: typeof connectionA) =>
        connection.drafts.inlineComments.getState();
      inlineDrafts(connectionA).addDraft(INLINE_OWNER_KEY, inlineComment);
      expect(inlineDrafts(connectionA).getDraftCount(INLINE_OWNER_KEY)).toBe(1);
      expect(inlineDrafts(connectionB).getDraftCount(INLINE_OWNER_KEY)).toBe(0);
    } finally {
      await connectionA.dispose();
      await connectionB.dispose();
    }
  });

  test("drops a late response of a disposed connection", async () => {
    const lateTasks = Promise.withResolvers<TaskCard[]>();
    const connectionA = createTestClientConnection({
      host: createTestHostConnection({ client: { tasksList: () => lateTasks.promise } }),
    });
    const connectionB = createTestClientConnection({ host: hostWithTasks([]) });
    const lateRead = connectionA.queryClient
      .fetchQuery(repoTaskDataQueryOptions(REPO_PATH))
      .catch((cause: unknown) => cause);

    await connectionA.dispose();
    lateTasks.resolve([createTaskCardFixture({ id: "late-task" })]);
    await lateRead;

    expect(connectionA.queryClient.getQueryData(taskQueryKeys.repoData(REPO_PATH))).toBeUndefined();
    expect(connectionB.queryClient.getQueryData(taskQueryKeys.repoData(REPO_PATH))).toBeUndefined();
    expect(() => connectionHost(connectionA.queryClient)).toThrow(
      "This query client has no open host connection.",
    );
    await connectionB.dispose();
  });

  test("disposes without a host command and keeps host work running", async () => {
    const commands: string[] = [];
    const releases: string[] = [];
    const host = createTestHostConnection();
    const connection = createClientConnection({
      host: {
        ...host,
        client: createHostClient(async (command) => {
          commands.push(command);
          throw new Error(`Disposal must not send ${command}.`);
        }),
      },
      queryClient: createClientQueryClient(),
      storage: createMemoryClientStorage(),
      feedback: createFeedbackFake(),
      stageAttachment: async () => "/staged/file.png",
      releaseHost: async () => {
        releases.push("host transport");
      },
    });

    await connection.dispose();

    expect(commands).toEqual([]);
    expect(releases).toEqual(["host transport"]);
    expect(() => connectionHost(connection.queryClient)).toThrow(
      "This query client has no open host connection.",
    );
  });

  test("writes unsaved drafts before the first await of disposal", () => {
    const storage = createMemoryClientStorage();
    const connection = createTestClientConnection({ storage, scheduleTask: () => () => {} });
    connection.drafts.chat.set(chatDraftIdentity, null, draftWithText("Unsaved"));
    connection.drafts.inlineComments.getState().addDraft(INLINE_OWNER_KEY, inlineComment);
    expect(storage.length).toBe(0);

    const disposal = connection.dispose();

    // A page that unloads after this task keeps both drafts.
    expect(storage.length).toBe(2);
    return disposal;
  });

  test("drops unsaved drafts without uploads when the storage ends with the connection", async () => {
    const storage = createMemoryClientStorage();
    const stageAttachment = mock(() => new Promise<string>(() => {}));
    const releaseHost = mock(async () => {});
    const connection = createClientConnection({
      host: createTestHostConnection(),
      queryClient: createClientQueryClient(),
      storage,
      saveDraftsOnDispose: false,
      feedback: createFeedbackFake(),
      stageAttachment,
      releaseHost,
      scheduleTask: () => () => {},
    });
    connection.drafts.chat.set(chatDraftIdentity, null, {
      ...draftWithText("Unsaved"),
      attachments: [
        {
          id: "attachment-1",
          name: "photo.png",
          kind: "image",
          file: { name: "photo.png", type: "image/png", size: 5 },
        },
      ],
    });

    await connection.dispose();

    expect(stageAttachment).not.toHaveBeenCalled();
    expect(storage.length).toBe(0);
    expect(releaseHost).toHaveBeenCalledTimes(1);
  });

  test("reports a failed draft save from disposal and keeps the draft", async () => {
    const storage = createMemoryClientStorage();
    storage.setItem = () => {
      throw new Error("Storage is full.");
    };
    const connection = createTestClientConnection({ storage, scheduleTask: () => () => {} });
    connection.drafts.chat.set(chatDraftIdentity, null, draftWithText("Unsaved"));
    const consoleError = spyOn(console, "error").mockImplementation(() => {});
    try {
      const failure = await connection.dispose().catch((cause: unknown) => cause);

      if (!(failure instanceof AggregateError)) throw new Error("Disposal must reject.");
      expect(failure.errors.map((error) => errorMessage(error))).toEqual([
        expect.stringContaining("Could not save a chat draft."),
      ]);
      expect(connection.drafts.chat.readVersion(chatDraftIdentity)).not.toBeNull();
    } finally {
      consoleError.mockRestore();
    }
  });

  test("reads current state again after a replay gap", async () => {
    const remote = createRemoteFixture();
    const queryClient = createClientQueryClient();
    const host = createRemoteHostConnection({
      endpoint: "https://host.test/remote",
      version: "mobile-release",
      transport: remote.transport,
      queryClient,
    });
    const connection = createClientConnection({
      host,
      queryClient,
      storage: createMemoryClientStorage(),
      feedback: createFeedbackFake(),
      stageAttachment: async () => "/staged/file.png",
      releaseHost: () => host.remote.disconnect(),
    });
    const controlEvents: ConnectionControlEvent[] = [];
    const stopRunEvents = await host.subscribeRunEvents((payload) => {
      if ("__openducktorConnectionControl" in payload) controlEvents.push(payload);
    });
    const observer = new QueryObserver(queryClient, repoTaskDataQueryOptions(REPO_PATH));
    const stopObserver = observer.subscribe(() => {});
    try {
      await waitForExpectation(() => expect(host.remote.readState().status).toBe("connected"));
      await waitForExpectation(() => expect(remote.taskReads()).toBe(1));

      remote.reportReplayGap();
      await host.remote.retry();

      expect(remote.taskReads()).toBe(2);
      expect(controlEvents).toContainEqual({
        __openducktorConnectionControl: true,
        kind: "reconnected",
        hostChanged: false,
        missedEventNames: ["message"],
        missedEvents: true,
      });
    } finally {
      stopObserver();
      stopRunEvents();
      await connection.dispose();
    }
  });
});

const createRemoteFixture = () => {
  const encoder = new TextEncoder();
  const descriptor: RemoteHostDescriptor = {
    shell: "web",
    appVersion: "host-release",
    hostInstanceId: "host-instance-1",
    accessPolicy: "network_reach",
    protocols: [
      { version: REMOTE_PROTOCOL_VERSION, capabilities: [...REMOTE_BASELINE_CAPABILITIES] },
    ],
  };
  const json = <T>(value: T, status = 200): RemoteHttpResponse => ({
    status,
    headers: {},
    body: (async function* () {
      if (status !== 204) yield encoder.encode(JSON.stringify(value));
    })(),
  });
  const frame = <T>(event: string, data: T) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  const live = (signal: AbortSignal, prefix: string): RemoteHttpResponse => ({
    status: 200,
    headers: {},
    body: (async function* () {
      yield encoder.encode(prefix);
      await new Promise<never>((_resolve, reject) => {
        const abort = () => reject(signal.reason);
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
      });
    })(),
  });
  const notificationEpoch = crypto.randomUUID();
  let gaps: string[] = [];
  let taskReads = 0;
  const transport: RemoteTransport = {
    async request(method, url, _headers, signal) {
      if (url.endsWith("/connections"))
        return json({
          status: "accepted",
          host: descriptor,
          connectionId: crypto.randomUUID(),
          protocolVersion: REMOTE_PROTOCOL_VERSION,
          missingOptionalCapabilities: [],
        });
      if (url.endsWith("/events"))
        return live(
          signal,
          frame("replay-complete", { hostChanged: false, gaps }) +
            frame("notification-frame", {
              type: "attached",
              cursor: { epoch: notificationEpoch, sequence: 1 },
              reason: "new",
              health: [],
            }),
        );
      if (url.endsWith("/invoke/tasks_list")) {
        taskReads += 1;
        return json([]);
      }
      if (method === "DELETE") return json(null, 204);
      if (method === "GET") return json(descriptor);
      throw new Error(`Unexpected request: ${method} ${url}`);
    },
    openTerminal: async () => {
      throw new Error("This fixture opens no terminal.");
    },
  };
  return {
    transport,
    taskReads: () => taskReads,
    reportReplayGap: () => {
      gaps = ["message"];
    },
  };
};
