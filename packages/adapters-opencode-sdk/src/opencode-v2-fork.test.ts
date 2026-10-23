import { describe, expect, test } from "bun:test";
import type { SessionMessageInfo, V2Event } from "@opencode/client";
import { OpenCodeLiveMessageProjector } from "./opencode-live-message-projector";
import {
  createController,
  cursorPage,
  model,
  noContent,
  ref,
  response,
  session,
  type NativeRequest,
} from "./opencode-v2.test-support";

const reply = (): SessionMessageInfo => ({
  id: "msg_reply",
  type: "assistant",
  time: { created: 2, completed: 3 },
  model,
  agent: "build",
  finish: "stop",
  content: [{ type: "text", text: "Completed reply" }],
});
const transcript = (): SessionMessageInfo[] => [
  { id: "msg_user", type: "user", text: "First turn", time: { created: 1 } },
  reply(),
  { id: "msg_idle", type: "idle", outcome: "succeeded", time: { created: 4 } },
];
const input = () => ({
  repoPath: ref.repoPath,
  runtimeKind: ref.runtimeKind,
  runtimePolicy: { kind: "opencode" as const },
  sessionScope: { kind: "repository" as const },
  workingDirectory: ref.workingDirectory,
  sourceWorkingDirectory: ref.workingDirectory,
  parentExternalSessionId: ref.externalSessionId,
  forkPoint: { messageId: "msg_reply" },
});

describe("OpenCode reply forks", () => {
  test.each(["earlier", "terminal"] as const)(
    "forks the exact %s reply while leaving source activity and input alone",
    async (position) => {
      const messages = transcript();
      if (position === "earlier")
        messages.push(
          { id: "msg_next", type: "user", text: "Later turn", time: { created: 5 } },
          { ...reply(), id: "msg_running", finish: undefined, time: { created: 6 } },
        );
      const boundary =
        position === "earlier"
          ? { type: "before" as const, messageID: "msg_next" }
          : { type: "through" as const, messageID: "msg_idle" };
      const child = session({
        id: "ses_fork",
        fork: { sessionID: ref.externalSessionId, boundary },
      });
      const { controller, requests } = createController(({ url, method, body }) => {
        if (url.pathname.endsWith("/migration/v1")) return Response.json({ status: "completed" });
        if (url.pathname === "/api/session/ses_saved") return response(session());
        if (url.pathname.endsWith("/message")) return cursorPage(messages);
        if (url.pathname.endsWith("/fork")) return response(child);
        if (url.pathname === "/api/session/active")
          return response({ ses_saved: { type: "running" } });
        if (method === "PATCH") {
          Object.assign(child, body);
          return noContent();
        }
        if (url.pathname === "/api/session/ses_fork") return response(child);
        throw new Error(`Unexpected reply fork request ${method} ${url.pathname}`);
      });
      const summary = await controller.forkSession(input());
      expect(summary).toMatchObject({ externalSessionId: "ses_fork", status: "idle" });
      const nativeFork = requests.find(({ url }) => url.pathname.endsWith("/fork"));
      expect(nativeFork?.body).toEqual(position === "earlier" ? { before: "msg_next" } : {});
      expect(
        requests.filter(
          ({ method, url }) => method !== "GET" && url.pathname.includes("ses_saved"),
        ),
      ).toEqual([nativeFork!]);
      expect(
        requests.some(({ url }) =>
          /\/(prompt|interrupt|inbox|permission|form)$/.test(url.pathname),
        ),
      ).toBe(false);
      expect(controller.bindings.has(ref.externalSessionId)).toBe(false);
    },
  );

  test("moves only the idle child before destination MCP and policy installation", async () => {
    const child = session({
      id: "ses_fork",
      fork: {
        sessionID: ref.externalSessionId,
        boundary: { type: "through", messageID: "msg_idle" },
      },
    });
    const stages: string[] = [];
    const { controller, requests } = createController(({ url, method, body }) => {
      if (url.pathname.endsWith("/migration/v1")) return Response.json({ status: "completed" });
      if (url.pathname === "/api/session/ses_saved") return response(session());
      if (url.pathname.endsWith("/message")) return cursorPage(transcript());
      if (url.pathname.endsWith("/fork")) return response(child);
      if (url.pathname === "/api/session/active") return response({});
      if (url.pathname.endsWith("/move")) {
        stages.push("move");
        child.location = { directory: String(body.directory) };
        return noContent();
      }
      if (method === "PATCH") {
        stages.push("policy");
        Object.assign(child, body);
        return noContent();
      }
      if (url.pathname === "/api/session/ses_fork") return response(child);
      throw new Error(`Unexpected relocation request ${method} ${url.pathname}`);
    });
    controller.hooks.ensureMcp = async ({ workingDirectory }) => {
      expect(workingDirectory).toBe("/repo/fork");
      stages.push("mcp");
    };
    const summary = await controller.forkSession({ ...input(), workingDirectory: "/repo/fork" });
    expect(summary).toMatchObject({ workingDirectory: "/repo/fork", status: "idle" });
    expect(stages).toEqual(["move", "mcp", "policy"]);
    expect(requests.find(({ url }) => url.pathname.endsWith("/move"))?.body).toEqual({
      directory: "/repo/fork",
    });
    expect(requests.some(({ url }) => url.pathname === "/api/session/ses_saved/move")).toBe(false);
  });

  test.each(["missing", "unfinished", "failed", "ambiguous"] as const)(
    "refuses a %s reply before native fork creation",
    async (condition) => {
      const messages = transcript();
      if (condition === "missing") messages.splice(1, 1);
      if (condition === "unfinished") messages.pop();
      if (condition === "failed")
        messages[2] = { ...messages[2]!, type: "idle", outcome: "failed" };
      if (condition === "ambiguous") messages.push({ ...reply(), id: "msg_other" });
      const { controller, requests } = createController(({ url, method }) => {
        if (url.pathname.endsWith("/migration/v1")) return Response.json({ status: "completed" });
        if (url.pathname === "/api/session/ses_saved") return response(session());
        if (url.pathname.endsWith("/message")) return cursorPage(messages);
        throw new Error(`Unexpected invalid reply request ${method} ${url.pathname}`);
      });
      await expect(controller.forkSession(input())).rejects.toThrow(
        condition === "ambiguous" ? "later native assistant" : "has not completed successfully",
      );
      expect(requests.every(({ method }) => method === "GET")).toBe(true);
    },
  );

  test.each([
    "boundary",
    "concurrent_endpoint",
    "confirmed_source",
    "running_child",
    "move",
    "cleanup",
  ] as const)("removes only the child when reply fork setup fails at %s", async (failure) => {
    const child = session({
      id: "ses_fork",
      fork: {
        sessionID: ref.externalSessionId,
        boundary: {
          type: failure === "boundary" ? "before" : "through",
          messageID: failure === "concurrent_endpoint" ? "msg_later" : "msg_idle",
        },
      },
    });
    const handle = ({ url, method, body }: NativeRequest) => {
      if (url.pathname.endsWith("/migration/v1")) return Response.json({ status: "completed" });
      if (url.pathname === "/api/session/ses_saved") return response(session());
      if (url.pathname.endsWith("/message")) return cursorPage(transcript());
      if (url.pathname.endsWith("/fork")) return response(child);
      if (url.pathname === "/api/session/active")
        return response(failure === "running_child" ? { ses_fork: { type: "running" } } : {});
      if (failure === "confirmed_source") {
        if (method === "PATCH") {
          Object.assign(child, body);
          return noContent();
        }
        if (method === "GET" && url.pathname === "/api/session/ses_fork")
          return response({ ...child, fork: { ...child.fork!, sessionID: "ses_other" } });
      }
      if (url.pathname.endsWith("/move"))
        return Response.json({ message: "Move failed" }, { status: 503 });
      if (method === "DELETE")
        return failure === "cleanup"
          ? Response.json({ message: "Cleanup failed" }, { status: 503 })
          : noContent();
      throw new Error(`Unexpected failed fork request ${method} ${url.pathname}`);
    };
    const { controller, requests } = createController(handle);
    const request = input();
    if (failure === "move" || failure === "cleanup") request.workingDirectory = "/repo/fork";
    const result = await controller.forkSession(request).catch((cause: unknown) => cause);
    expect(result).toBeInstanceOf(Error);
    if (failure === "confirmed_source")
      expect(result).toMatchObject({
        failure: { runtimeOperationFailure: { code: "identity_mismatch" } },
      });
    if (failure === "cleanup")
      expect(String(result)).toContain("ses_fork' failed setup and cleanup");
    expect(
      requests.filter(({ method }) => method === "DELETE").map(({ url }) => url.pathname),
    ).toEqual(["/api/session/ses_fork"]);
    expect(requests.some(({ url }) => url.pathname.endsWith("/prompt"))).toBe(false);
    expect(controller.bindings.has("ses_fork")).toBe(false);
  });
});

describe("OpenCode completed reply projection", () => {
  test.each(["succeeded", "failed", "interrupted"] as const)(
    "adds a fork point only after a %s execution, live and in history",
    (outcome) => {
      const projector = new OpenCodeLiveMessageProjector();
      projector.seed(transcript().slice(0, 2));
      expect(projector.projectHistory(transcript().slice(0, 2))[1]?.forkPoint).toBeUndefined();
      expect(
        projector
          .snapshotEvents(ref.externalSessionId)
          .find((event) => event.type === "assistant_message"),
      ).not.toHaveProperty("forkPoint");
      const base = {
        id: "evt_idle",
        created: 4,
        durable: { aggregateID: ref.externalSessionId, seq: 1, version: 1 as const },
      };
      const event: V2Event =
        outcome === "failed"
          ? {
              ...base,
              type: "session.execution.failed",
              data: { sessionID: ref.externalSessionId, error: { message: "Turn failed" } },
            }
          : outcome === "interrupted"
            ? {
                ...base,
                type: "session.execution.interrupted",
                data: { sessionID: ref.externalSessionId, reason: "user" },
              }
            : {
                ...base,
                type: "session.execution.succeeded",
                data: { sessionID: ref.externalSessionId },
              };
      const events = projector.apply(event);
      const completed = events.find((event) => event.type === "assistant_message");
      const history = projector.projectHistory([
        ...transcript().slice(0, 2),
        { id: "msg_idle", type: "idle", outcome, time: { created: 4 } },
      ]);
      if (outcome === "succeeded") {
        expect(completed).toMatchObject({ forkPoint: { messageId: "msg_reply" } });
        expect(history[1]?.forkPoint).toEqual({ messageId: "msg_reply" });
        expect(projector.projectHistory(transcript().slice(0, 2))[1]?.forkPoint).toEqual({
          messageId: "msg_reply",
        });
      } else {
        expect(completed).toBeUndefined();
        expect(history[1]?.forkPoint).toBeUndefined();
      }
    },
  );
});
