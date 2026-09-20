import { afterEach, expect, test } from "bun:test";
import {
  DEFAULT_AGENT_RUNTIMES,
  OPENCODE_RUNTIME_DESCRIPTOR,
  CODEX_RUNTIME_DESCRIPTOR,
  CLAUDE_RUNTIME_DESCRIPTOR,
  type WorkspaceSession,
  type WorkspaceSessionExternalListInput,
  type WorkspaceSessionExternalListResult,
  type WorkspaceSessionImportResult,
} from "@openducktor/contracts";
import type { HostClient } from "@openducktor/host-client";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, Fragment, StrictMode, type ComponentProps } from "react";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { createQueryClient } from "@/lib/query-client";
import { configureShellBridge, createUnavailableShellBridge } from "@/lib/shell-bridge";
import { RuntimeDefinitionsContext } from "@/state/app-state-contexts";
import { createShellBridgeFixture } from "@/test-utils/focused-fixture";
import { WorkspaceSessionImportDialog } from "./workspace-session-import-dialog";

const definitions = [
  OPENCODE_RUNTIME_DESCRIPTOR,
  CODEX_RUNTIME_DESCRIPTOR,
  CLAUDE_RUNTIME_DESCRIPTOR,
];
const context: ComponentProps<typeof RuntimeDefinitionsContext>["value"] = {
  runtimeDefinitions: definitions,
  availableRuntimeDefinitions: definitions,
  agentRuntimes: DEFAULT_AGENT_RUNTIMES,
  isLoadingRuntimeDefinitions: false,
  runtimeDefinitionsError: null,
  isLoadingRuntimeSettings: false,
  runtimeSettingsError: null,
  hasRuntimeSettingsSnapshot: true,
  refreshRuntimeDefinitions: async () => definitions,
  refreshRuntimeSettings: async () => {},
  loadRepoRuntimeCatalog: async () => {
    throw new Error("Discovery must not load model catalogs");
  },
  loadRepoRuntimeFileSearch: async () => [],
};
const saved: WorkspaceSession = {
  id: "saved",
  externalSessionId: "native",
  runtimeKind: "opencode",
  executionTarget: { kind: "local_repo_root", workingDirectory: "/repo" },
  selectedModel: null,
  roleSnapshot: null,
  manualTitle: "Native title",
  generatedTitle: null,
  createdAt: 1,
  updatedAt: 1,
  archivedAt: null,
};
const row = {
  externalSessionId: "native",
  runtimeKind: "opencode" as const,
  title: "Native title",
  workingDirectory: "/repo",
  updatedAt: 1,
};
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const renderImport = (overrides: Partial<HostClient> = {}, strict = false) => {
  const Wrapper = strict ? StrictMode : Fragment;
  const calls: WorkspaceSessionExternalListInput[] = [];
  const releases: string[] = [];
  const opened: WorkspaceSession[] = [];
  let closed = 0;
  configureShellBridge(
    createShellBridgeFixture({
      client: {
        workspaceSessionExternalList: async (input) => {
          calls.push(input);
          return { catalogId: input.catalogRequestId, sessions: [row], nextCursor: null };
        },
        workspaceSessionExternalRelease: async (input) => {
          releases.push(input.catalogRequestId);
          return true;
        },
        workspaceSessionImport: async () => ({ session: saved, created: true, openError: null }),
        ...overrides,
      },
    }),
  );
  const client = createQueryClient();
  const view = render(
    <Wrapper>
      <QueryClientProvider client={client}>
        <RuntimeDefinitionsContext value={context}>
          <WorkspaceSessionImportDialog
            workspaceId="workspace"
            onClose={() => {
              closed++;
            }}
            onImported={(session) => opened.push(session)}
          />
        </RuntimeDefinitionsContext>
      </QueryClientProvider>
    </Wrapper>,
  );
  return { ...view, calls, releases, opened, client, closed: () => closed };
};
afterEach(() => configureShellBridge(createUnavailableShellBridge()));
const choose = async (view: ReturnType<typeof renderImport>, label: string) => {
  fireEvent.click(view.getByRole("button", { name: "Runtime" }));
  fireEvent.click(await view.findByRole("option", { name: new RegExp(label) }));
};

test("waits for runtime choice and debounces metadata search", async () => {
  const view = renderImport();
  try {
    expect(view.calls).toEqual([]);
    await choose(view, "OpenCode");
    await view.findByRole("button", { name: "Import Native title" });
    expect(view.calls).toHaveLength(1);
    const input = view.getByRole("textbox", { name: "Search sessions" });
    fireEvent.change(input, { target: { value: "N" } });
    fireEvent.change(input, { target: { value: "Native" } });
    expect(view.calls).toHaveLength(1);
    await waitFor(() => expect(view.calls).toHaveLength(2));
    expect(view.calls[1]?.search).toBe("Native");
    fireEvent.click(await view.findByRole("button", { name: "Import Native title" }));
    await waitFor(() => expect(view.opened).toEqual([saved]));
    expect(view.closed()).toBe(1);
  } finally {
    view.unmount();
    view.client.clear();
  }
});

test("drops a late runtime response after changing runtime", async () => {
  const pending = deferred<WorkspaceSessionExternalListResult>();
  const view = renderImport({
    workspaceSessionExternalList: async (input) =>
      input.runtimeKind === "opencode"
        ? pending.promise
        : {
            catalogId: input.catalogRequestId,
            sessions: [{ ...row, runtimeKind: "claude", title: "Claude native" }],
            nextCursor: null,
          },
  });
  try {
    await choose(view, "OpenCode");
    await choose(view, "Claude");
    await view.findByRole("button", { name: "Import Claude native" });
    await act(async () => pending.resolve({ catalogId: "old", sessions: [row], nextCursor: null }));
    expect(view.queryByRole("button", { name: "Import Native title" })).toBeNull();
    expect(view.releases).toHaveLength(1);
  } finally {
    view.unmount();
    view.client.clear();
  }
});

test("does not navigate when an import completes after unmount", async () => {
  const pending = deferred<WorkspaceSessionImportResult>();
  const view = renderImport({ workspaceSessionImport: () => pending.promise });
  await choose(view, "OpenCode");
  fireEvent.click(await view.findByRole("button", { name: "Import Native title" }));
  view.unmount();
  await act(async () => pending.resolve({ session: saved, created: true, openError: null }));
  expect(view.opened).toEqual([]);
  expect(view.closed()).toBe(0);
  view.client.clear();
});

test("keeps a saved chat available when admission reports an error", async () => {
  let imports = 0;
  const view = renderImport({
    workspaceSessionImport: async () => {
      imports++;
      return { session: saved, created: true, openError: "Saved; runtime disconnected" };
    },
  });
  try {
    await choose(view, "OpenCode");
    fireEvent.click(await view.findByRole("button", { name: "Import Native title" }));
    fireEvent.click(await view.findByRole("button", { name: "Open saved chat" }));
    expect(imports).toBe(1);
    expect(view.opened).toEqual([saved]);
  } finally {
    view.unmount();
    view.client.clear();
  }
});

test("keeps discovery open through Strict Mode effect replay and releases it on unmount", async () => {
  const view = renderImport({}, true);
  try {
    await choose(view, "OpenCode");
    await view.findByRole("button", { name: "Import Native title" });
    const activeId = view.calls.at(-1)?.catalogRequestId;
    if (!activeId) throw new Error("Expected discovery to start");
    expect(view.releases).not.toContain(activeId);
    fireEvent.change(view.getByRole("textbox", { name: "Search sessions" }), {
      target: { value: "Native" },
    });
    await waitFor(() => expect(view.calls.at(-1)?.search).toBe("Native"));
    expect(view.calls.at(-1)?.catalogRequestId).toBe(activeId);
    view.unmount();
    expect(view.releases).toContain(activeId);
  } finally {
    view.unmount();
    view.client.clear();
  }
});

test("clears a search and returns focus without opening a new catalog", async () => {
  const view = renderImport();
  try {
    await choose(view, "OpenCode");
    await view.findByRole("button", { name: "Import Native title" });
    const catalogId = view.calls[0]?.catalogRequestId;
    const input = view.getByRole("textbox", { name: "Search sessions" });
    fireEvent.change(input, { target: { value: "Native" } });
    await waitFor(() => expect(view.calls.at(-1)?.search).toBe("Native"));
    fireEvent.click(view.getByRole("button", { name: "Clear search" }));
    expect(input instanceof HTMLInputElement && input.value).toBe("");
    expect(document.activeElement).toBe(input);
    await view.findByRole("button", { name: "Import Native title" });
    expect(view.queryByRole("button", { name: "Clear search" })).toBeNull();
    expect(view.calls.every((call) => call.catalogRequestId === catalogId)).toBe(true);
  } finally {
    view.unmount();
    view.client.clear();
  }
});

test("shows import progress and prevents dismissal until import settles", async () => {
  const pending = deferred<WorkspaceSessionImportResult>();
  const view = renderImport({ workspaceSessionImport: () => pending.promise });
  try {
    await choose(view, "OpenCode");
    fireEvent.click(await view.findByRole("button", { name: "Import Native title" }));
    await view.findByText("Importing…");
    for (const name of ["Close", "Cancel", "Runtime", "Import Native title"]) {
      expect(view.getByRole("button", { name }).hasAttribute("disabled")).toBe(true);
    }
    fireEvent.keyDown(view.getByRole("dialog"), { key: "Escape" });
    expect(view.closed()).toBe(0);
    await act(async () => pending.resolve({ session: saved, created: true, openError: null }));
    await waitFor(() => expect(view.opened).toEqual([saved]));
    expect(view.closed()).toBe(1);
  } finally {
    view.unmount();
    view.client.clear();
  }
});
