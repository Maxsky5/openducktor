import { describe, expect, test } from "bun:test";
import { isPushedScreen, isRouteInView } from "./pushed-screens";

const route = (key: string, name: string) => ({ key, name });

describe("isPushedScreen", () => {
  test("knows sessions, the tool calls of a session, tasks, and work views", () => {
    expect(isPushedScreen("session")).toBe(true);
    // A swipe returns from the details of a call to its session.
    expect(isPushedScreen("tool-call")).toBe(true);
    expect(isPushedScreen("task/[workspaceId]/[taskId]")).toBe(true);
    expect(isPushedScreen("work/changes")).toBe(true);
    expect(isPushedScreen("composer-options")).toBe(false);
    expect(isPushedScreen("(tabs)")).toBe(false);
  });
});

describe("isRouteInView", () => {
  const tabs = route("tabs", "(tabs)");
  const session = route("session-1", "session");

  test("keeps a route in view under a sheet", () => {
    expect(isRouteInView([tabs, session, route("sheet", "composer-options")], "session-1")).toBe(
      true,
    );
  });

  test("takes a route out of view under a pushed screen", () => {
    expect(isRouteInView([tabs, session, route("changes", "work/changes")], "session-1")).toBe(
      false,
    );
  });

  test("keeps a route that the routes do not hold yet in view", () => {
    expect(isRouteInView([tabs, session, route("changes", "work/changes")], "files-1")).toBe(true);
  });

  test("keeps the top route in view", () => {
    expect(isRouteInView([tabs, session], "session-1")).toBe(true);
  });
});
