import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TEST_ROLE_OPTIONS } from "./agent-chat/agent-chat-test-fixtures";
import { AgentStudioHeader } from "./agent-studio-header";

const buildModel = () => ({
  taskTitle: "Rework Agent Studio UI",
  sessionStatus: "running" as const,
  roleOptions: TEST_ROLE_OPTIONS,
  role: "spec" as const,
  roleDisabled: false,
  onRoleChange: () => {},
  scenario: "spec_initial" as const,
  scenarioOptions: [{ value: "spec_initial", label: "Initial Spec" }],
  scenarioDisabled: false,
  onScenarioChange: () => {},
  canKickoffNewSession: true,
  kickoffLabel: "Start Spec",
  onKickoff: () => {},
  isStarting: false,
  isSending: false,
  stats: {
    sessions: 3,
    messages: 12,
    permissions: 1,
    questions: 2,
  },
  agentStudioReady: true,
});

describe("AgentStudioHeader", () => {
  test("renders core controls and chat stats", () => {
    const html = renderToStaticMarkup(
      createElement(AgentStudioHeader, {
        model: buildModel(),
      }),
    );

    expect(html).toContain("Rework Agent Studio UI");
    expect(html).toContain("Start Spec");
    expect(html).toContain("Sessions:");
    expect(html).toContain("Messages:");
    expect(html).toContain("Permissions:");
    expect(html).toContain("Questions:");
  });

  test("hides optional actions when not applicable", () => {
    const html = renderToStaticMarkup(
      createElement(AgentStudioHeader, {
        model: {
          ...buildModel(),
          sessionStatus: "idle",
          canKickoffNewSession: false,
        },
      }),
    );

    expect(html).toContain("idle");
    expect(html).not.toContain("Start Spec");
  });

  test("falls back to generic header title when task title is missing", () => {
    const html = renderToStaticMarkup(
      createElement(AgentStudioHeader, {
        model: {
          ...buildModel(),
          taskTitle: null,
        },
      }),
    );

    expect(html).toContain("Agent Studio");
  });

  test("shows role lock helper when role changes are disabled", () => {
    const html = renderToStaticMarkup(
      createElement(AgentStudioHeader, {
        model: {
          ...buildModel(),
          roleDisabled: true,
        },
      }),
    );

    expect(html).toContain("Role is locked while the task already has an active session.");
  });

  test("disables controls when studio is blocked", () => {
    const html = renderToStaticMarkup(
      createElement(AgentStudioHeader, {
        model: {
          ...buildModel(),
          agentStudioReady: false,
        },
      }),
    );

    expect(html).toContain("disabled");
  });
});
