import { describe, expect, test } from "bun:test";
import { reportSettingsSaveFollowUps, requireSavedSettings } from "./runtime-settings-application";

describe("settings save follow-up reporting", () => {
  test("reports a failed runtime change and a failed reload apart from the save", () => {
    const warnings: Array<[string, string]> = [];

    reportSettingsSaveFollowUps(
      {
        type: "saved",
        workspaces: [],
        runtimeApplications: [
          { kind: "codex", effect: "start", outcome: "failed", message: "Codex is missing." },
          { kind: "opencode", effect: "stop", outcome: "applied", message: null },
        ],
        refreshError: "settings read failed",
      },
      (title, description) => warnings.push([title, description]),
    );

    expect(warnings).toEqual([
      [
        "Settings saved, but a runtime change failed",
        "Codex: Codex is missing. Check Diagnostics to restart the runtime or retry the change.",
      ],
      [
        "Settings saved, but the app could not reload them",
        "settings read failed Reopen Settings to see the saved values.",
      ],
    ]);
  });

  test("reports nothing for a clean save", () => {
    const warnings: string[] = [];
    reportSettingsSaveFollowUps(
      { type: "saved", workspaces: [], runtimeApplications: [], refreshError: null },
      (title) => warnings.push(title),
    );
    expect(warnings).toEqual([]);
  });

  test("a save that needs a runtime review fails with the next action", () => {
    expect(() =>
      requireSavedSettings({
        type: "runtime_impact_changed",
        impact: { kinds: [], workspaces: [], confirmation: "token" },
      }),
    ).toThrow("Open Settings to review the sessions, then save again.");
  });
});
