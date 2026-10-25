import { describe, expect, test } from "bun:test";
import { buildWorkViewLinks } from "./work-view-links";

describe("buildWorkViewLinks", () => {
  test("lists the task work views", () => {
    const links = buildWorkViewLinks({ workspaceId: "ws", taskId: "task-1" });
    expect(links.map((link) => link.label)).toEqual([
      "Changes",
      "Files",
      "Artifacts",
      "CI Checks",
      "Terminals",
    ]);
    expect(new Set(links.map((link) => link.icon)).size).toBe(links.length);
    expect(links[2]?.route).toEqual({
      pathname: "/work/artifacts",
      params: { workspaceId: "ws", taskId: "task-1" },
    });
  });

  test("lists the chat work views", () => {
    const owner = {
      workspaceId: "ws",
      externalSessionId: "session-1",
      runtimeKind: "opencode",
      workingDirectory: "/repo",
    };
    const links = buildWorkViewLinks(owner);
    expect(links.map((link) => link.label)).toEqual(["Changes", "Files", "Terminals"]);
    expect(links[0]?.route).toEqual({ pathname: "/work/changes", params: owner });
  });

  test("lists nothing for a session without an owner", () => {
    expect(buildWorkViewLinks(null)).toEqual([]);
  });
});
