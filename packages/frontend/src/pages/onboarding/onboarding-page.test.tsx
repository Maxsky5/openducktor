import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  type AgentRuntimes,
  CLAUDE_RUNTIME_DESCRIPTOR,
  CODEX_RUNTIME_DESCRIPTOR,
  DEFAULT_AGENT_RUNTIMES,
  OPENCODE_RUNTIME_DESCRIPTOR,
  type RuntimeExecutableCheck,
  type RuntimeKind,
} from "@openducktor/contracts";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ThemeProvider } from "@/components/layout/theme-provider";
import { getAppVersion } from "@/lib/app-version";
import { hostBridge } from "@/lib/host-client";
import { createQueryClient } from "@/lib/query-client";
import { WorkspaceStateContext } from "@/state/app-state-contexts";
import { host } from "@/state/operations/host";
import {
  runtimeDefinitionsQueryOptions,
  runtimeDiscoveryQueryOptions,
} from "@/state/queries/runtime";
import { settingsSnapshotQueryOptions } from "@/state/queries/workspace";
import { createDeferred, createSettingsSnapshotFixture } from "@/test-utils/shared-test-fixtures";
import type { WorkspaceStateContextValue } from "@/types/state-slices";
import { OnboardingPage } from "./onboarding-page";

const mountedViews = new Set<ReturnType<typeof render>>();
afterEach(() => {
  for (const view of mountedViews) view.unmount();
  mountedViews.clear();
  document.documentElement.classList.remove("light", "dark");
});

const runtimeDefinitions = [
  OPENCODE_RUNTIME_DESCRIPTOR,
  CODEX_RUNTIME_DESCRIPTOR,
  CLAUDE_RUNTIME_DESCRIPTOR,
];

const createCheck = (runtimes: AgentRuntimes, opencodeOk = false): RuntimeExecutableCheck => ({
  runtimes: [
    {
      kind: "opencode",
      path: runtimes.opencode.executablePath,
      ok: opencodeOk,
      version: opencodeOk ? "1.0.0" : null,
      error: opencodeOk ? null : "OpenCode executable is invalid.",
    },
    {
      kind: "codex",
      path: runtimes.codex.executablePath,
      ok: false,
      version: null,
      error: "Codex executable is invalid.",
    },
    {
      kind: "claude",
      path: runtimes.claude.executablePath,
      ok: false,
      version: null,
      error: "Claude executable is invalid.",
    },
  ],
});

const renderOnboarding = ({
  runtimes,
  saveSettingsSnapshot = mock(async () => {}),
  prefillSettings = true,
  prefillDefinitions = true,
}: {
  runtimes: AgentRuntimes;
  saveSettingsSnapshot?: WorkspaceStateContextValue["saveSettingsSnapshot"];
  prefillSettings?: boolean;
  prefillDefinitions?: boolean;
}): ReturnType<typeof createQueryClient> => {
  const queryClient = createQueryClient();
  if (prefillSettings) {
    queryClient.setQueryData(
      settingsSnapshotQueryOptions().queryKey,
      createSettingsSnapshotFixture({ agentRuntimes: runtimes }),
    );
  }
  if (prefillDefinitions) {
    queryClient.setQueryData(runtimeDefinitionsQueryOptions().queryKey, runtimeDefinitions);
  }
  const workspaceState = {
    isSwitchingWorkspace: false,
    isLoadingBranches: false,
    isSwitchingBranch: false,
    branchSyncDegraded: false,
    workspaces: [],
    activeWorkspace: null,
    branches: [],
    activeBranch: null,
    addWorkspace: mock(async () => {}),
    selectWorkspace: mock(async () => {}),
    reorderWorkspaces: mock(async () => {}),
    refreshBranches: mock(async () => {}),
    switchBranch: mock(async () => {}),
    loadRepoSettings: mock(async () => {
      throw new Error("Not used");
    }),
    saveRepoSettings: mock(async () => {}),
    loadSettingsSnapshot: mock(async () => createSettingsSnapshotFixture()),
    detectGithubRepository: mock(async () => null),
    saveGlobalGitConfig: mock(async () => {}),
    saveSettingsSnapshot,
  } satisfies WorkspaceStateContextValue;

  const view = render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <WorkspaceStateContext value={workspaceState}>
          <OnboardingPage onComplete={() => {}} />
        </WorkspaceStateContext>
      </ThemeProvider>
    </QueryClientProvider>,
  );
  mountedViews.add(view);
  return queryClient;
};

const enterRuntimeStage = async (): Promise<void> => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Configure coding agents" }));
    await Promise.resolve();
    await Promise.resolve();
  });
  await screen.findByRole("heading", { name: "Configure coding agents" });
  await waitFor(() =>
    expect((screen.getByRole("button", { name: /Continue/ }) as HTMLButtonElement).disabled).toBe(
      false,
    ),
  );
};

const opencodeSection = (): HTMLElement => {
  const section = screen.getByRole("heading", { name: "OpenCode" }).closest("section");
  if (!section) throw new Error("OpenCode section is missing");
  return section;
};

describe("OnboardingPage runtime validation", () => {
  test("renders a horizontal progress indicator above the current stage", () => {
    renderOnboarding({ runtimes: DEFAULT_AGENT_RUNTIMES });

    const progress = screen.getByRole("navigation", { name: "Onboarding progress" });
    const currentStepLabel = within(progress).getByText("Welcome");
    expect(progress.getAttribute("data-orientation")).toBe("horizontal");
    expect(progress.querySelectorAll("[data-progress-connector]")).toHaveLength(2);
    expect(within(progress).getByText("Coding agents")).toBeTruthy();
    expect(currentStepLabel.className).toContain("text-foreground");
    expect(currentStepLabel.className).not.toContain("text-primary");
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  test("keeps the Welcome stage focused on the setup task", () => {
    renderOnboarding({ runtimes: DEFAULT_AGENT_RUNTIMES });

    expect(
      screen.getByRole("heading", { name: "Set up your local coding workspace" }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "OpenDucktor works with a local Git repository and guides each change through Spec, Plan, Build, and QA.",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Configure coding agents" })).toBeTruthy();
    expect(screen.queryByText("Welcome to OpenDucktor")).toBeNull();
    expect(screen.queryByText("First-time setup")).toBeNull();
    expect(screen.queryByText("Move from idea to reviewed change.")).toBeNull();
    expect(screen.queryByText("Define the outcome")).toBeNull();
  });

  test("shows the app version and theme control in the onboarding header", async () => {
    const originalSetTheme = hostBridge.client.setTheme;
    hostBridge.client.setTheme = mock(async () => undefined);

    try {
      renderOnboarding({ runtimes: DEFAULT_AGENT_RUNTIMES });
      const header = screen.getByRole("banner");
      const appVersion = getAppVersion();

      expect(within(header).queryByText("Local delivery workspace")).toBeNull();
      if (appVersion) expect(within(header).getByText(appVersion)).toBeTruthy();

      const themeSwitch = within(header).getByRole("switch", { name: "Toggle dark mode" });
      fireEvent.click(themeSwitch);

      await waitFor(() => expect(document.documentElement.classList.contains("dark")).toBe(true));
      expect(themeSwitch.getAttribute("aria-checked")).toBe("true");
    } finally {
      hostBridge.client.setTheme = originalSetTheme;
    }
  });

  test("resets the onboarding scroll position when the stage changes", async () => {
    renderOnboarding({ runtimes: DEFAULT_AGENT_RUNTIMES });
    const onboardingShell = document.querySelector(".onboarding-shell");
    if (!(onboardingShell instanceof HTMLElement)) {
      throw new Error("Onboarding scroll container is missing");
    }
    onboardingShell.scrollTop = 320;

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Configure coding agents" }));
      await Promise.resolve();
      await Promise.resolve();
    });
    await screen.findByRole("heading", { name: "Configure coding agents" });

    expect(onboardingShell.scrollTop).toBe(0);
  });

  test("keeps coding-agent discovery in the compact stage header", async () => {
    renderOnboarding({ runtimes: DEFAULT_AGENT_RUNTIMES });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Configure coding agents" }));
      await Promise.resolve();
      await Promise.resolve();
    });

    const heading = await screen.findByRole("heading", { name: "Configure coding agents" });
    const headerRow = heading.parentElement;
    if (!headerRow) throw new Error("Coding-agent header row is missing");

    expect(within(headerRow).getByRole("button", { name: "Scan for coding agents" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Scan for coding agents" })).toHaveLength(1);
  });

  test("keeps runtime cards neutral while exact paths are being checked", async () => {
    const runtimes: AgentRuntimes = {
      opencode: { enabled: true, executablePath: "/valid/opencode" },
      codex: {
        ...DEFAULT_AGENT_RUNTIMES.codex,
        enabled: true,
        executablePath: "/valid/codex",
      },
      claude: {
        ...DEFAULT_AGENT_RUNTIMES.claude,
        enabled: true,
        executablePath: "/valid/claude",
      },
    };
    const validation = createDeferred<RuntimeExecutableCheck>();
    const originalCheck = host.runtimeExecutablesCheck;
    host.runtimeExecutablesCheck = mock(async () => validation.promise);

    try {
      renderOnboarding({ runtimes });
      fireEvent.click(screen.getByRole("button", { name: "Configure coding agents" }));

      await screen.findByRole("heading", { name: "Configure coding agents" });
      expect(screen.getAllByText("Checking")).toHaveLength(runtimeDefinitions.length);
      expect(screen.queryByText("Unavailable")).toBeNull();
      expect(screen.queryByText("Enter a path, then check it.")).toBeNull();
      expect(screen.getAllByText("Validating saved executable path...")).toHaveLength(
        runtimeDefinitions.length,
      );
      for (const input of screen.getAllByRole("textbox", { name: "Executable path" })) {
        expect(input.getAttribute("aria-invalid")).toBe("false");
      }

      await act(async () => {
        validation.resolve(createCheck(runtimes, true));
      });
      await within(opencodeSection()).findByText("Available");
      expect(within(opencodeSection()).getByText("1.0.0")).toBeTruthy();
      expect(within(opencodeSection()).queryByText("1.0.0 at /valid/opencode")).toBeNull();
    } finally {
      host.runtimeExecutablesCheck = originalCheck;
    }
  });

  test("uses runtime brand marks and opens Browse in the configured executable directory", async () => {
    const runtimes: AgentRuntimes = {
      opencode: { enabled: true, executablePath: "/Users/dev/.local/bin/opencode" },
      codex: { ...DEFAULT_AGENT_RUNTIMES.codex, enabled: false, executablePath: "" },
      claude: { enabled: false, executablePath: "" },
    };
    const original = {
      filesystemListDirectory: host.filesystemListDirectory,
      runtimeExecutablesCheck: host.runtimeExecutablesCheck,
    };
    const filesystemListDirectory = mock(async () => ({
      currentPath: "/Users/dev/.local/bin",
      currentPathIsGitRepo: false,
      parentPath: "/Users/dev/.local",
      homePath: "/Users/dev",
      entries: [],
    }));
    host.filesystemListDirectory = filesystemListDirectory;
    host.runtimeExecutablesCheck = mock(async () => createCheck(runtimes, true));

    try {
      renderOnboarding({ runtimes });
      await enterRuntimeStage();

      for (const definition of runtimeDefinitions) {
        const section = screen.getByRole("heading", { name: definition.label }).closest("section");
        if (!section) throw new Error(`${definition.label} section is missing`);
        const logo = section.querySelector<HTMLElement>(`[data-runtime-logo="${definition.kind}"]`);
        expect(logo?.querySelector("svg")).toBeTruthy();
        expect(logo?.className).not.toMatch(/\b(?:bg-|border|rounded)/);
      }
      expect(opencodeSection().textContent).not.toContain("OC");

      await act(async () => {
        fireEvent.click(within(opencodeSection()).getByRole("button", { name: "Browse" }));
        await Promise.resolve();
      });

      await waitFor(() =>
        expect(filesystemListDirectory).toHaveBeenCalledWith({
          path: "/Users/dev/.local/bin",
          includeFiles: true,
        }),
      );
      await screen.findByText("/Users/dev/.local/bin");
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    } finally {
      host.filesystemListDirectory = original.filesystemListDirectory;
      host.runtimeExecutablesCheck = original.runtimeExecutablesCheck;
    }
  });

  test("shows and retries a settings snapshot failure before a draft exists", async () => {
    const runtimes = DEFAULT_AGENT_RUNTIMES;
    const snapshot = createSettingsSnapshotFixture({ agentRuntimes: runtimes });
    let attempts = 0;
    const original = {
      runtimeExecutablesCheck: host.runtimeExecutablesCheck,
      runtimeDefinitionsList: host.runtimeDefinitionsList,
      workspaceGetSettingsSnapshot: host.workspaceGetSettingsSnapshot,
    };
    host.runtimeExecutablesCheck = mock(async () => createCheck(runtimes));
    host.runtimeDefinitionsList = mock(async () => runtimeDefinitions);
    host.workspaceGetSettingsSnapshot = mock(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("Settings snapshot failed");
      return snapshot;
    });

    try {
      renderOnboarding({ runtimes, prefillSettings: false, prefillDefinitions: false });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Configure coding agents" }));
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      await screen.findByText("Settings snapshot failed");
      expect(screen.queryByLabelText("Loading coding agent settings")).toBeNull();
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Retry" }));
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      await waitFor(() => expect(attempts).toBe(2));
      await screen.findByRole("heading", { name: "OpenCode" });
      await waitFor(() =>
        expect(
          (screen.getByRole("button", { name: /Continue/ }) as HTMLButtonElement).disabled,
        ).toBe(false),
      );
    } finally {
      host.runtimeExecutablesCheck = original.runtimeExecutablesCheck;
      host.runtimeDefinitionsList = original.runtimeDefinitionsList;
      host.workspaceGetSettingsSnapshot = original.workspaceGetSettingsSnapshot;
    }
  });

  test("shows and retries a runtime definition failure before a draft exists", async () => {
    const runtimes = DEFAULT_AGENT_RUNTIMES;
    const snapshot = createSettingsSnapshotFixture({ agentRuntimes: runtimes });
    let attempts = 0;
    const original = {
      runtimeExecutablesCheck: host.runtimeExecutablesCheck,
      runtimeDefinitionsList: host.runtimeDefinitionsList,
      workspaceGetSettingsSnapshot: host.workspaceGetSettingsSnapshot,
    };
    host.runtimeExecutablesCheck = mock(async () => createCheck(runtimes));
    host.workspaceGetSettingsSnapshot = mock(async () => snapshot);
    host.runtimeDefinitionsList = mock(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("Runtime definitions failed");
      return runtimeDefinitions;
    });

    try {
      renderOnboarding({ runtimes, prefillSettings: false, prefillDefinitions: false });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Configure coding agents" }));
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      await screen.findByText("Runtime definitions failed");
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Retry" }));
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      await waitFor(() => expect(attempts).toBe(2));
      await screen.findByRole("heading", { name: "OpenCode" });
      await waitFor(() =>
        expect(
          (screen.getByRole("button", { name: /Continue/ }) as HTMLButtonElement).disabled,
        ).toBe(false),
      );
    } finally {
      host.runtimeExecutablesCheck = original.runtimeExecutablesCheck;
      host.runtimeDefinitionsList = original.runtimeDefinitionsList;
      host.workspaceGetSettingsSnapshot = original.workspaceGetSettingsSnapshot;
    }
  });

  test("retries a failed runtime validation request", async () => {
    const runtimes: AgentRuntimes = {
      opencode: { enabled: true, executablePath: "/valid/opencode" },
      codex: { ...DEFAULT_AGENT_RUNTIMES.codex, enabled: false, executablePath: "" },
      claude: { enabled: false, executablePath: "" },
    };
    let attempts = 0;
    const snapshot = createSettingsSnapshotFixture({ agentRuntimes: runtimes });
    const original = {
      runtimeExecutablesCheck: host.runtimeExecutablesCheck,
      runtimeDefinitionsList: host.runtimeDefinitionsList,
      workspaceGetSettingsSnapshot: host.workspaceGetSettingsSnapshot,
    };
    host.runtimeExecutablesCheck = mock(async (input) => {
      if (input.mode === "validate" && Object.hasOwn(input.paths, "opencode")) {
        attempts += 1;
        if (attempts === 1) throw new Error("Runtime validation failed");
      }
      return createCheck(runtimes, true);
    });
    host.runtimeDefinitionsList = mock(async () => runtimeDefinitions);
    host.workspaceGetSettingsSnapshot = mock(async () => snapshot);

    try {
      renderOnboarding({ runtimes });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Configure coding agents" }));
        await Promise.resolve();
      });
      await screen.findByText("Runtime validation failed");
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));

      await waitFor(() => expect(attempts).toBe(2));
      await waitFor(() => expect(screen.queryByText("Runtime validation failed")).toBeNull());
      await within(opencodeSection()).findByText("Available");
    } finally {
      host.runtimeExecutablesCheck = original.runtimeExecutablesCheck;
      host.runtimeDefinitionsList = original.runtimeDefinitionsList;
      host.workspaceGetSettingsSnapshot = original.workspaceGetSettingsSnapshot;
    }
  });

  test("blocks Continue until a failed runtime rediscovery succeeds", async () => {
    const runtimes: AgentRuntimes = {
      opencode: { enabled: true, executablePath: "/valid/opencode" },
      codex: { ...DEFAULT_AGENT_RUNTIMES.codex, enabled: false, executablePath: "" },
      claude: { enabled: false, executablePath: "" },
    };
    let discoveryAttempts = 0;
    const originalCheck = host.runtimeExecutablesCheck;
    host.runtimeExecutablesCheck = mock(async (input) => {
      if (input.mode === "discover") {
        discoveryAttempts += 1;
        if (discoveryAttempts === 1) throw new Error("Runtime discovery failed");
      }
      return createCheck(runtimes, true);
    });

    try {
      renderOnboarding({ runtimes });
      await enterRuntimeStage();
      await within(opencodeSection()).findByText("Available");

      fireEvent.click(screen.getByRole("button", { name: "Scan for coding agents" }));
      await screen.findByText("Runtime discovery failed");

      expect((screen.getByRole("button", { name: /Continue/ }) as HTMLButtonElement).disabled).toBe(
        true,
      );
      fireEvent.click(screen.getByRole("button", { name: "Scan again" }));

      await waitFor(() => expect(discoveryAttempts).toBe(2));
      await waitFor(() => expect(screen.queryByText("Runtime discovery failed")).toBeNull());
      expect((screen.getByRole("button", { name: /Continue/ }) as HTMLButtonElement).disabled).toBe(
        false,
      );
    } finally {
      host.runtimeExecutablesCheck = originalCheck;
    }
  });

  test("runs explicit runtime discovery through the shared Query cache", async () => {
    const runtimes: AgentRuntimes = {
      opencode: { enabled: true, executablePath: "/valid/opencode" },
      codex: { ...DEFAULT_AGENT_RUNTIMES.codex, enabled: false, executablePath: "" },
      claude: { enabled: false, executablePath: "" },
    };
    const discovery = createDeferred<RuntimeExecutableCheck>();
    const originalCheck = host.runtimeExecutablesCheck;
    host.runtimeExecutablesCheck = mock(async (input) => {
      if (input.mode === "discover") return discovery.promise;
      return createCheck(runtimes, true);
    });

    try {
      const queryClient = renderOnboarding({ runtimes });
      await enterRuntimeStage();

      fireEvent.click(screen.getByRole("button", { name: "Scan for coding agents" }));
      await waitFor(() =>
        expect(
          queryClient.getQueryState(runtimeDiscoveryQueryOptions().queryKey)?.fetchStatus,
        ).toBe("fetching"),
      );

      await act(async () => {
        discovery.resolve(createCheck(runtimes, true));
      });
      await waitFor(() =>
        expect(queryClient.getQueryState(runtimeDiscoveryQueryOptions().queryKey)?.status).toBe(
          "success",
        ),
      );
    } finally {
      host.runtimeExecutablesCheck = originalCheck;
    }
  });

  test("locks runtime edits and navigation while explicit discovery is pending", async () => {
    const runtimes: AgentRuntimes = {
      opencode: { enabled: true, executablePath: "/valid/opencode" },
      codex: { ...DEFAULT_AGENT_RUNTIMES.codex, enabled: false, executablePath: "" },
      claude: { enabled: false, executablePath: "" },
    };
    const discoveredRuntimes: AgentRuntimes = {
      ...runtimes,
      opencode: { enabled: true, executablePath: "/discovered/opencode" },
    };
    const discovery = createDeferred<RuntimeExecutableCheck>();
    const originalCheck = host.runtimeExecutablesCheck;
    host.runtimeExecutablesCheck = mock(async (input) => {
      if (input.mode === "discover") return discovery.promise;
      const checkedRuntimes = {
        ...runtimes,
        opencode: { ...runtimes.opencode, executablePath: input.paths.opencode },
      };
      return createCheck(checkedRuntimes, true);
    });

    try {
      renderOnboarding({ runtimes });
      await enterRuntimeStage();

      fireEvent.click(screen.getByRole("button", { name: "Scan for coding agents" }));
      await screen.findByRole("button", { name: "Scanning..." });

      const pathInput = screen.getByLabelText("Executable path", {
        selector: "#runtime-executable-opencode",
      }) as HTMLInputElement;
      const enabledSwitch = within(opencodeSection()).getByRole("switch", {
        name: "Enabled",
      }) as HTMLButtonElement;
      const browseButton = within(opencodeSection()).getByRole("button", {
        name: "Browse",
      }) as HTMLButtonElement;
      const backButton = screen.getByRole("button", { name: "Back" }) as HTMLButtonElement;

      expect(pathInput.disabled).toBe(true);
      expect(enabledSwitch.disabled).toBe(true);
      expect(browseButton.disabled).toBe(true);
      expect(backButton.disabled).toBe(true);
      pathInput.focus();
      fireEvent.keyDown(pathInput, { key: "x" });
      enabledSwitch.click();
      expect(pathInput.value).toBe("/valid/opencode");
      expect(enabledSwitch.getAttribute("aria-checked")).toBe("true");

      await act(async () => discovery.resolve(createCheck(discoveredRuntimes, true)));
      await waitFor(() => expect(pathInput.value).toBe("/discovered/opencode"));
    } finally {
      host.runtimeExecutablesCheck = originalCheck;
    }
  });

  test("validates the exact paths returned by explicit runtime discovery", async () => {
    const runtimes: AgentRuntimes = {
      opencode: { enabled: true, executablePath: "/valid/opencode" },
      codex: { ...DEFAULT_AGENT_RUNTIMES.codex, enabled: false, executablePath: "" },
      claude: { enabled: false, executablePath: "" },
    };
    const discoveredRuntimes: AgentRuntimes = {
      ...runtimes,
      opencode: { enabled: true, executablePath: "/discovered/opencode" },
    };
    const requests: Array<"discover" | { opencodePath: string }> = [];
    const originalCheck = host.runtimeExecutablesCheck;
    host.runtimeExecutablesCheck = mock(async (input) => {
      if (input.mode === "discover") {
        requests.push("discover");
        return createCheck(discoveredRuntimes, true);
      }
      requests.push({ opencodePath: input.paths.opencode });
      const checkedRuntimes = {
        ...runtimes,
        opencode: { enabled: true, executablePath: input.paths.opencode },
      };
      return createCheck(checkedRuntimes, true);
    });

    try {
      renderOnboarding({ runtimes });
      await enterRuntimeStage();
      requests.length = 0;

      fireEvent.click(screen.getByRole("button", { name: "Scan for coding agents" }));

      await waitFor(() =>
        expect(requests).toEqual(["discover", { opencodePath: "/discovered/opencode" }]),
      );
    } finally {
      host.runtimeExecutablesCheck = originalCheck;
    }
  });

  test("blocks Continue while a changed path is being checked and rejects the new invalid path", async () => {
    const initialRuntimes: AgentRuntimes = {
      opencode: { enabled: true, executablePath: "/valid/opencode" },
      codex: { ...DEFAULT_AGENT_RUNTIMES.codex, enabled: false, executablePath: "" },
      claude: { enabled: false, executablePath: "" },
    };
    const invalidCheck = createDeferred<RuntimeExecutableCheck>();
    const runtimeExecutablesCheck = mock(async (input) => {
      if (input.mode === "validate" && input.paths.opencode === "/invalid/opencode") {
        return invalidCheck.promise;
      }
      return createCheck(initialRuntimes, true);
    });
    const saveSettingsSnapshot = mock(async () => {});
    const originalCheck = host.runtimeExecutablesCheck;
    host.runtimeExecutablesCheck = runtimeExecutablesCheck;

    try {
      renderOnboarding({ runtimes: initialRuntimes, saveSettingsSnapshot });
      await enterRuntimeStage();
      await within(opencodeSection()).findByText("Available");

      fireEvent.change(
        screen.getByLabelText("Executable path", { selector: "#runtime-executable-opencode" }),
        {
          target: { value: "/invalid/opencode" },
        },
      );

      expect((screen.getByRole("button", { name: /Continue/ }) as HTMLButtonElement).disabled).toBe(
        true,
      );
      expect(within(opencodeSection()).queryByText("Available")).toBeNull();
      await act(async () => {
        invalidCheck.resolve(
          createCheck(
            {
              ...initialRuntimes,
              opencode: { enabled: true, executablePath: "/invalid/opencode" },
            },
            false,
          ),
        );
      });
      await waitFor(() =>
        expect(
          (screen.getByRole("button", { name: /Continue/ }) as HTMLButtonElement).disabled,
        ).toBe(false),
      );
      fireEvent.click(screen.getByRole("button", { name: /Continue/ }));

      expect(screen.getAllByText("OpenCode executable is invalid.").length).toBeGreaterThan(0);
      expect(saveSettingsSnapshot).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(
        screen.getByLabelText("Executable path", { selector: "#runtime-executable-opencode" }),
      );
    } finally {
      host.runtimeExecutablesCheck = originalCheck;
    }
  });

  test("checks only the runtime whose executable path changed", async () => {
    const runtimes: AgentRuntimes = {
      opencode: { enabled: true, executablePath: "/valid/opencode" },
      codex: { ...DEFAULT_AGENT_RUNTIMES.codex, enabled: true, executablePath: "/valid/codex" },
      claude: { enabled: true, executablePath: "/valid/claude" },
    };
    const requests: RuntimeKind[][] = [];
    const changedCheck = createDeferred<RuntimeExecutableCheck>();
    const originalCheck = host.runtimeExecutablesCheck;
    host.runtimeExecutablesCheck = mock(async (input) => {
      if (input.mode !== "validate") return createCheck(runtimes, true);
      const kinds = Object.keys(input.paths) as RuntimeKind[];
      requests.push(kinds);
      if (input.paths.opencode === "/changed/opencode") return changedCheck.promise;
      return {
        runtimes: kinds.map((kind) => ({
          kind,
          path: input.paths[kind] ?? "",
          ok: true,
          version: `${kind} 1.0.0`,
          error: null,
        })),
      };
    });

    try {
      renderOnboarding({ runtimes });
      await enterRuntimeStage();
      requests.length = 0;

      fireEvent.change(
        screen.getByLabelText("Executable path", { selector: "#runtime-executable-opencode" }),
        { target: { value: "/changed/opencode" } },
      );

      await within(opencodeSection()).findByText("Checking");
      expect(requests).toEqual([["opencode"]]);
      const codexSection = screen.getByRole("heading", { name: "Codex" }).closest("section");
      if (!codexSection) throw new Error("Codex section is missing");
      expect(within(codexSection).queryByText("Checking")).toBeNull();

      await act(async () => {
        changedCheck.resolve({
          runtimes: [
            {
              kind: "opencode",
              path: "/changed/opencode",
              ok: true,
              version: "opencode 1.0.0",
              error: null,
            },
          ],
        });
      });
      await within(opencodeSection()).findByText("opencode 1.0.0");
      expect(within(opencodeSection()).queryByText(/\/changed\/opencode/)).toBeNull();
    } finally {
      host.runtimeExecutablesCheck = originalCheck;
    }
  });

  test("auto-enables a valid custom path unless the user changed the switch", async () => {
    const runtimes: AgentRuntimes = {
      opencode: { enabled: false, executablePath: "" },
      codex: { ...DEFAULT_AGENT_RUNTIMES.codex, enabled: false, executablePath: "" },
      claude: { enabled: false, executablePath: "" },
    };
    const originalCheck = host.runtimeExecutablesCheck;
    host.runtimeExecutablesCheck = mock(async (input) => {
      if (input.mode !== "validate") return createCheck(runtimes);
      const kinds = Object.keys(input.paths) as RuntimeKind[];
      return {
        runtimes: kinds.map((kind) => {
          const path = input.paths[kind] ?? "";
          const ok = kind === "opencode" && path.startsWith("/custom/");
          return {
            kind,
            path,
            ok,
            version: ok ? "1.0.0" : null,
            error: ok ? null : `${kind} executable is invalid.`,
          };
        }),
      };
    });

    try {
      renderOnboarding({ runtimes });
      await enterRuntimeStage();
      const pathInput = screen.getByLabelText("Executable path", {
        selector: "#runtime-executable-opencode",
      });
      const enabledSwitch = within(opencodeSection()).getByRole("switch", { name: "Enabled" });

      fireEvent.change(pathInput, { target: { value: "/custom/opencode" } });
      await waitFor(() => expect(enabledSwitch.getAttribute("aria-checked")).toBe("true"));
      fireEvent.click(enabledSwitch);
      expect(enabledSwitch.getAttribute("aria-checked")).toBe("false");
      fireEvent.change(pathInput, { target: { value: "/custom/opencode-v2" } });
      await within(opencodeSection()).findByText("1.0.0");
      expect(within(opencodeSection()).queryByText(/\/custom\/opencode-v2/)).toBeNull();
      expect(enabledSwitch.getAttribute("aria-checked")).toBe("false");
    } finally {
      host.runtimeExecutablesCheck = originalCheck;
    }
  });

  test("keeps the runtime step on save failure and supports retry, Workspace, and Back", async () => {
    const runtimes: AgentRuntimes = {
      opencode: { enabled: false, executablePath: "" },
      codex: { ...DEFAULT_AGENT_RUNTIMES.codex, enabled: false, executablePath: "" },
      claude: { enabled: false, executablePath: "" },
    };
    let saveCalls = 0;
    const saveSettingsSnapshot = mock(async () => {
      saveCalls += 1;
      if (saveCalls === 1) throw new Error("Settings write failed");
    });
    const originalCheck = host.runtimeExecutablesCheck;
    host.runtimeExecutablesCheck = mock(async () => createCheck(runtimes));

    try {
      renderOnboarding({ runtimes, saveSettingsSnapshot });
      await enterRuntimeStage();
      expect(screen.queryByText("Agent tools")).toBeNull();
      await waitFor(() =>
        expect(
          (screen.getByRole("button", { name: /Continue/ }) as HTMLButtonElement).disabled,
        ).toBe(false),
      );
      fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
      await screen.findByRole("dialog", { name: "Continue without a coding agent?" });
      fireEvent.click(screen.getByRole("button", { name: "Continue without a coding agent" }));
      const saveError = await screen.findByText("Settings write failed");
      expect(screen.getByText("Configure coding agents")).toBeTruthy();
      expect(screen.queryByRole("dialog", { name: "Continue without a coding agent?" })).toBeNull();
      expect(document.activeElement).toBe(saveError);

      fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
      await screen.findByRole("dialog", { name: "Continue without a coding agent?" });
      fireEvent.click(screen.getByRole("button", { name: "Continue without a coding agent" }));
      await screen.findByRole("heading", { name: "Open your first workspace" });
      expect(screen.queryByText("Repository boundary")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: /Back/ }));
      expect(screen.getByRole("heading", { name: "Configure coding agents" })).toBeTruthy();
      expect(saveSettingsSnapshot).toHaveBeenCalledTimes(2);
    } finally {
      host.runtimeExecutablesCheck = originalCheck;
    }
  });

  test("submits the no-runtime confirmation only once while saving", async () => {
    const runtimes = DEFAULT_AGENT_RUNTIMES;
    const save = createDeferred<void>();
    const saveSettingsSnapshot = mock(async () => save.promise);
    const originalCheck = host.runtimeExecutablesCheck;
    host.runtimeExecutablesCheck = mock(async () => createCheck(runtimes));

    try {
      renderOnboarding({ runtimes, saveSettingsSnapshot });
      await enterRuntimeStage();
      fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
      await screen.findByRole("dialog", { name: "Continue without a coding agent?" });

      const confirmButton = screen.getByRole("button", {
        name: "Continue without a coding agent",
      });
      fireEvent.click(confirmButton);
      fireEvent.click(confirmButton);

      expect(saveSettingsSnapshot).toHaveBeenCalledTimes(1);
      expect(
        (screen.getByRole("button", { name: "Saving..." }) as HTMLButtonElement).disabled,
      ).toBe(true);
      expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(
        true,
      );

      await act(async () => save.resolve());
      await screen.findByRole("heading", { name: "Open your first workspace" });
    } finally {
      host.runtimeExecutablesCheck = originalCheck;
    }
  });

  test("keeps the no-runtime warning visible after confirmation is cancelled", async () => {
    const runtimes = DEFAULT_AGENT_RUNTIMES;
    const originalCheck = host.runtimeExecutablesCheck;
    host.runtimeExecutablesCheck = mock(async () => createCheck(runtimes));

    try {
      renderOnboarding({ runtimes });
      await enterRuntimeStage();
      fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
      await screen.findByRole("dialog", { name: "Continue without a coding agent?" });

      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

      expect(screen.queryByRole("dialog", { name: "Continue without a coding agent?" })).toBeNull();
      expect(
        screen.getByText(
          "Agent sessions will not work until you configure and enable a valid coding agent in Settings.",
        ),
      ).toBeTruthy();
    } finally {
      host.runtimeExecutablesCheck = originalCheck;
    }
  });
});
