import { describe, expect, test } from "bun:test";
import {
  currentAgentSessionReadModelLoadState,
  readyAgentSessionReadModelLoadState,
  unavailableAgentSessionReadModelLoadState,
} from "./agent-session-read-model";

describe("currentAgentSessionReadModelLoadState", () => {
  test("keeps an established repo read model during task refreshes", () => {
    expect(
      currentAgentSessionReadModelLoadState({
        workspaceRepoPath: "/repo",
        state: readyAgentSessionReadModelLoadState("/repo"),
      }),
    ).toEqual(readyAgentSessionReadModelLoadState("/repo"));
  });

  test("loads when task data is pending before a repo read model exists", () => {
    expect(
      currentAgentSessionReadModelLoadState({
        workspaceRepoPath: "/repo",
        state: unavailableAgentSessionReadModelLoadState,
      }),
    ).toEqual({
      kind: "loading",
      workspaceRepoPath: "/repo",
    });
  });
});
