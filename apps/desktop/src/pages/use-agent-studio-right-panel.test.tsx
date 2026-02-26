import { describe, expect, test } from "bun:test";
import {
  createHookHarness as createSharedHookHarness,
  enableReactActEnvironment,
} from "./agent-studio-test-utils";
import { useAgentStudioRightPanel } from "./use-agent-studio-right-panel";

enableReactActEnvironment();

type HookArgs = Parameters<typeof useAgentStudioRightPanel>[0];

const createHookHarness = (initialProps: HookArgs) =>
  createSharedHookHarness(useAgentStudioRightPanel, initialProps);

describe("useAgentStudioRightPanel", () => {
  test("returns documents panel open by default for spec role when available", async () => {
    const harness = createHookHarness({
      role: "spec",
      hasDocumentPanel: true,
    });

    await harness.mount();

    expect(harness.getLatest().panelKind).toBe("documents");
    expect(harness.getLatest().isPanelOpen).toBe(true);
    expect(harness.getLatest().rightPanelToggleModel?.kind).toBe("documents");

    await harness.unmount();
  });

  test("hides panel and toggle when no task context is active", async () => {
    const harness = createHookHarness({
      role: "spec",
      hasTaskContext: false,
      hasDocumentPanel: true,
    });

    await harness.mount();

    expect(harness.getLatest().panelKind).toBeNull();
    expect(harness.getLatest().isPanelOpen).toBe(false);
    expect(harness.getLatest().rightPanelToggleModel).toBeNull();

    await harness.unmount();
  });

  test("persists open state per role when switching roles", async () => {
    const harness = createHookHarness({
      role: "spec",
      hasDocumentPanel: true,
    });

    await harness.mount();
    await harness.run((state) => {
      state.rightPanelToggleModel?.onToggle();
    });

    expect(harness.getLatest().isPanelOpen).toBe(false);

    await harness.update({
      role: "planner",
      hasDocumentPanel: true,
    });
    expect(harness.getLatest().isPanelOpen).toBe(true);

    await harness.update({
      role: "spec",
      hasDocumentPanel: true,
    });
    expect(harness.getLatest().isPanelOpen).toBe(false);

    await harness.unmount();
  });

  test("hides panel and toggle when role panel kind is unavailable", async () => {
    const harness = createHookHarness({
      role: "build",
      hasDocumentPanel: false,
      hasDiffPanel: false,
    });

    await harness.mount();

    expect(harness.getLatest().panelKind).toBeNull();
    expect(harness.getLatest().isPanelOpen).toBe(false);
    expect(harness.getLatest().rightPanelToggleModel).toBeNull();

    await harness.unmount();
  });

  test("uses diff panel state for build role when available", async () => {
    const harness = createHookHarness({
      role: "build",
      hasDocumentPanel: false,
      hasDiffPanel: true,
    });

    await harness.mount();
    expect(harness.getLatest().panelKind).toBe("diff");
    expect(harness.getLatest().isPanelOpen).toBe(false);

    await harness.run((state) => {
      state.rightPanelToggleModel?.onToggle();
    });
    expect(harness.getLatest().isPanelOpen).toBe(true);

    await harness.update({
      role: "spec",
      hasDocumentPanel: true,
      hasDiffPanel: true,
    });
    expect(harness.getLatest().panelKind).toBe("documents");
    expect(harness.getLatest().isPanelOpen).toBe(true);

    await harness.update({
      role: "build",
      hasDocumentPanel: false,
      hasDiffPanel: true,
    });
    expect(harness.getLatest().panelKind).toBe("diff");
    expect(harness.getLatest().isPanelOpen).toBe(true);

    await harness.unmount();
  });
});
