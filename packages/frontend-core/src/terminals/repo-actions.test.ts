import { describe, expect, test } from "bun:test";
import type { RepoAction } from "@openducktor/contracts";
import { splitRepoActions } from "./repo-actions";

const action = (id: string): RepoAction => ({
  id,
  icon: "play",
  name: `Action ${id}`,
  command: "bun run dev",
  runOnWorktreeCreate: false,
  waitBeforeAgentStart: false,
});

describe("splitRepoActions", () => {
  test("puts the default action first and keeps the order of the others", () => {
    expect(
      splitRepoActions({ items: [action("a"), action("b"), action("c")], defaultActionId: "b" }),
    ).toEqual({
      kind: "ready",
      defaultAction: action("b"),
      otherActions: [action("a"), action("c")],
    });
  });

  test("reports an empty list and a missing default action", () => {
    expect(splitRepoActions({ items: [], defaultActionId: null })).toEqual({ kind: "empty" });
    expect(splitRepoActions({ items: [action("a")], defaultActionId: "gone" })).toEqual({
      kind: "missing_default",
    });
  });
});
