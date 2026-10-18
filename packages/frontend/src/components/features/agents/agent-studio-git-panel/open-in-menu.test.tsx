import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  type SettingsSnapshotSaveResult,
  settingsSnapshotSchema,
  type SystemSettings,
  type SystemOpenInToolInfo,
} from "@openducktor/contracts";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { HostClient } from "@openducktor/host-client";
import { ClientConnectionProvider } from "@openducktor/frontend-core/connection/client-connection-react";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryProvider } from "@/test-utils/query-provider";
import { toRightPanelStorageKey } from "@/pages/agents/agents-page-selection";
import { workspaceQueryKeys } from "@openducktor/frontend-core/queries/workspace";
import { withMockedToast } from "@/test-utils/mock-toast";
import { enableReactActEnvironment } from "@openducktor/frontend-core/test-support/react-act-environment";
import { createDeferred } from "@/test-utils/shared-test-fixtures";
import { OpenInMenu } from "./open-in-menu";

enableReactActEnvironment();

describe("OpenInMenu", () => {
  let rendered: ReturnType<typeof render> | null = null;

  // Each test sets the host commands of its connection before it renders the menu.
  let host: Partial<HostClient> = {};
  const connectionForHost = () => createTestClientConnection({ client: { ...host } });
  let system: SystemSettings = {};
  const saveSettings = mock(async (): Promise<SettingsSnapshotSaveResult> => ({
    type: "saved",
    workspaces: [],
    runtimeApplications: [],
  }));

  beforeEach(() => {
    system = {};
    saveSettings.mockClear();
    host = {
      workspaceGetSettingsSnapshot: async () =>
        settingsSnapshotSchema.parse({ theme: "light", system }),
      workspaceSaveSettingsSnapshot: saveSettings,
    };
    enableReactActEnvironment();
  });

  afterEach(async () => {
    if (rendered) {
      await act(async () => {
        rendered?.unmount();
      });
      rendered = null;
    }
    globalThis.localStorage.clear();
  });

  test("renders discovered tools with icons and dispatches the selected tool", async () => {
    const systemListOpenInTools = mock(
      async () =>
        [
          { toolId: "finder", iconDataUrl: "data:image/png;base64,finder" },
          { toolId: "ghostty", iconDataUrl: "data:image/png;base64,ghostty" },
          { toolId: "zed", iconDataUrl: "data:image/png;base64,zed" },
        ] satisfies Array<SystemOpenInToolInfo>,
    );
    const onOpenInTool = mock(async () => {});
    host.systemListOpenInTools = systemListOpenInTools;
    const storageKey = toRightPanelStorageKey();

    rendered = render(
      <QueryProvider connection={connectionForHost()}>
        <TooltipProvider>
          <OpenInMenu
            contextMode="worktree"
            targetPath="/tmp/worktrees/task-24"
            disabledReason={null}
            onOpenInTool={onOpenInTool}
          />
        </TooltipProvider>
      </QueryProvider>,
    );

    await screen.findByTestId("agent-studio-git-open-in-icon-finder");
    expect(screen.getByTestId("agent-studio-git-open-in-default-button").textContent).toContain(
      "Finder",
    );
    expect(
      screen.getByTestId("agent-studio-git-open-in-default-button").getAttribute("aria-label"),
    ).toBe("Open task worktree in Finder");

    await act(async () => {
      fireEvent.click(screen.getByTestId("agent-studio-git-open-in-trigger"));
    });

    expect(await screen.findByTestId("agent-studio-git-open-in-icon-finder")).toBeTruthy();
    expect(screen.getByTestId("agent-studio-git-open-in-icon-ghostty")).toBeTruthy();
    expect(screen.getByTestId("agent-studio-git-open-in-icon-zed")).toBeTruthy();
    expect(screen.queryByText("Files")).toBeNull();
    expect(screen.queryByText("Terminals")).toBeNull();
    expect(screen.queryByText("Editors & IDEs")).toBeNull();
    expect(screen.queryByTestId("agent-studio-git-open-in-item-finder")).toBeNull();
    expect(screen.getByTestId<HTMLImageElement>("agent-studio-git-open-in-icon-zed").tagName).toBe(
      "IMG",
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("agent-studio-git-open-in-item-ghostty"));
    });

    expect(onOpenInTool).toHaveBeenCalledWith("ghostty");
    expect(saveSettings).not.toHaveBeenCalled();
    expect(screen.getByTestId("agent-studio-git-open-in-default-button").textContent).toContain(
      "Finder",
    );
    expect(globalThis.localStorage.getItem(storageKey)).toBeNull();
    expect(systemListOpenInTools).toHaveBeenCalledTimes(1);
  });

  test("waits for the saved preference before enabling the default action", async () => {
    const settings = createDeferred<ReturnType<typeof settingsSnapshotSchema.parse>>();
    host.workspaceGetSettingsSnapshot = () => settings.promise;
    host.systemListOpenInTools = async () => [{ toolId: "finder" }, { toolId: "zed" }];
    const onOpenInTool = mock(async () => {});
    rendered = render(
      <QueryProvider connection={connectionForHost()}>
        <TooltipProvider>
          <OpenInMenu
            contextMode="repository"
            targetPath="/repo"
            disabledReason={null}
            onOpenInTool={onOpenInTool}
          />
        </TooltipProvider>
      </QueryProvider>,
    );
    await screen.findByTestId("agent-studio-git-open-in-icon-finder");
    const button = screen.getByTestId<HTMLButtonElement>("agent-studio-git-open-in-default-button");
    expect(button.disabled).toBe(true);
    await act(async () => {
      fireEvent.click(button);
    });
    expect(onOpenInTool).not.toHaveBeenCalled();
    await act(async () => {
      settings.resolve(
        settingsSnapshotSchema.parse({
          theme: "light",
          system: { preferredOpenInToolId: "zed" },
        }),
      );
    });
    await waitFor(() => expect(button.disabled).toBe(false));
    expect(button.textContent).toContain("Zed");
  });

  test("opening another tool keeps the Settings preference in both mounted menus", async () => {
    system = { preferredOpenInToolId: "finder" };
    host.systemListOpenInTools = async () => [{ toolId: "finder" }, { toolId: "zed" }];
    let completeLaunch!: () => void;
    const launched = new Promise<void>((resolve) => {
      completeLaunch = resolve;
    });
    rendered = render(
      <QueryProvider connection={connectionForHost()}>
        <TooltipProvider>
          <OpenInMenu
            contextMode="repository"
            targetPath="/tmp/repo"
            disabledReason={null}
            onOpenInTool={() => launched}
          />
          <OpenInMenu
            contextMode="worktree"
            targetPath="/tmp/worktree"
            disabledReason={null}
            onOpenInTool={async () => {}}
          />
        </TooltipProvider>
      </QueryProvider>,
    );
    await screen.findByRole("button", { name: "Open repository root in Finder" });
    await act(async () => {
      fireEvent.click(screen.getAllByTestId("agent-studio-git-open-in-trigger")[0]!);
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("agent-studio-git-open-in-item-zed"));
    });
    expect(saveSettings).not.toHaveBeenCalled();
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Open repository root in Finder" })
        .disabled,
    ).toBe(true);
    await act(async () => {
      completeLaunch();
    });
    await waitFor(
      () =>
        expect(screen.getByRole("button", { name: "Open task worktree in Finder" })).toBeTruthy(),
      { timeout: 700 },
    );
    expect(saveSettings).not.toHaveBeenCalled();
    expect(system).toEqual({ preferredOpenInToolId: "finder" });
    expect(screen.getByRole("button", { name: "Open repository root in Finder" })).toBeTruthy();
  });

  test("updates the default when Settings changes or clears the preference", async () => {
    host.systemListOpenInTools = async () => [{ toolId: "finder" }, { toolId: "zed" }];
    const connection = connectionForHost();
    const { queryClient } = connection;
    rendered = render(
      <ClientConnectionProvider connection={connection}>
        <TooltipProvider>
          <OpenInMenu
            contextMode="repository"
            targetPath="/tmp/repo"
            disabledReason={null}
            onOpenInTool={async () => {}}
          />
        </TooltipProvider>
      </ClientConnectionProvider>,
    );
    await screen.findByRole("button", { name: "Open repository root in Finder" });
    for (const [preference, label] of [
      [{ preferredOpenInToolId: "zed" }, "Zed"],
      [{}, "Finder"],
    ] as const) {
      system = preference;
      await act(async () => {
        await queryClient.invalidateQueries({ queryKey: workspaceQueryKeys.settingsSnapshot() });
      });
      await screen.findByRole("button", { name: `Open repository root in ${label}` });
    }
    expect(saveSettings).not.toHaveBeenCalled();
  });

  test("shows an actionable disabled reason when the target path is unavailable", async () => {
    host.systemListOpenInTools = mock(
      async () =>
        [
          { toolId: "finder", iconDataUrl: "data:image/png;base64,finder" },
        ] satisfies Array<SystemOpenInToolInfo>,
    );

    rendered = render(
      <QueryProvider connection={connectionForHost()}>
        <TooltipProvider>
          <OpenInMenu
            contextMode="worktree"
            targetPath={null}
            disabledReason="Task worktree path is unavailable. Refresh the Git panel and try again."
          />
        </TooltipProvider>
      </QueryProvider>,
    );

    const trigger: HTMLButtonElement = screen.getByTestId("agent-studio-git-open-in-trigger");
    const disabledTrigger = screen.getByTestId("agent-studio-git-open-in-disabled-trigger");

    expect(trigger.disabled).toBe(true);
    expect(disabledTrigger).toBeTruthy();
    expect(
      screen.getByText("Task worktree path is unavailable. Refresh the Git panel and try again.", {
        selector: "span.sr-only",
      }).textContent,
    ).toContain("Task worktree path is unavailable. Refresh the Git panel and try again.");
  });

  test("disables the trigger even when the caller forgot to provide a disabled reason", async () => {
    host.systemListOpenInTools = mock(
      async () =>
        [
          { toolId: "finder", iconDataUrl: "data:image/png;base64,finder" },
        ] satisfies Array<SystemOpenInToolInfo>,
    );

    rendered = render(
      <QueryProvider connection={connectionForHost()}>
        <TooltipProvider>
          <OpenInMenu contextMode="worktree" targetPath={null} disabledReason={null} />
        </TooltipProvider>
      </QueryProvider>,
    );

    const trigger = screen.getByTestId("agent-studio-git-open-in-trigger");
    if (!(trigger instanceof HTMLButtonElement)) {
      throw new Error("Expected the open-in trigger to be a button");
    }

    expect(trigger.disabled).toBe(true);
    expect(
      screen.getByText("Task worktree path is unavailable. Refresh the Git panel and try again.", {
        selector: "span.sr-only",
      }).textContent,
    ).toContain("Task worktree path is unavailable");
  });

  test("surfaces launch failures with a toast that names the selected tool", async () => {
    await withMockedToast(async ({ toastErrorMock }) => {
      host.systemListOpenInTools = mock(
        async () =>
          [
            { toolId: "zed", iconDataUrl: "data:image/png;base64,zed" },
          ] satisfies Array<SystemOpenInToolInfo>,
      );

      rendered = render(
        <QueryProvider connection={connectionForHost()}>
          <TooltipProvider>
            <OpenInMenu
              contextMode="worktree"
              targetPath="/tmp/worktrees/task-24"
              disabledReason={null}
              onOpenInTool={async () => {
                throw new Error("launch failed");
              }}
            />
          </TooltipProvider>
        </QueryProvider>,
      );

      await screen.findByTestId("agent-studio-git-open-in-icon-zed");
      await act(async () => {
        fireEvent.click(screen.getByTestId("agent-studio-git-open-in-default-button"));
        await Promise.resolve();
      });

      expect(saveSettings).not.toHaveBeenCalled();
      expect(toastErrorMock).toHaveBeenCalledWith("Failed to open in Zed", {
        description: "launch failed",
      });
    });
  });

  test("uses the Settings preference as the default action and keeps only alternatives in the menu", async () => {
    const storageKey = toRightPanelStorageKey();
    system = { preferredOpenInToolId: "zed" };
    globalThis.localStorage.setItem(storageKey, JSON.stringify({ openInToolId: "terminal" }));
    host.systemListOpenInTools = mock(
      async () =>
        [
          { toolId: "finder", iconDataUrl: "data:image/png;base64,finder" },
          { toolId: "terminal", iconDataUrl: "data:image/png;base64,terminal" },
          { toolId: "zed", iconDataUrl: "data:image/png;base64,zed" },
        ] satisfies Array<SystemOpenInToolInfo>,
    );
    const onOpenInTool = mock(async () => {});

    rendered = render(
      <QueryProvider connection={connectionForHost()}>
        <TooltipProvider>
          <OpenInMenu
            contextMode="worktree"
            targetPath="/tmp/worktrees/task-24"
            disabledReason={null}
            onOpenInTool={onOpenInTool}
          />
        </TooltipProvider>
      </QueryProvider>,
    );

    await screen.findByTestId("agent-studio-git-open-in-icon-zed");
    expect(screen.getByTestId("agent-studio-git-open-in-default-button").textContent).toContain(
      "Zed",
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("agent-studio-git-open-in-default-button"));
    });

    expect(onOpenInTool).toHaveBeenCalledWith("zed");

    await act(async () => {
      fireEvent.click(screen.getByTestId("agent-studio-git-open-in-trigger"));
    });

    expect(screen.queryByTestId("agent-studio-git-open-in-item-zed")).toBeNull();
    expect(screen.getByTestId("agent-studio-git-open-in-item-finder")).toBeTruthy();
    expect(screen.getByTestId("agent-studio-git-open-in-item-terminal")).toBeTruthy();
  });

  test("falls back from an absent persisted tool to the first discovered tool without launching", async () => {
    const storageKey = toRightPanelStorageKey();
    system = { preferredOpenInToolId: "zed" };
    globalThis.localStorage.setItem(storageKey, JSON.stringify({ openInToolId: "terminal" }));
    host.systemListOpenInTools = mock(
      async () =>
        [
          { toolId: "explorer", iconDataUrl: null },
          { toolId: "vscode", iconDataUrl: null },
        ] satisfies Array<SystemOpenInToolInfo>,
    );
    const onOpenInTool = mock(async () => {});

    rendered = render(
      <QueryProvider connection={connectionForHost()}>
        <TooltipProvider>
          <OpenInMenu
            contextMode="repository"
            targetPath="/tmp/repo"
            disabledReason={null}
            onOpenInTool={onOpenInTool}
          />
        </TooltipProvider>
      </QueryProvider>,
    );

    await screen.findByTestId("agent-studio-git-open-in-icon-explorer");

    expect(screen.getByTestId("agent-studio-git-open-in-default-button").textContent).toContain(
      "File Explorer",
    );
    expect(onOpenInTool).not.toHaveBeenCalled();
  });

  test("shows platform-neutral empty discovery copy and disables the default action", async () => {
    const systemListOpenInTools = mock(async () => [] satisfies Array<SystemOpenInToolInfo>);
    host.systemListOpenInTools = systemListOpenInTools;

    rendered = render(
      <QueryProvider connection={connectionForHost()}>
        <TooltipProvider>
          <OpenInMenu
            contextMode="worktree"
            targetPath="/tmp/worktrees/task-24"
            disabledReason={null}
            onOpenInTool={async () => {}}
          />
        </TooltipProvider>
      </QueryProvider>,
    );

    const defaultButton: HTMLButtonElement = screen.getByTestId(
      "agent-studio-git-open-in-default-button",
    );
    expect(defaultButton.disabled).toBe(true);

    await act(async () => {
      fireEvent.click(screen.getByTestId("agent-studio-git-open-in-trigger"));
    });

    await screen.findByTestId("agent-studio-git-open-in-empty");
    expect(
      screen.getByText("No supported Open In tools were found on this platform."),
    ).toBeTruthy();
    expect(screen.queryByText(/on this Mac/i)).toBeNull();
  });

  test("retry forces a fresh discovery request after a discovery error", async () => {
    const systemListOpenInTools = mock(async (forceRefresh = false) => {
      if (!forceRefresh) {
        throw new Error("initial discovery failed");
      }

      return [
        { toolId: "finder", iconDataUrl: "data:image/png;base64,finder" },
      ] satisfies Array<SystemOpenInToolInfo>;
    });
    host.systemListOpenInTools = systemListOpenInTools;

    rendered = render(
      <QueryProvider connection={connectionForHost()}>
        <TooltipProvider>
          <OpenInMenu
            contextMode="worktree"
            targetPath="/tmp/worktrees/task-24"
            disabledReason={null}
            onOpenInTool={async () => {}}
          />
        </TooltipProvider>
      </QueryProvider>,
    );

    await act(async () => {
      fireEvent.click(await screen.findByTestId("agent-studio-git-open-in-trigger"));
    });

    expect(await screen.findByTestId("agent-studio-git-open-in-error")).toBeTruthy();
    expect(
      screen.getByTestId<HTMLButtonElement>("agent-studio-git-open-in-default-button").disabled,
    ).toBe(true);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(await screen.findByTestId("agent-studio-git-open-in-icon-finder")).toBeTruthy();
    expect(systemListOpenInTools).toHaveBeenNthCalledWith(1);
    expect(systemListOpenInTools).toHaveBeenNthCalledWith(2, true);
  });

  test("retry surfaces a toast when refresh discovery also fails", async () => {
    await withMockedToast(async ({ toastErrorMock }) => {
      const systemListOpenInTools = mock(async () => {
        throw new Error("refresh discovery failed");
      });
      host.systemListOpenInTools = systemListOpenInTools;

      rendered = render(
        <QueryProvider connection={connectionForHost()}>
          <TooltipProvider>
            <OpenInMenu
              contextMode="worktree"
              targetPath="/tmp/worktrees/task-24"
              disabledReason={null}
              onOpenInTool={async () => {}}
            />
          </TooltipProvider>
        </QueryProvider>,
      );

      await act(async () => {
        fireEvent.click(await screen.findByTestId("agent-studio-git-open-in-trigger"));
      });

      expect(await screen.findByTestId("agent-studio-git-open-in-error")).toBeTruthy();

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Retry" }));
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(toastErrorMock).toHaveBeenCalledWith("Failed to refresh supported apps", {
        description: "refresh discovery failed",
      });
    });
  });
});
