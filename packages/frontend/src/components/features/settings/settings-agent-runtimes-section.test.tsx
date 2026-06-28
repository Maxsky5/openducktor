import { describe, expect, test } from "bun:test";
import {
  type AgentRuntimes,
  CODEX_RUNTIME_DESCRIPTOR,
  DEFAULT_AGENT_RUNTIMES,
  OPENCODE_RUNTIME_DESCRIPTOR,
} from "@openducktor/contracts";
import { fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";
import { AgentRuntimesSection } from "./settings-agent-runtimes-section";

enableReactActEnvironment();

const createSection = (agentRuntimes: AgentRuntimes = DEFAULT_AGENT_RUNTIMES) =>
  createElement(AgentRuntimesSection, {
    agentRuntimes,
    runtimeDefinitions: [CODEX_RUNTIME_DESCRIPTOR, OPENCODE_RUNTIME_DESCRIPTOR],
    disabled: false,
    isCodexDangerAcknowledged: false,
    onCodexDangerAcknowledgedChange: () => {},
    onUpdateAgentRuntimes: () => {},
  });

const renderCodexSectionHtml = (agentRuntimes: AgentRuntimes = DEFAULT_AGENT_RUNTIMES): string => {
  const renderer = render(createSection(agentRuntimes));
  try {
    fireEvent.click(screen.getByRole("tab", { name: /Codex/i }));
    return renderer.container.innerHTML;
  } finally {
    renderer.unmount();
  }
};

describe("AgentRuntimesSection", () => {
  test("shows vertical runtime tabs with status badges and selects OpenCode first", () => {
    const renderer = render(createSection());

    try {
      const tabs = screen.getAllByRole("tab");
      expect(tabs).toHaveLength(2);
      expect(tabs[0]?.textContent).toContain("OpenCode");
      expect(tabs[0]?.textContent).toContain("Enabled");
      expect(tabs[1]?.textContent).toContain("Codex");
      expect(tabs[1]?.textContent).toContain("Disabled");
      expect(tabs[0]?.getAttribute("aria-selected")).toBe("true");
      expect(renderer.container.innerHTML).toContain(
        "Local OpenCode runtime connected through the OpenDucktor MCP bridge.",
      );
      expect(renderer.container.innerHTML).not.toContain("Role override");
      expect(renderer.container.innerHTML).not.toContain("Sandbox mode");
    } finally {
      renderer.unmount();
    }
  });

  test("shows disabled status in runtime tab titles", () => {
    const renderer = render(
      createSection({
        ...DEFAULT_AGENT_RUNTIMES,
        opencode: { enabled: false },
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
    expect(html).toContain("On request");
    expect(html).toContain("User");
    expect(html).toContain("Command network access");
    expect(html).toContain("Keep command network blocked when sandbox mode is workspace-write.");
  });

  test("feature role tabs hide non-selected role content and Builder cannot select read-only", () => {
    const renderer = render(createSection());

    try {
      fireEvent.click(screen.getByRole("tab", { name: /Codex/i }));
      fireEvent.click(screen.getAllByRole("tab", { name: "Builder" })[0] as HTMLElement);

      const html = renderer.container.innerHTML;
      const builderRoleStart = html.indexOf("Uses Workspace-write");
      const builderRoleEnd = html.indexOf("Effective for Builder", builderRoleStart);
      const builderRoleHtml = html.slice(builderRoleStart, builderRoleEnd);
      expect(html).toContain("Inherit default");
      expect(html).toContain("Effective for Builder");
      expect(builderRoleHtml).not.toContain("Effective for Spec");
      expect(builderRoleHtml).not.toContain(
        "Codex can inspect files but cannot change the workspace.",
      );
      expect(builderRoleHtml).toContain("Codex can edit files in the workspace");
      expect(builderRoleHtml).toContain("Codex runs without sandbox boundaries");
    } finally {
      renderer.unmount();
    }
  });

  test("read-only Codex role overrides present acknowledged dangerous choices", () => {
    const html = renderCodexSectionHtml();
    const roleSandboxStart = html.indexOf("Uses Workspace-write");
    const approvalStart = html.indexOf("Approval prompts");
    const specSandboxHtml = html.slice(roleSandboxStart, approvalStart);

    expect(specSandboxHtml).toContain("Read-only");
    expect(specSandboxHtml).toContain("Workspace-write");
    expect(specSandboxHtml).toContain("Danger full access");

    const roleApprovalStart = html.indexOf("Uses On request");
    const reviewerStart = html.indexOf("Prompt reviewer");
    const specApprovalHtml = html.slice(roleApprovalStart, reviewerStart);
    expect(specApprovalHtml).toContain("Never");
  });

  test("command network access uses switches instead of option cards", () => {
    const renderer = render(createSection());

    try {
      fireEvent.click(screen.getByRole("tab", { name: /Codex/i }));

      expect(screen.getByRole("switch", { name: "Command network access" })).toBeTruthy();
      expect(screen.getByRole("switch", { name: "Override command network access" })).toBeTruthy();
      expect(renderer.container.innerHTML).not.toContain(
        "Allow network for commands when sandbox mode is workspace-write.</span></button>",
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
      fireEvent.click(screen.getAllByRole("tab", { name: "Builder" })[0] as HTMLElement);
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
    const html = renderCodexSectionHtml({
      ...DEFAULT_AGENT_RUNTIMES,
      codex: {
        ...DEFAULT_AGENT_RUNTIMES.codex,
        defaults: {
          ...DEFAULT_AGENT_RUNTIMES.codex.defaults,
          approvalPolicy: "never",
          sandboxMode: "danger-full-access",
        },
      },
    });

    expect(html).toContain("has no effect while approval prompts are never");
    expect(html).toContain("Other sandbox modes ignore this switch");
    expect(html).toContain("danger-full-access removes sandbox boundaries");
    expect(html).toContain("never disables approval prompts");
    expect(html).toContain("Approval prompts go to the user");
    expect(html).toContain("Eligible prompts go through Codex automatic review");
    expect(html).toContain("Acknowledgement required");
    expect(html).toContain("I understand these Codex settings reduce safety protections.");
  });

  test("hides risky acknowledgement control when Codex selections are safe", () => {
    const html = renderCodexSectionHtml();

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
});
