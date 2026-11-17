import { describe, expect, test } from "bun:test";
import type { SessionMessageInfo } from "@opencode/client";
import { InterruptedTurnResumeError } from "@openducktor/core";
import { openCodeLatestTurn } from "./opencode-interrupted-turn";
import { projectMessages } from "./opencode-message-projection";
import {
  createController,
  cursorPage,
  noContent,
  ref,
  response,
  session,
} from "./opencode-v2.test-support";

const repository = {
  ...ref,
  runtimePolicy: { kind: "opencode" as const },
  sessionScope: { kind: "repository" as const, workspaceId: "repo" },
};
const user = (id: string, text = "Fix the build."): SessionMessageInfo => ({
  id,
  type: "user",
  text,
  time: { created: 2 },
});
const idle = (outcome: "succeeded" | "failed" | "interrupted"): SessionMessageInfo => ({
  id: `idle_${outcome}`,
  type: "idle",
  outcome,
  time: { created: 5 },
});
const continuationRow = user("msg_continue", "");

const controllerFor = (messages: SessionMessageInfo[], active = false) =>
  createController(({ url, method, body }) => {
    if (url.pathname.endsWith("/migration/v1")) return Response.json({ status: "completed" });
    if (url.pathname === "/api/session/active")
      return response(active ? { [ref.externalSessionId]: { type: "busy" } } : {});
    if (url.pathname.endsWith("/message"))
      return cursorPage(
        url.searchParams.get("order") === "desc" ? messages.toReversed() : messages,
      );
    if (url.pathname.endsWith("/prompt"))
      return response({
        id: "msg_continue",
        sessionID: ref.externalSessionId,
        type: "user",
        payload: { text: body.text },
        delivery: "prompt",
        time: { created: 8 },
      });
    if (method === "PATCH" || method === "PUT") return noContent();
    if (url.pathname === "/api/session/ses_saved") return response(session());
    throw new Error(`Unexpected request ${method} ${url.pathname}`);
  });

describe("OpenCode V2 interrupted turn continuation", () => {
  test("continues an unfinished turn with a prompt that has no input", async () => {
    const { controller, requests } = controllerFor([user("msg_user"), idle("failed")]);
    const issued: string[] = [];

    const summary = await controller.continueInterruptedTurn({
      ...repository,
      onWorkIssued: () => issued.push("issued"),
      onWorkAccepted: () => issued.push("accepted"),
    });

    expect(summary).toMatchObject({ externalSessionId: ref.externalSessionId, status: "running" });
    expect(requests.find((request) => request.url.pathname.endsWith("/prompt"))?.body).toEqual({
      text: "",
      delivery: "queue",
    });
    expect(issued).toEqual(["issued", "accepted"]);
  });

  test.each([
    { name: "a live turn", messages: [user("msg_user")], active: true, reason: "live_turn" },
    {
      name: "a completed turn",
      messages: [user("msg_user"), idle("succeeded")],
      active: false,
      reason: "completed_turn",
    },
    { name: "no turn", messages: [], active: false, reason: "ineligible_turn_state" },
  ])("refuses $name without a prompt", async ({ messages, active, reason }) => {
    const { controller, requests } = controllerFor(messages, active);

    const failure = await controller.continueInterruptedTurn(repository).catch((cause) => cause);

    expect(failure).toBeInstanceOf(InterruptedTurnResumeError);
    expect(failure).toMatchObject({ reason });
    expect(requests.some((request) => request.url.pathname.endsWith("/prompt"))).toBe(false);
  });

  test("an earlier continuation row does not count as the latest user turn", () => {
    expect(openCodeLatestTurn([user("msg_user"), idle("failed"), continuationRow])).toBe(
      "unfinished",
    );
    expect(
      openCodeLatestTurn([user("msg_user"), idle("failed"), continuationRow, idle("succeeded")]),
    ).toBe("completed");
  });

  test("history does not show the continuation row", () => {
    const history = projectMessages([user("msg_user"), idle("failed"), continuationRow]);

    expect(history.filter((message) => message.role === "user")).toHaveLength(1);
    expect(history.some((message) => message.messageId === "msg_continue")).toBe(false);
  });
});
