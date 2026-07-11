import { describe, expect, test } from "bun:test";
import {
  INITIAL_SETTINGS_MODAL_NAVIGATION,
  resolveSettingsModalOpenState,
} from "./settings-modal-open-state";

describe("resolveSettingsModalOpenState", () => {
  test("opens a repository deep link at its complete destination", () => {
    expect(
      resolveSettingsModalOpenState({
        kind: "repository-dev-servers",
        repositoryPath: "/repo-two",
      }),
    ).toEqual({
      deepLinkResolution: {
        scope: "repository",
        navigation: {
          section: "repositories",
          repositorySection: "scripts",
        },
        workspaceSelectionPolicy: {
          kind: "required",
          repoPath: "/repo-two",
        },
        contentFocus: {
          kind: "repository-dev-servers",
        },
      },
      navigation: {
        ...INITIAL_SETTINGS_MODAL_NAVIGATION,
        section: "repositories",
        repositorySection: "scripts",
      },
      contentFocusRequest: {
        kind: "repository-dev-servers",
      },
    });
  });

  test("resets ordinary opens to the initial navigation state", () => {
    expect(resolveSettingsModalOpenState(undefined)).toEqual({
      deepLinkResolution: null,
      navigation: INITIAL_SETTINGS_MODAL_NAVIGATION,
      contentFocusRequest: null,
    });
  });
});
