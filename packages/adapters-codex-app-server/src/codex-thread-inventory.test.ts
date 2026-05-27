import { describe, expect, test } from "bun:test";
import { createDeferred } from "./codex-app-server-adapter.test-harness";
import { CodexThreadInventoryReader } from "./codex-thread-inventory";
import type { CodexAppServerClient } from "./types";

const threadListResponse = (id: string, preview: string): unknown => ({
  data: [
    {
      id,
      cwd: "/repo",
      createdAt: 1,
      preview,
      status: { type: "idle" },
    },
  ],
  nextCursor: null,
});

describe("CodexThreadInventoryReader", () => {
  test("does not let a stale in-flight read overwrite a refreshed inventory", async () => {
    const reader = new CodexThreadInventoryReader();
    const firstLoaded = createDeferred<unknown>();
    const firstThreads = createDeferred<unknown>();
    const refreshedLoaded = createDeferred<unknown>();
    const refreshedThreads = createDeferred<unknown>();
    const loadedResponses = [firstLoaded, refreshedLoaded];
    const threadResponses = [firstThreads, refreshedThreads];
    const client = {
      threadLoadedList: () => {
        const response = loadedResponses.shift();
        if (!response) {
          throw new Error("Unexpected thread/loaded/list call.");
        }
        return response.promise;
      },
      threadList: () => {
        const response = threadResponses.shift();
        if (!response) {
          throw new Error("Unexpected thread/list call.");
        }
        return response.promise;
      },
    } as unknown as CodexAppServerClient;

    const staleRead = reader.read(client, "runtime-1");
    const refreshedRead = reader.refresh(client, "runtime-1");
    refreshedLoaded.resolve({ data: ["thread-fresh"], nextCursor: null });
    refreshedThreads.resolve(threadListResponse("thread-fresh", "Fresh inventory"));

    await expect(refreshedRead).resolves.toMatchObject({ runtimeId: "runtime-1" });
    firstLoaded.resolve({ data: ["thread-stale"], nextCursor: null });
    firstThreads.resolve(threadListResponse("thread-stale", "Stale inventory"));
    await expect(staleRead).resolves.toMatchObject({ runtimeId: "runtime-1" });

    const cached = await reader.read(client, "runtime-1");
    expect(cached.threadsById.has("thread-fresh")).toBe(true);
    expect(cached.threadsById.has("thread-stale")).toBe(false);
  });

  test("resumes listed threads for history so Codex can replay restored token usage", async () => {
    const reader = new CodexThreadInventoryReader();
    const calls: string[] = [];
    const client = {
      threadLoadedList: async () => {
        calls.push("thread/loaded/list");
        return { data: [], nextCursor: null };
      },
      threadList: async () => {
        calls.push("thread/list");
        return threadListResponse("thread-idle", "Idle inventory");
      },
      threadResume: async () => {
        calls.push("thread/resume");
        return {
          thread: {
            id: "thread-idle",
            cwd: "/repo",
            status: { type: "idle" },
            turns: [{ id: "turn-1", status: "completed", items: [] }],
          },
        };
      },
      threadRead: async () => {
        calls.push("thread/read");
        throw new Error("thread not loaded: thread-idle");
      },
      threadTurnsList: async () => {
        calls.push("thread/turns/list");
        return { data: [] };
      },
    } as unknown as CodexAppServerClient;

    const attachment = await reader.attachThreadForHistory(client, "runtime-1", {
      externalSessionId: "thread-idle",
      workingDirectory: "/repo",
    });

    expect(attachment).toEqual({
      resumedThread: expect.objectContaining({ id: "thread-idle" }),
      response: {
        thread: expect.objectContaining({
          id: "thread-idle",
          cwd: "/repo",
          turns: [expect.objectContaining({ id: "turn-1" })],
        }),
      },
    });
    expect(calls).toEqual(["thread/loaded/list", "thread/list", "thread/resume"]);
  });

  test("marks loaded idle history resumes as history-only attachments", async () => {
    const reader = new CodexThreadInventoryReader();
    const client = {
      threadLoadedList: async () => ({ data: ["thread-idle"], nextCursor: null }),
      threadList: async () => threadListResponse("thread-idle", "Idle inventory"),
      threadResume: async () => ({
        thread: {
          id: "thread-idle",
          cwd: "/repo",
          status: { type: "idle" },
          turns: [{ id: "turn-1", status: "completed", items: [] }],
        },
      }),
    } as unknown as CodexAppServerClient;

    const attachment = await reader.attachThreadForHistory(client, "runtime-1", {
      externalSessionId: "thread-idle",
      workingDirectory: "/repo",
    });

    expect(attachment).toEqual({
      resumedThread: expect.objectContaining({
        id: "thread-idle",
        status: expect.objectContaining({ agentSessionStatus: "idle" }),
      }),
      response: {
        thread: expect.objectContaining({
          id: "thread-idle",
          cwd: "/repo",
          status: { type: "idle" },
          turns: [expect.objectContaining({ id: "turn-1" })],
        }),
      },
    });
  });
});
