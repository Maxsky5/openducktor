import { describe, expect, mock, test } from "bun:test";
import {
  type AgentRuntimes,
  CLAUDE_RUNTIME_DESCRIPTOR,
  CODEX_RUNTIME_DESCRIPTOR,
  DEFAULT_AGENT_RUNTIMES,
  OPENCODE_RUNTIME_DESCRIPTOR,
} from "@openducktor/contracts";
import { fireEvent, screen, render as testingRender, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryProvider } from "@/lib/query-provider";
import { configureShellBridge, getShellBridge } from "@/lib/shell-bridge";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";
import { host } from "@/state/operations/host";
import { AgentRuntimesSection } from "./settings-agent-runtimes-section";

enableReactActEnvironment();

const withQueryProvider = (ui: ReactNode): ReactNode => (
  <QueryProvider useIsolatedClient>{ui}</QueryProvider>
);

const render = (ui: ReactNode) => {
  const rendered = testingRender(withQueryProvider(ui));
  return {
    ...rendered,
    rerender: (next: ReactNode) => rendered.rerender(withQueryProvider(next)),
  };
};

const createSection = (
  agentRuntimes: AgentRuntimes = DEFAULT_AGENT_RUNTIMES,
  { requiresCodexDangerAcknowledgement = false } = {},
) =>
  createElement(AgentRuntimesSection, {
    agentRuntimes,
    runtimeDefinitions: [
      CLAUDE_RUNTIME_DESCRIPTOR,
      CODEX_RUNTIME_DESCRIPTOR,
      OPENCODE_RUNTIME_DESCRIPTOR,
    ],
    disabled: false,
    requiresCodexDangerAcknowledgement,
    isCodexDangerAcknowledged: false,
    onCodexDangerAcknowledgedChange: () => {},
    onUpdateAgentRuntimes: () => {},
  });

const renderCodexSectionHtml = (
  agentRuntimes: AgentRuntimes = DEFAULT_AGENT_RUNTIMES,
  { requiresCodexDangerAcknowledgement = false } = {},
): string => {
  const renderer = render(createSection(agentRuntimes, { requiresCodexDangerAcknowledgement }));
  try {
    fireEvent.click(screen.getByRole("tab", { name: /Codex/i }));
    return renderer.container.innerHTML;
  } finally {
    renderer.unmount();
  }
};

describe("AgentRuntimesSection", () => {
  test("shows runtime definition failures and retries them", async () => {
    const retryRuntimeDefinitions = mock(async () => [OPENCODE_RUNTIME_DESCRIPTOR]);
    const renderer = render(
      createElement(AgentRuntimesSection, {
        agentRuntimes: DEFAULT_AGENT_RUNTIMES,
        runtimeDefinitions: [],
        runtimeDefinitionsError: "Definitions failed",
        isLoadingRuntimeDefinitions: false,
        onRetryRuntimeDefinitions: retryRuntimeDefinitions,
        disabled: false,
        requiresCodexDangerAcknowledgement: false,
        isCodexDangerAcknowledged: false,
        onCodexDangerAcknowledgedChange: () => {},
        onUpdateAgentRuntimes: () => {},
      }),
    );

    try {
      expect(
        screen.getByText(/Failed to load runtime definitions: Definitions failed/i),
      ).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Retry runtime definitions" }));
      await waitFor(() => expect(retryRuntimeDefinitions).toHaveBeenCalledTimes(1));
    } finally {
      renderer.unmount();
    }
  });

  test("shows runtime executable request failures and retries them", async () => {
    const originalCheck = host.runtimeExecutablesCheck;
    let attempts = 0;
    host.runtimeExecutablesCheck = mock(async (input) => {
      attempts += 1;
      if (attempts === 1) throw new Error("Executable request failed");
      if (input.mode !== "validate") throw new Error("Expected path validation");
      return {
        runtimes: (["opencode", "codex", "claude"] as const).map((kind) => ({
          kind,
          path: input.paths[kind],
          ok: false,
          version: null,
          error: `${kind} is unavailable`,
        })),
      };
    });
    const renderer = render(createSection());

    try {
      await screen.findByText(/Failed to check runtime executables: Executable request failed/i);
      fireEvent.click(screen.getByRole("button", { name: "Retry executable check" }));
      await waitFor(() => expect(attempts).toBe(2));
      await waitFor(() => expect(screen.queryByText(/Executable request failed/i)).toBeNull());
    } finally {
      host.runtimeExecutablesCheck = originalCheck;
      renderer.unmount();
    }
  });

  test("shows vertical runtime tabs with status badges and selects OpenCode first", () => {
    const renderer = render(
      createSection({
        ...DEFAULT_AGENT_RUNTIMES,
        opencode: { ...DEFAULT_AGENT_RUNTIMES.opencode, enabled: true },
      }),
    );

    try {
      const tabs = screen.getAllByRole("tab");
      expect(tabs).toHaveLength(3);
      expect(tabs[0]?.textContent).toContain("OpenCode");
      expect(tabs[0]?.textContent).toContain("Enabled");
      expect(tabs[1]?.textContent).toContain("Claude");
      expect(tabs[1]?.textContent).toContain("Disabled");
      expect(tabs[2]?.textContent).toContain("Codex");
      expect(tabs[2]?.textContent).toContain("Disabled");
      expect(tabs[0]?.getAttribute("aria-selected")).toBe("true");
      expect(renderer.container.innerHTML).toContain(
        "Local OpenCode runtime connected through the OpenDucktor MCP bridge.",
      );
      expect(renderer.container.innerHTML).not.toContain("Supports workspace, task, build");
      expect(renderer.container.innerHTML).not.toContain("Role override");
      expect(renderer.container.innerHTML).not.toContain("Sandbox mode");
    } finally {
      renderer.unmount();
    }
  });

  test("shows Claude setup guidance and opens its links through the shell bridge", async () => {
    const originalShellBridge = getShellBridge();
    const openedUrls: string[] = [];
    configureShellBridge({
      ...originalShellBridge,
      openExternalUrl: async (url) => {
        openedUrls.push(url);
      },
    });
    const renderer = render(
      createElement(AgentRuntimesSection, {
        agentRuntimes: DEFAULT_AGENT_RUNTIMES,
        runtimeDefinitions: [CLAUDE_RUNTIME_DESCRIPTOR],
        runtimeCheck: {
          gitOk: true,
          gitVersion: "git version 2.50.0",
          ghOk: true,
          ghVersion: null,
          ghAuthOk: true,
          ghAuthLogin: null,
          ghAuthError: null,
          runtimes: [
            {
              kind: "claude",
              enabled: false,
              ok: true,
              executablePath: "/bin/claude",
              version: "2.1.0",
              error: null,
            },
          ],
          errors: [],
        },
        disabled: false,
        requiresCodexDangerAcknowledgement: false,
        isCodexDangerAcknowledged: false,
        onCodexDangerAcknowledgedChange: () => {},
        onUpdateAgentRuntimes: () => {},
      }),
    );

    try {
      expect(renderer.container.textContent).toContain("Ready (2.1.0)");
      expect(renderer.container.textContent).toContain("Verified when a Claude session starts");
      expect(renderer.container.textContent).toContain("ANTHROPIC_API_KEY");
      fireEvent.click(screen.getByRole("button", { name: "Installation and authentication" }));
      fireEvent.click(screen.getByRole("button", { name: "Current Agent SDK plan policy" }));
      await waitFor(() => {
        expect(openedUrls).toEqual([
          "https://docs.anthropic.com/en/docs/claude-code/getting-started",
          "https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan",
        ]);
      });
    } finally {
      renderer.unmount();
      configureShellBridge(originalShellBridge);
    }
  });

  test("shows disabled status in runtime tab titles", () => {
    const renderer = render(
      createSection({
        ...DEFAULT_AGENT_RUNTIMES,
        opencode: { enabled: false, executablePath: "" },
      }),
    );

    try {
      expect(screen.getByRole("tab", { name: /OpenCode/i }).textContent).toContain("Disabled");
    } finally {
      renderer.unmount();
    }
  });

  test("renders Codex configuration only when Codex is selected", () => {
    const renderer = render(createSection());

    try {
      fireEvent.click(screen.getByRole("tab", { name: /Codex/i }));

      expect(screen.getByRole("tab", { name: /Codex/i }).getAttribute("aria-selected")).toBe(
        "true",
      );
      expect(renderer.container.innerHTML).toContain("Role override");
      expect(renderer.container.innerHTML).toContain("Sandbox mode");
      expect(renderer.container.innerHTML).not.toContain(
        "Local OpenCode runtime connected through the OpenDucktor MCP bridge.",
      );
    } finally {
      renderer.unmount();
    }
  });

  test("renders Codex feature groups from contract values", () => {
    const html = renderCodexSectionHtml();

    expect(html).toContain("Role override");
    expect(html).toContain("Workspace-write");
    expect(html).toContain("Danger full access");
    expect(html).toContain("On request");
    expect(html).toContain("User");
    expect(html).toContain("Command network access");
    expect(html).toContain("Keep command network blocked in sandboxed Codex turns.");
    expect(html).toContain("bg-info-surface");
    expect(html).not.toContain("About this setting");
    expect(html).not.toContain("bg-card/70");
    expect(html).not.toContain("text-info-muted");
  });

  test("role override sections hide role rows until enabled", () => {
    const renderer = render(createSection());

    try {
      fireEvent.click(screen.getByRole("tab", { name: /Codex/i }));

      expect(
        screen
          .getByRole("switch", { name: "Enable Sandbox mode role overrides" })
          .getAttribute("aria-checked"),
      ).toBe("false");
      expect(screen.getByRole("button", { name: "Default sandbox mode" }).textContent).toContain(
        "Workspace-write",
      );
      expect(screen.queryByRole("button", { name: "Spec" })).toBeNull();
      expect(renderer.container.innerHTML).not.toContain("Inherits the default value.");
    } finally {
      renderer.unmount();
    }
  });

  test("role override rows render only when a setting has an override", () => {
    const renderer = render(
      createSection({
        ...DEFAULT_AGENT_RUNTIMES,
        codex: {
          ...DEFAULT_AGENT_RUNTIMES.codex,
          roleOverrides: {
            spec: { sandboxMode: "read-only" },
          },
        },
      }),
    );

    try {
      fireEvent.click(screen.getByRole("tab", { name: /Codex/i }));

      expect(
        screen
          .getByRole("switch", { name: "Enable Sandbox mode role overrides" })
          .getAttribute("aria-checked"),
      ).toBe("true");
      expect(screen.getByRole("button", { name: "Spec" }).textContent).toContain("Read-only");
      expect(screen.getByRole("button", { name: "Planner" }).textContent).toContain("Inherited");
      expect(renderer.container.innerHTML).not.toContain("Uses the default value.");
      expect(renderer.container.innerHTML).not.toContain("Override set for this role.");
    } finally {
      renderer.unmount();
    }
  });

  test("enabling role overrides opens inherited rows without writing overrides", () => {
    const updates: AgentRuntimes[] = [];
    const renderer = render(
      createElement(AgentRuntimesSection, {
        agentRuntimes: DEFAULT_AGENT_RUNTIMES,
        runtimeDefinitions: [CODEX_RUNTIME_DESCRIPTOR, OPENCODE_RUNTIME_DESCRIPTOR],
        disabled: false,
        requiresCodexDangerAcknowledgement: false,
        isCodexDangerAcknowledged: false,
        onCodexDangerAcknowledgedChange: () => {},
        onUpdateAgentRuntimes: (updater) => {
          updates.push(updater(DEFAULT_AGENT_RUNTIMES));
        },
      }),
    );

    try {
      fireEvent.click(screen.getByRole("tab", { name: /Codex/i }));
      fireEvent.click(screen.getByRole("switch", { name: "Enable Sandbox mode role overrides" }));

      expect(updates).toHaveLength(0);
      expect(screen.getByRole("button", { name: "Spec" }).textContent).toContain("Inherited");
      expect(screen.getByRole("button", { name: "Planner" }).textContent).toContain("Inherited");
      expect(screen.getByRole("button", { name: "Builder" }).textContent).toContain("Inherited");
      expect(screen.getByRole("button", { name: "QA" }).textContent).toContain("Inherited");
    } finally {
      renderer.unmount();
    }
  });

  test("command network access uses dropdowns instead of setting switches", () => {
    const renderer = render(createSection());

    try {
      fireEvent.click(screen.getByRole("tab", { name: /Codex/i }));

      expect(
        screen.getByRole("button", { name: "Default command network access" }).textContent,
      ).toContain("Off");
      expect(screen.queryByRole("switch", { name: "Command network access" })).toBeNull();
      expect(
        screen.getByRole("switch", { name: "Enable Command network access role overrides" }),
      ).toBeTruthy();
      expect(renderer.container.innerHTML).toContain(
        "Keep command network blocked in sandboxed Codex turns.",
      );
    } finally {
      renderer.unmount();
    }
  });

  test("default read-only shows Builder effective workspace-write reason", () => {
    const renderer = render(
      createSection({
        ...DEFAULT_AGENT_RUNTIMES,
        codex: {
          ...DEFAULT_AGENT_RUNTIMES.codex,
          defaults: { ...DEFAULT_AGENT_RUNTIMES.codex.defaults, sandboxMode: "read-only" },
        },
      }),
    );

    try {
      fireEvent.click(screen.getByRole("tab", { name: /Codex/i }));
      const html = renderer.container.innerHTML;

      expect(html).toContain(
        "Build role requires workspace-write when sandboxMode is inherited from read-only.",
      );
    } finally {
      renderer.unmount();
    }
  });

  test("does not render deprecated Codex values", () => {
    const html = renderCodexSectionHtml();

    expect(html).not.toContain("on-failure");
    expect(html).not.toContain("guardian_subagent");
  });

  test("renders reviewer, network, and risky acknowledgement copy", () => {
    const html = renderCodexSectionHtml(
      {
        ...DEFAULT_AGENT_RUNTIMES,
        codex: {
          ...DEFAULT_AGENT_RUNTIMES.codex,
          defaults: {
            ...DEFAULT_AGENT_RUNTIMES.codex.defaults,
            approvalPolicy: "never",
            sandboxMode: "danger-full-access",
          },
        },
      },
      { requiresCodexDangerAcknowledgement: true },
    );

    expect(html).toContain("has no effect while approval prompts are never");
    expect(html).toContain("Danger full access is unrestricted");
    expect(html).toContain("Confirm reduced Codex protections");
    expect(html).toContain("Danger full access removes sandbox boundaries");
    expect(html).toContain("The Never approval prompt option lets Codex proceed without asking");
    expect(html).toContain("Approval prompts go to the user");
    expect(html).toContain("I understand these Codex settings reduce safety protections.");
  });

  test("renders risky acknowledgement before policy sections", () => {
    const html = renderCodexSectionHtml(
      {
        ...DEFAULT_AGENT_RUNTIMES,
        codex: {
          ...DEFAULT_AGENT_RUNTIMES.codex,
          defaults: {
            ...DEFAULT_AGENT_RUNTIMES.codex.defaults,
            sandboxMode: "danger-full-access",
          },
        },
      },
      { requiresCodexDangerAcknowledgement: true },
    );

    expect(html.indexOf("Confirm reduced Codex protections")).toBeLessThan(
      html.indexOf("Sandbox mode"),
    );
  });

  test("hides risky acknowledgement control when Codex selections are safe", () => {
    const html = renderCodexSectionHtml();

    expect(html).not.toContain("I understand these Codex settings reduce safety protections.");
  });

  test("hides risky acknowledgement control when risky settings do not require acknowledgement", () => {
    const html = renderCodexSectionHtml({
      ...DEFAULT_AGENT_RUNTIMES,
      codex: {
        ...DEFAULT_AGENT_RUNTIMES.codex,
        defaults: {
          ...DEFAULT_AGENT_RUNTIMES.codex.defaults,
          sandboxMode: "danger-full-access",
        },
      },
    });

    expect(html).not.toContain("Confirm reduced Codex protections");
    expect(html).not.toContain("I understand these Codex settings reduce safety protections.");
  });

  test("toggles risky acknowledgement through parent state", () => {
    let acknowledged = false;
    const renderer = render(
      createElement(AgentRuntimesSection, {
        agentRuntimes: {
          ...DEFAULT_AGENT_RUNTIMES,
          codex: {
            ...DEFAULT_AGENT_RUNTIMES.codex,
            defaults: {
              ...DEFAULT_AGENT_RUNTIMES.codex.defaults,
              approvalPolicy: "never",
            },
          },
        },
        runtimeDefinitions: [CODEX_RUNTIME_DESCRIPTOR, OPENCODE_RUNTIME_DESCRIPTOR],
        disabled: false,
        requiresCodexDangerAcknowledgement: true,
        isCodexDangerAcknowledged: acknowledged,
        onCodexDangerAcknowledgedChange: (next) => {
          acknowledged = next;
        },
        onUpdateAgentRuntimes: () => {},
      }),
    );

    try {
      fireEvent.click(screen.getByRole("tab", { name: /Codex/i }));
      fireEvent.click(screen.getByRole("switch", { name: /reduce safety protections/i }));

      expect(acknowledged).toBe(true);
    } finally {
      renderer.unmount();
    }
  });

  test("selects a valid runtime tab after definitions load asynchronously", () => {
    const renderer = render(
      createElement(AgentRuntimesSection, {
        agentRuntimes: DEFAULT_AGENT_RUNTIMES,
        runtimeDefinitions: [],
        disabled: false,
        requiresCodexDangerAcknowledgement: false,
        isCodexDangerAcknowledged: false,
        onCodexDangerAcknowledgedChange: () => {},
        onUpdateAgentRuntimes: () => {},
      }),
    );

    try {
      renderer.rerender(
        createElement(AgentRuntimesSection, {
          agentRuntimes: DEFAULT_AGENT_RUNTIMES,
          runtimeDefinitions: [CODEX_RUNTIME_DESCRIPTOR, OPENCODE_RUNTIME_DESCRIPTOR],
          disabled: false,
          requiresCodexDangerAcknowledgement: false,
          isCodexDangerAcknowledged: false,
          onCodexDangerAcknowledgedChange: () => {},
          onUpdateAgentRuntimes: () => {},
        }),
      );

      expect(screen.getByRole("tab", { name: /OpenCode/i }).getAttribute("aria-selected")).toBe(
        "true",
      );
    } finally {
      renderer.unmount();
    }
  });

  test("falls back to an available runtime when the selected runtime disappears", () => {
    const renderer = render(createSection());

    try {
      fireEvent.click(screen.getByRole("tab", { name: /Codex/i }));
      expect(screen.getByRole("tab", { name: /Codex/i }).getAttribute("aria-selected")).toBe(
        "true",
      );

      renderer.rerender(
        createElement(AgentRuntimesSection, {
          agentRuntimes: DEFAULT_AGENT_RUNTIMES,
          runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
          disabled: false,
          requiresCodexDangerAcknowledgement: false,
          isCodexDangerAcknowledged: false,
          onCodexDangerAcknowledgedChange: () => {},
          onUpdateAgentRuntimes: () => {},
        }),
      );

      expect(screen.getByRole("tab", { name: /OpenCode/i }).getAttribute("aria-selected")).toBe(
        "true",
      );
      expect(renderer.container.innerHTML).toContain(
        "Local OpenCode runtime connected through the OpenDucktor MCP bridge.",
      );
    } finally {
      renderer.unmount();
    }
  });
});
