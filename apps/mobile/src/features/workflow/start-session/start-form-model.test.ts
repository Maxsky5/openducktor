import { describe, expect, test } from "bun:test";
import type { SessionStartSourceOption } from "@openducktor/frontend-core/sessions/start/session-start-modal-model";
import type { ModelPickerValue } from "@openducktor/frontend-core/sessions/model-selection/model-picker-model";
import type { SpeedControlModel } from "@openducktor/frontend-core/sessions/model-selection/use-speed-control";
import {
  reportingChoices,
  reportingSpeed,
  startFormSections,
  startModeOptions,
  titleCase,
} from "./start-form-model";

const source: SessionStartSourceOption = {
  value: "b-1",
  label: "Builder session",
  sourceSession: { externalSessionId: "b-1", runtimeKind: "opencode", workingDirectory: "/wt" },
};

describe("startModeOptions", () => {
  test("offers the modes that the action allows, in desktop order, with the desktop labels", () => {
    expect(
      startModeOptions({
        availableStartModes: ["fork", "reuse", "fresh"],
        existingSessionOptions: [source],
      }),
    ).toEqual([
      { value: "fresh", label: "Start fresh", disabled: false },
      { value: "reuse", label: "Reuse existing", disabled: false },
      { value: "fork", label: "Fork existing", disabled: false },
    ]);
  });

  test("disables reuse and fork when the task has no session to start from", () => {
    expect(
      startModeOptions({
        availableStartModes: ["fresh", "reuse", "fork"],
        existingSessionOptions: [],
      }).map((option) => option.disabled),
    ).toEqual([false, true, true]);
  });

  test("offers no choice when the action allows one mode", () => {
    expect(
      startModeOptions({ availableStartModes: ["fresh"], existingSessionOptions: [source] }),
    ).toEqual([]);
  });
});

describe("startFormSections", () => {
  test("reuse and fork ask for the source session", () => {
    expect(
      startFormSections({
        selectedStartMode: "reuse",
        showTargetBranchSelector: false,
        supportsProfiles: true,
      }),
    ).toEqual({ sourceSession: true, targetBranch: false, profile: true });
  });

  test("a fresh start shows the branch and the profile that the runtime supports", () => {
    expect(
      startFormSections({
        selectedStartMode: "fresh",
        showTargetBranchSelector: true,
        supportsProfiles: false,
      }),
    ).toEqual({ sourceSession: false, targetBranch: true, profile: false });
  });
});

describe("titleCase", () => {
  test("gives a desktop label the title case of mobile buttons", () => {
    expect(titleCase("Start session")).toBe("Start Session");
    expect(titleCase("Run in background")).toBe("Run in Background");
  });
});

describe("reportingChoices", () => {
  const recorder = () => {
    const calls: string[] = [];
    const record =
      (name: string) =>
      (value: string | ModelPickerValue): void => {
        calls.push(`${name}:${JSON.stringify(value)}`);
      };
    return {
      calls,
      handlers: {
        onSelectStartMode: record("mode"),
        onSelectSourceSessionValue: record("source"),
        onSelectRuntimeProfile: record("profile"),
        onSelectModelPair: record("model"),
        onSelectVariant: record("variant"),
        onSelectTargetBranch: record("branch"),
      },
    };
  };

  test("reports the edit before each choice reaches the start", () => {
    const { calls, handlers } = recorder();
    const choices = reportingChoices(handlers, () => calls.push("edit"));

    choices.onSelectStartMode("fork");
    choices.onSelectSourceSessionValue("b-1");
    choices.onSelectRuntimeProfile("build");
    choices.onSelectModelPair({ runtimeKind: "opencode", providerId: "p", modelId: "m" });
    choices.onSelectVariant("high");
    choices.onSelectTargetBranch?.("refs/heads/main");

    expect(calls).toEqual([
      "edit",
      'mode:"fork"',
      "edit",
      'source:"b-1"',
      "edit",
      'profile:"build"',
      "edit",
      'model:{"runtimeKind":"opencode","providerId":"p","modelId":"m"}',
      "edit",
      'variant:"high"',
      "edit",
      'branch:"refs/heads/main"',
    ]);
  });

  test("keeps a start without a target branch choice without one", () => {
    const { handlers } = recorder();
    const { onSelectTargetBranch: _branch, ...withoutBranch } = handlers;

    expect(reportingChoices(withoutBranch, () => {}).onSelectTargetBranch).toBeUndefined();
  });
});

describe("reportingSpeed", () => {
  test("reports the edit before the speed changes", () => {
    const calls: string[] = [];
    const control: SpeedControlModel = {
      key: "k",
      choice: "standard",
      levels: [],
      blockedReason: undefined,
      pending: false,
      disabled: false,
      error: null,
      onChange: (choice) => calls.push(choice),
    };

    reportingSpeed(control, () => calls.push("edit"))?.onChange("fast");

    expect(calls).toEqual(["edit", "fast"]);
    expect(reportingSpeed(null, () => {})).toBeNull();
  });
});
