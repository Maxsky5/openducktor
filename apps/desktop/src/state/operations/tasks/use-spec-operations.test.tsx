import { describe, expect, mock, test } from "bun:test";
import { defaultSpecTemplateMarkdown } from "@openducktor/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren, ReactElement } from "react";
import { QueryProvider } from "@/lib/query-provider";
import { documentQueryKeys } from "@/state/queries/documents";
import { taskQueryKeys } from "@/state/queries/tasks";
import { createHookHarness as createSharedHookHarness } from "@/test-utils/react-hook-harness";
import { host } from "../shared/host";
import { useSpecOperations } from "./use-spec-operations";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

type HookArgs = Parameters<typeof useSpecOperations>[0];
type HookResult = ReturnType<typeof useSpecOperations>;

const createHookHarness = (initialArgs: HookArgs) => {
  let latest: HookResult | null = null;
  const currentArgs = initialArgs;

  const Harness = ({ args }: { args: HookArgs }) => {
    latest = useSpecOperations(args);
    return null;
  };

  const wrapper = ({ children }: PropsWithChildren): ReactElement => (
    <QueryProvider useIsolatedClient>{children}</QueryProvider>
  );

  const sharedHarness = createSharedHookHarness(Harness, { args: currentArgs }, { wrapper });

  return {
    mount: async () => {
      await sharedHarness.mount();
    },
    run: async (fn: (value: HookResult) => Promise<void> | void) => {
      if (!latest) {
        throw new Error("Hook not mounted");
      }
      await sharedHarness.run(async () => {
        await fn(latest as HookResult);
      });
    },
    getLatest: () => {
      if (!latest) {
        throw new Error("Hook not mounted");
      }
      return latest;
    },
    unmount: async () => {
      await sharedHarness.unmount();
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

  test("invalidates all task-document caches and task list cache after document saves", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
    const wrapper = ({ children }: PropsWithChildren): ReactElement => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    let latest: HookResult | null = null;
    const Harness = ({ args }: { args: HookArgs }) => {
      latest = useSpecOperations(args);
      return null;
    };

    const harness = createSharedHookHarness(
      Harness,
      { args: { activeRepo: "/repo-a" } },
      { wrapper },
    );

    const saveSpecDocument = mock(async () => ({ updatedAt: "2026-02-22T10:03:00.000Z" }));
    const savePlanDocument = mock(async () => ({ updatedAt: "2026-02-22T10:04:00.000Z" }));
    const original = {
      saveSpecDocument: host.saveSpecDocument,
      savePlanDocument: host.savePlanDocument,
    };
    host.saveSpecDocument = saveSpecDocument;
    host.savePlanDocument = savePlanDocument;

    queryClient.setQueryData(documentQueryKeys.spec("/repo-a", "task-1"), {
      markdown: "# Old spec",
      updatedAt: "2026-02-22T10:00:00.000Z",
    });
    queryClient.setQueryData(["task-documents", "spec", "", "task-1"], {
      markdown: "# Old spec (empty scope key)",
      updatedAt: "2026-02-22T10:00:00.000Z",
    });
    queryClient.setQueryData(documentQueryKeys.plan("/repo-a", "task-1"), {
      markdown: "# Old plan",
      updatedAt: "2026-02-22T10:00:00.000Z",
    });
    queryClient.setQueryData(["task-documents", "plan", "", "task-1"], {
      markdown: "# Old plan (empty scope key)",
      updatedAt: "2026-02-22T10:00:00.000Z",
    });
    queryClient.setQueryData(taskQueryKeys.repoData("/repo-a"), {
      tasks: [],
      runs: [],
    });

    try {
      await harness.mount();
      if (!latest) {
        throw new Error("Hook not mounted");
      }

      await harness.run(async () => {
        await latest?.saveSpecDocument("task-1", "# New spec");
        await latest?.savePlanDocument("task-1", "# New plan");
      });

      const cachedSpec = queryClient.getQueryData<{
        markdown: string;
        updatedAt: string | null;
      }>(documentQueryKeys.spec("/repo-a", "task-1"));
      const cachedPlan = queryClient.getQueryData<{
        markdown: string;
        updatedAt: string | null;
      }>(documentQueryKeys.plan("/repo-a", "task-1"));

      expect(cachedSpec?.markdown).toBe("# New spec");
      expect(cachedSpec?.updatedAt).toBe("2026-02-22T10:03:00.000Z");
      expect(cachedPlan?.markdown).toBe("# New plan");
      expect(cachedPlan?.updatedAt).toBe("2026-02-22T10:04:00.000Z");

      expect(
        queryClient.getQueryState(["task-documents", "spec", "", "task-1"])?.isInvalidated,
      ).toBe(true);
      expect(
        queryClient.getQueryState(["task-documents", "plan", "", "task-1"])?.isInvalidated,
      ).toBe(true);
      expect(queryClient.getQueryState(taskQueryKeys.repoData("/repo-a"))?.isInvalidated).toBe(
        true,
      );
    } finally {
      await harness.unmount();
      host.saveSpecDocument = original.saveSpecDocument;
      host.savePlanDocument = original.savePlanDocument;
      queryClient.clear();
    }
  });

  test("saveSpec updates spec cache and invalidates shared document/task caches", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
    const wrapper = ({ children }: PropsWithChildren): ReactElement => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    let latest: HookResult | null = null;
    const Harness = ({ args }: { args: HookArgs }) => {
      latest = useSpecOperations(args);
      return null;
    };

    const harness = createSharedHookHarness(
      Harness,
      { args: { activeRepo: "/repo-a" } },
      { wrapper },
    );

    const setSpec = mock(async () => ({ updatedAt: "2026-02-22T10:06:00.000Z" }));
    const original = {
      setSpec: host.setSpec,
    };
    host.setSpec = setSpec;

    queryClient.setQueryData(documentQueryKeys.spec("/repo-a", "task-1"), {
      markdown: "# Old spec",
      updatedAt: "2026-02-22T10:00:00.000Z",
    });
    queryClient.setQueryData(["task-documents", "spec", "", "task-1"], {
      markdown: "# Old spec (empty scope key)",
      updatedAt: "2026-02-22T10:00:00.000Z",
    });
    queryClient.setQueryData(taskQueryKeys.repoData("/repo-a"), {
      tasks: [],
      runs: [],
    });

    try {
      await harness.mount();
      if (!latest) {
        throw new Error("Hook not mounted");
      }

      await harness.run(async () => {
        await latest?.saveSpec("task-1", defaultSpecTemplateMarkdown);
      });

      const cachedSpec = queryClient.getQueryData<{
        markdown: string;
        updatedAt: string | null;
      }>(documentQueryKeys.spec("/repo-a", "task-1"));

      expect(cachedSpec?.markdown).toBe(defaultSpecTemplateMarkdown);
      expect(cachedSpec?.updatedAt).toBe("2026-02-22T10:06:00.000Z");
      expect(
        queryClient.getQueryState(["task-documents", "spec", "", "task-1"])?.isInvalidated,
      ).toBe(true);
      expect(queryClient.getQueryState(taskQueryKeys.repoData("/repo-a"))?.isInvalidated).toBe(
        true,
      );
    } finally {
      await harness.unmount();
      host.setSpec = original.setSpec;
      queryClient.clear();
    }
  });

  test("preserves newer cached payloads when save responses arrive out of order", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
    const wrapper = ({ children }: PropsWithChildren): ReactElement => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    let latest: HookResult | null = null;
    const Harness = ({ args }: { args: HookArgs }) => {
      latest = useSpecOperations(args);
      return null;
    };

    const harness = createSharedHookHarness(
      Harness,
      { args: { activeRepo: "/repo-a" } },
      { wrapper },
    );

    const saveSpecDocument = mock(async () => ({ updatedAt: "2026-02-22T10:01:00.000Z" }));
    const savePlanDocument = mock(async () => ({ updatedAt: "2026-02-22T10:01:00.000Z" }));
    const original = {
      saveSpecDocument: host.saveSpecDocument,
      savePlanDocument: host.savePlanDocument,
    };
    host.saveSpecDocument = saveSpecDocument;
    host.savePlanDocument = savePlanDocument;

    queryClient.setQueryData(documentQueryKeys.spec("/repo-a", "task-1"), {
      markdown: "# Newer spec",
      updatedAt: "2026-02-22T10:05:00.000Z",
    });
    queryClient.setQueryData(documentQueryKeys.plan("/repo-a", "task-1"), {
      markdown: "# Newer plan",
      updatedAt: "2026-02-22T10:05:00.000Z",
    });

    try {
      await harness.mount();
      if (!latest) {
        throw new Error("Hook not mounted");
      }

      await harness.run(async () => {
        await latest?.saveSpecDocument("task-1", "# Older spec response");
        await latest?.savePlanDocument("task-1", "# Older plan response");
      });

      const cachedSpec = queryClient.getQueryData<{
        markdown: string;
        updatedAt: string | null;
      }>(documentQueryKeys.spec("/repo-a", "task-1"));
      const cachedPlan = queryClient.getQueryData<{
        markdown: string;
        updatedAt: string | null;
      }>(documentQueryKeys.plan("/repo-a", "task-1"));

      expect(cachedSpec).toEqual({
        markdown: "# Newer spec",
        updatedAt: "2026-02-22T10:05:00.000Z",
      });
      expect(cachedPlan).toEqual({
        markdown: "# Newer plan",
        updatedAt: "2026-02-22T10:05:00.000Z",
      });
    } finally {
      await harness.unmount();
      host.saveSpecDocument = original.saveSpecDocument;
      host.savePlanDocument = original.savePlanDocument;
      queryClient.clear();
    }
  });
});
