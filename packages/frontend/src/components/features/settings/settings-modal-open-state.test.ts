import { describe, expect, test } from "bun:test";
import { INITIAL_NAVIGATION, getOpenState } from "./settings-modal-open-state";

describe("getOpenState", () => {
  test("opens notifications", () => {
    expect(
      getOpenState({ kind: "global", section: "notifications" }, INITIAL_NAVIGATION).navigation
        .section,
    ).toBe("notifications");
  });

  test("opens scripts for the requested repository", () => {
    expect(
      getOpenState(
        {
          kind: "repository-dev-servers",
          repositoryPath: "/repo-two",
        },
        INITIAL_NAVIGATION,
      ),
    ).toEqual({
      workspaceSelectionPolicy: {
        kind: "required",
        repoPath: "/repo-two",
      },
      navigation: {
        ...INITIAL_NAVIGATION,
        section: "repositories",
        repositorySection: "scripts",
      },
      focusRequest: {
        kind: "repository-dev-servers",
      },
    });
  });

  test("opens the tab of the requested runtime", () => {
    expect(getOpenState({ kind: "runtime", runtimeKind: "claude" }, INITIAL_NAVIGATION)).toEqual({
      workspaceSelectionPolicy: undefined,
      navigation: { ...INITIAL_NAVIGATION, section: "runtimes" },
      focusRequest: { kind: "runtime-executable", runtimeKind: "claude" },
    });
  });

  test("opens at the initial section", () => {
    expect(getOpenState(undefined, INITIAL_NAVIGATION)).toEqual({
      navigation: INITIAL_NAVIGATION,
      workspaceSelectionPolicy: undefined,
      focusRequest: null,
    });
  });
});
