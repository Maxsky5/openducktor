import { describe, expect, test } from "bun:test";
import {
  type AgentRuntimes,
  CODEX_RUNTIME_DESCRIPTOR,
  DEFAULT_AGENT_RUNTIMES,
  OPENCODE_RUNTIME_DESCRIPTOR,
} from "@openducktor/contracts";
import { fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";
import { AgentRuntimesSection } from "./settings-agent-runtimes-section";

enableReactActEnvironment();

const renderSection = (agentRuntimes: AgentRuntimes = DEFAULT_AGENT_RUNTIMES): string =>
  renderToStaticMarkup(
    createElement(AgentRuntimesSection, {
      agentRuntimes,
      runtimeDefinitions: [CODEX_RUNTIME_DESCRIPTOR, OPENCODE_RUNTIME_DESCRIPTOR],
      disabled: false,
      isCodexDangerAcknowledged: false,
      onCodexDangerAcknowledgedChange: () => {},
      onUpdateAgentRuntimes: () => {},
    }),
  );

describe("AgentRuntimesSection", () => {
  test("shows OpenCode and Codex tabs with OpenCode first", () => {
    const html = renderSection();

    expect(html.indexOf("OpenCode")).toBeLessThan(html.indexOf("Codex"));
    expect(html).toContain("Local OpenCode runtime connected through the OpenDucktor MCP bridge.");
    const openCodePanel = html.slice(html.indexOf("OpenCode"), html.indexOf("Codex defaults"));
    expect(openCodePanel).not.toContain("Sandbox mode");
  });

  test("renders Codex defaults from contract values", () => {
    const html = renderSection();

    expect(html).toContain("Codex defaults");
    expect(html).toContain("workspace-write");
    expect(html).toContain("on-request");
    expect(html).toContain("user");
    expect(html).toContain("Command network access");
    expect(html).toContain(">off</button>");
  });

  test("role overrides include inherit and Builder cannot select read-only", () => {
    const html = renderSection();
    const builderStart = html.indexOf("Builder");
    const qaStart = html.indexOf("QA", builderStart);
    const builderHtml = html.slice(builderStart, qaStart);

    expect(html).toContain("inherit default");
    expect(builderHtml).not.toContain("read-only");
    expect(builderHtml).toContain("workspace-write");
    expect(builderHtml).toContain("danger-full-access");
  });

  test("read-only Codex role overrides do not present dangerous choices", () => {
    const html = renderSection();
    const specStart = html.indexOf("Spec");
    const plannerStart = html.indexOf("Planner", specStart);
    const specHtml = html.slice(specStart, plannerStart);

    expect(specHtml).not.toContain("danger-full-access");
    expect(specHtml).not.toContain("never");
    expect(specHtml).toContain("read-only");
    expect(specHtml).toContain("workspace-write");
  });

  test("default read-only shows Builder effective workspace-write reason", () => {
    const html = renderSection({
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
    const html = renderSection();

    expect(html).not.toContain("on-failure");
    expect(html).not.toContain("guardian_subagent");
  });

  test("renders reviewer, network, and risky acknowledgement copy", () => {
    const html = renderSection({
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
    const html = renderSection();

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

      expect(screen.getByRole("tab", { name: "OpenCode" }).getAttribute("data-state")).toBe(
        "active",
      );
    } finally {
      renderer.unmount();
    }
  });
});
