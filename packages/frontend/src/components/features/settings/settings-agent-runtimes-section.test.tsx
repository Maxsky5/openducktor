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
      expect(renderer.container.innerHTML).not.toContain("Codex defaults");
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
      expect(renderer.container.innerHTML).toContain("Codex defaults");
      expect(renderer.container.innerHTML).toContain("Sandbox mode");
      expect(renderer.container.innerHTML).not.toContain(
        "Local OpenCode runtime connected through the OpenDucktor MCP bridge.",
      );
    } finally {
      renderer.unmount();
    }
  });

  test("renders Codex defaults from contract values", () => {
    const html = renderCodexSectionHtml();

    expect(html).toContain("Codex defaults");
    expect(html).toContain("workspace-write");
    expect(html).toContain("on-request");
    expect(html).toContain("user");
    expect(html).toContain("Command network access");
    expect(html).toContain(">off</button>");
  });

  test("role overrides include inherit and Builder cannot select read-only", () => {
    const html = renderCodexSectionHtml();
    const builderStart = html.indexOf("Builder");
    const qaStart = html.indexOf("QA", builderStart);
    const builderHtml = html.slice(builderStart, qaStart);

    expect(html).toContain("inherit default");
    expect(builderHtml).not.toContain("read-only");
    expect(builderHtml).toContain("workspace-write");
    expect(builderHtml).toContain("danger-full-access");
  });

  test("read-only Codex role overrides do not present dangerous choices", () => {
    const html = renderCodexSectionHtml();
    const specStart = html.indexOf("Spec");
    const plannerStart = html.indexOf("Planner", specStart);
    const specHtml = html.slice(specStart, plannerStart);

    expect(specHtml).not.toContain("danger-full-access");
    expect(specHtml).not.toContain("never");
    expect(specHtml).toContain("read-only");
    expect(specHtml).toContain("workspace-write");
  });

  test("default read-only shows Builder effective workspace-write reason", () => {
    const html = renderCodexSectionHtml({
      ...DEFAULT_AGENT_RUNTIMES,
      codex: {
        ...DEFAULT_AGENT_RUNTIMES.codex,
        defaults: { ...DEFAULT_AGENT_RUNTIMES.codex.defaults, sandboxMode: "read-only" },
      },
    });

    expect(html).toContain("Effective: sandbox workspace-write");
    expect(html).toContain(
      "Build role requires workspace-write when sandboxMode is inherited from read-only.",
    );
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

    expect(html).toContain("Reviewer is saved but has no effect while approval prompts are never.");
    expect(html).toContain("commands spawned by Codex while using workspace-write");
    expect(html).toContain("danger-full-access removes sandbox boundaries");
    expect(html).toContain("never disables approval prompts");
    expect(html).toContain("user routes approval prompts to the user");
    expect(html).toContain("auto_review routes eligible prompts through Codex automatic review");
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
