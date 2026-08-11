import { describe, expect, test } from "bun:test";
import type { AgentSessionScope } from "@openducktor/contracts";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import { useStableAgentSessionScope } from "./use-stable-agent-session-scope";

const createHarness = (scope: AgentSessionScope | null | undefined) =>
  createHookHarness(useStableAgentSessionScope, scope);

describe("useStableAgentSessionScope", () => {
  test("returns repository scope", async () => {
    const harness = createHarness({ kind: "repository" });

    try {
      await harness.mount();
      expect(harness.getLatest()).toEqual({ kind: "repository" });
    } finally {
      await harness.unmount();
    }
  });

  test("returns workflow scope", async () => {
    const harness = createHarness({
      kind: "workflow",
      taskId: "task-1",
      role: "build",
    });

    try {
      await harness.mount();
      expect(harness.getLatest()).toEqual({
        kind: "workflow",
        taskId: "task-1",
        role: "build",
      });
    } finally {
      await harness.unmount();
    }
  });

  test("maps null and undefined scope to null", async () => {
    const harness = createHarness(null);

    try {
      await harness.mount();
      expect(harness.getLatest()).toBeNull();

      await harness.update(undefined);
      expect(harness.getLatest()).toBeNull();
    } finally {
      await harness.unmount();
    }
  });

  test("preserves repository scope identity across equal-value rerenders", async () => {
    const harness = createHarness({ kind: "repository" });

    try {
      await harness.mount();
      const initialScope = harness.getLatest();

      await harness.update({ kind: "repository" });
      expect(harness.getLatest()).toBe(initialScope);
    } finally {
      await harness.unmount();
    }
  });

  test("preserves workflow scope identity across equal-value rerenders", async () => {
    const harness = createHarness({
      kind: "workflow",
      taskId: "task-1",
      role: "build",
    });

    try {
      await harness.mount();
      const initialScope = harness.getLatest();

      await harness.update({
        kind: "workflow",
        taskId: "task-1",
        role: "build",
      });
      expect(harness.getLatest()).toBe(initialScope);
    } finally {
      await harness.unmount();
    }
  });

  test("updates scope identity when a discriminated value changes", async () => {
    const harness = createHarness({
      kind: "workflow",
      taskId: "task-1",
      role: "build",
    });

    try {
      await harness.mount();
      const initialScope = harness.getLatest();

      await harness.update({
        kind: "workflow",
        taskId: "task-1",
        role: "qa",
      });
      const changedWorkflowScope = harness.getLatest();
      expect(changedWorkflowScope).not.toBe(initialScope);
      expect(changedWorkflowScope).toEqual({
        kind: "workflow",
        taskId: "task-1",
        role: "qa",
      });

      await harness.update({ kind: "repository" });
      expect(harness.getLatest()).not.toBe(changedWorkflowScope);
      expect(harness.getLatest()).toEqual({ kind: "repository" });
    } finally {
      await harness.unmount();
    }
  });
});
