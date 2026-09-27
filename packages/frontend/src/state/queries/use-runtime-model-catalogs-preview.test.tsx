import { expect, mock, test } from "bun:test";
import {
  CODEX_RUNTIME_DESCRIPTOR,
  DEFAULT_AGENT_RUNTIMES,
  OPENCODE_RUNTIME_DESCRIPTOR,
  type AgentRuntimeCatalog,
  type AgentRuntimePreviewModelsInput,
} from "@openducktor/contracts";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { createQueryClient } from "@/lib/query-client";
import { useRuntimeModelCatalogs } from "./use-runtime-model-catalogs";

const preview = (
  runtimeKind: AgentRuntimePreviewModelsInput["runtimeKind"],
): AgentRuntimeCatalog => {
  const runtime = runtimeKind === "codex" ? CODEX_RUNTIME_DESCRIPTOR : OPENCODE_RUNTIME_DESCRIPTOR;
  return {
    runtime,
    models: {
      status: "available",
      catalog: { runtime, models: [], defaultModelsByProvider: {} },
    },
  };
};

test("loads preview catalogs only on the models stage and scopes them to the chosen repository", async () => {
  const client = createQueryClient();
  const loadPreviewModels = mock(async (input: AgentRuntimePreviewModelsInput) =>
    preview(input.runtimeKind),
  );
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const view = renderHook(
    ({ repoPath, active }) =>
      useRuntimeModelCatalogs({
        repoPath,
        runtimeKinds: ["codex", "opencode"],
        enabledRuntimeKinds: active ? ["codex", "opencode"] : [],
        agentRuntimes: DEFAULT_AGENT_RUNTIMES,
        loadPreviewModels,
      }),
    { wrapper, initialProps: { repoPath: "/first", active: false } },
  );
  expect(loadPreviewModels).not.toHaveBeenCalled();
  view.rerender({ repoPath: "", active: true });
  expect(view.result.current.resources.every((item) => !item.isEnabled)).toBe(true);
  expect(loadPreviewModels).not.toHaveBeenCalled();
  view.rerender({ repoPath: "/first", active: true });
  await waitFor(() =>
    expect(view.result.current.resources.every((item) => item.catalog !== null)).toBe(true),
  );
  expect(loadPreviewModels).toHaveBeenCalledWith({ repoPath: "/first", runtimeKind: "codex" });
  expect(loadPreviewModels).toHaveBeenCalledWith({ repoPath: "/first", runtimeKind: "opencode" });

  view.rerender({ repoPath: "/second", active: true });
  await waitFor(() =>
    expect(loadPreviewModels).toHaveBeenCalledWith({
      repoPath: "/second",
      runtimeKind: "codex",
    }),
  );
  view.unmount();
});

test("shows a preview failure and retries the same repository", async () => {
  const client = createQueryClient();
  let attempts = 0;
  const loadPreviewModels = mock(async (_input: AgentRuntimePreviewModelsInput) => {
    attempts += 1;
    if (attempts === 1) throw new Error("Codex model list unavailable");
    return preview("codex");
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const view = renderHook(
    () =>
      useRuntimeModelCatalogs({
        repoPath: "/repo",
        runtimeKinds: ["codex"],
        enabledRuntimeKinds: ["codex"],
        agentRuntimes: DEFAULT_AGENT_RUNTIMES,
        loadPreviewModels,
      }),
    { wrapper },
  );
  await waitFor(() => expect(view.result.current.resources[0]?.error).toContain("unavailable"));
  expect(view.result.current.resources[0]?.catalog).toBeNull();
  await act(async () => {
    await view.result.current.resources[0]?.retry();
  });
  await waitFor(() => expect(view.result.current.resources[0]?.catalog).not.toBeNull());
  expect(loadPreviewModels).toHaveBeenCalledTimes(2);
  view.unmount();
});

test("reloads a preview when the saved executable path changes", async () => {
  const client = createQueryClient();
  const loadPreviewModels = mock(async (input: AgentRuntimePreviewModelsInput) =>
    preview(input.runtimeKind),
  );
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const view = renderHook(
    ({ executablePath }) =>
      useRuntimeModelCatalogs({
        repoPath: "/repo",
        runtimeKinds: ["codex"],
        enabledRuntimeKinds: ["codex"],
        agentRuntimes: {
          ...DEFAULT_AGENT_RUNTIMES,
          codex: { ...DEFAULT_AGENT_RUNTIMES.codex, executablePath },
        },
        loadPreviewModels,
      }),
    { wrapper, initialProps: { executablePath: "/tools/codex-old" } },
  );

  await waitFor(() => expect(loadPreviewModels).toHaveBeenCalledTimes(1));
  view.rerender({ executablePath: "/tools/codex-new" });
  await waitFor(() => expect(loadPreviewModels).toHaveBeenCalledTimes(2));
  view.unmount();
});

test("keeps preview results separate from live runtime catalogs", async () => {
  const client = createQueryClient();
  const loadPreviewModels = mock(async () => preview("codex"));
  const loadRuntimeCatalog = mock(async () => preview("codex"));
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const previewView = renderHook(
    () =>
      useRuntimeModelCatalogs({
        repoPath: "/repo",
        runtimeKinds: ["codex"],
        enabledRuntimeKinds: ["codex"],
        agentRuntimes: DEFAULT_AGENT_RUNTIMES,
        loadPreviewModels,
      }),
    { wrapper },
  );
  await waitFor(() => expect(previewView.result.current.resources[0]?.catalog).not.toBeNull());
  previewView.unmount();

  const liveView = renderHook(
    () =>
      useRuntimeModelCatalogs({
        repoPath: "/repo",
        runtimeKinds: ["codex"],
        enabledRuntimeKinds: ["codex"],
        loadRuntimeCatalog,
      }),
    { wrapper },
  );
  await waitFor(() => expect(loadRuntimeCatalog).toHaveBeenCalledTimes(1));
  expect(loadPreviewModels).toHaveBeenCalledTimes(1);
  liveView.unmount();
});
