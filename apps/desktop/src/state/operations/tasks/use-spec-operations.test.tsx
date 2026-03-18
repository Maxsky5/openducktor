import { describe, expect, mock, test } from "bun:test";
import { defaultSpecTemplateMarkdown } from "@openducktor/contracts";
import { createElement } from "react";
import TestRenderer, { act } from "react-test-renderer";
import { QueryProvider } from "@/lib/query-provider";
import { host } from "../shared/host";
import { useSpecOperations } from "./use-spec-operations";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

type HookArgs = Parameters<typeof useSpecOperations>[0];
type HookResult = ReturnType<typeof useSpecOperations>;

const createHookHarness = (initialArgs: HookArgs) => {
  let latest: HookResult | null = null;

  const Harness = ({ args }: { args: HookArgs }) => {
    latest = useSpecOperations(args);
    return null;
  };

  let renderer: TestRenderer.ReactTestRenderer | null = null;

  return {
    mount: async () => {
      await act(async () => {
        renderer = TestRenderer.create(
          createElement(
            QueryProvider,
            { useIsolatedClient: true },
            createElement(Harness, { args: initialArgs }),
          ),
        );
      });
      await flush();
    },
    run: async (fn: (value: HookResult) => Promise<void> | void) => {
      if (!latest) {
        throw new Error("Hook not mounted");
      }
      await act(async () => {
        await fn(latest as HookResult);
      });
      await flush();
    },
    getLatest: () => {
      if (!latest) {
        throw new Error("Hook not mounted");
      }
      return latest;
    },
    unmount: async () => {
      await act(async () => {
        renderer?.unmount();
      });
      renderer = null;
    },
  };
};

describe("use-spec-operations", () => {
  test("guards operations when no active workspace is selected", async () => {
    const harness = createHookHarness({ activeRepo: null });

    try {
      await harness.mount();
      const api = harness.getLatest();

      await expect(api.loadSpecDocument("task-1")).rejects.toThrow("Select a workspace first.");
      await expect(api.loadPlanDocument("task-1")).rejects.toThrow("Select a workspace first.");
      await expect(api.loadQaReportDocument("task-1")).rejects.toThrow("Select a workspace first.");
      await expect(api.saveSpec("task-1", defaultSpecTemplateMarkdown)).rejects.toThrow(
        "Select a workspace first.",
      );
      await expect(api.saveSpecDocument("task-1", "# doc")).rejects.toThrow(
        "Select a workspace first.",
      );
      await expect(api.savePlanDocument("task-1", "# plan")).rejects.toThrow(
        "Select a workspace first.",
      );
    } finally {
      await harness.unmount();
    }
  });

  test("loadSpec falls back to default template when markdown is empty", async () => {
    const specGet = mock(async () => ({
      markdown: "",
      updatedAt: null,
    }));

    const original = {
      specGet: host.specGet,
    };
    host.specGet = specGet;

    const harness = createHookHarness({ activeRepo: "/repo-a" });

    try {
      await harness.mount();
      const spec = await harness.getLatest().loadSpec("task-1");

      expect(specGet).toHaveBeenCalledWith("/repo-a", "task-1");
      expect(spec).toBe(defaultSpecTemplateMarkdown);
    } finally {
      await harness.unmount();
      host.specGet = original.specGet;
    }
  });

  test("saveSpec rejects invalid markdown and allows retry with valid markdown", async () => {
    const setSpec = mock(async () => ({ updatedAt: "2026-02-22T10:30:00.000Z" }));

    const original = {
      setSpec: host.setSpec,
    };
    host.setSpec = setSpec;

    const harness = createHookHarness({ activeRepo: "/repo-a" });

    try {
      await harness.mount();
      await expect(harness.getLatest().saveSpec("task-1", "# Invalid")).rejects.toThrow(
        "Missing required sections:",
      );
      expect(setSpec).not.toHaveBeenCalled();

      const saved = await harness.getLatest().saveSpec("task-1", defaultSpecTemplateMarkdown);
      expect(saved).toEqual({ updatedAt: "2026-02-22T10:30:00.000Z" });
      expect(setSpec).toHaveBeenCalledWith({
        repoPath: "/repo-a",
        taskId: "task-1",
        markdown: defaultSpecTemplateMarkdown,
      });
    } finally {
      await harness.unmount();
      host.setSpec = original.setSpec;
    }
  });

  test("loads and saves document variants through host adapter", async () => {
    const specGet = mock(async () => ({
      markdown: "# Spec",
      updatedAt: "2026-02-22T10:00:00.000Z",
    }));
    const planGet = mock(async () => ({
      markdown: "# Plan",
      updatedAt: "2026-02-22T10:01:00.000Z",
    }));
    const qaGetReport = mock(async () => ({
      markdown: "# QA",
      updatedAt: "2026-02-22T10:02:00.000Z",
    }));
    const saveSpecDocument = mock(async () => ({ updatedAt: "2026-02-22T10:03:00.000Z" }));
    const savePlanDocument = mock(async () => ({ updatedAt: "2026-02-22T10:04:00.000Z" }));

    const original = {
      specGet: host.specGet,
      planGet: host.planGet,
      qaGetReport: host.qaGetReport,
      saveSpecDocument: host.saveSpecDocument,
      savePlanDocument: host.savePlanDocument,
    };
    host.specGet = specGet;
    host.planGet = planGet;
    host.qaGetReport = qaGetReport;
    host.saveSpecDocument = saveSpecDocument;
    host.savePlanDocument = savePlanDocument;

    const harness = createHookHarness({ activeRepo: "/repo-a" });

    try {
      await harness.mount();
      const api = harness.getLatest();

      await expect(api.loadSpecDocument("task-1")).resolves.toEqual({
        markdown: "# Spec",
        updatedAt: "2026-02-22T10:00:00.000Z",
      });
      await expect(api.loadPlanDocument("task-1")).resolves.toEqual({
        markdown: "# Plan",
        updatedAt: "2026-02-22T10:01:00.000Z",
      });
      await expect(api.loadQaReportDocument("task-1")).resolves.toEqual({
        markdown: "# QA",
        updatedAt: "2026-02-22T10:02:00.000Z",
      });

      await expect(api.saveSpecDocument("task-1", "# Spec Doc")).resolves.toEqual({
        updatedAt: "2026-02-22T10:03:00.000Z",
      });
      await expect(api.savePlanDocument("task-1", "# Plan Doc")).resolves.toEqual({
        updatedAt: "2026-02-22T10:04:00.000Z",
      });

      expect(specGet).toHaveBeenCalledWith("/repo-a", "task-1");
      expect(planGet).toHaveBeenCalledWith("/repo-a", "task-1");
      expect(qaGetReport).toHaveBeenCalledWith("/repo-a", "task-1");
      expect(saveSpecDocument).toHaveBeenCalledWith({
        repoPath: "/repo-a",
        taskId: "task-1",
        markdown: "# Spec Doc",
      });
      expect(savePlanDocument).toHaveBeenCalledWith({
        repoPath: "/repo-a",
        taskId: "task-1",
        markdown: "# Plan Doc",
      });
    } finally {
      await harness.unmount();
      host.specGet = original.specGet;
      host.planGet = original.planGet;
      host.qaGetReport = original.qaGetReport;
      host.saveSpecDocument = original.saveSpecDocument;
      host.savePlanDocument = original.savePlanDocument;
    }
  });
});
