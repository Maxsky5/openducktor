import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TEST_ROLE_OPTIONS } from "./agent-chat/agent-chat-test-fixtures";
import { AgentStudioHeader } from "./agent-studio-header";

const roleIcon = (index: number) => {
  const option = TEST_ROLE_OPTIONS[index];
  if (!option) {
    throw new Error(`Missing test role option at index ${index}`);
  }
  return option.icon;
};

const buildModel = () => ({
  taskTitle: "Rework Agent Studio UI",
  taskId: "fairnest-97f",
  sessionStatus: "running" as const,
  workflowSteps: [
    {
      role: "spec" as const,
      label: "Spec",
      icon: roleIcon(0),
      state: "current" as const,
      sessionId: "spec-session",
    },
    {
      role: "planner" as const,
      label: "Planner",
      icon: roleIcon(1),
      state: "done" as const,
      sessionId: "planner-session",
    },
    {
      role: "build" as const,
      label: "Build",
      icon: roleIcon(2),
      state: "available" as const,
      sessionId: null,
    },
    {
      role: "qa" as const,
      label: "QA",
      icon: roleIcon(3),
      state: "blocked" as const,
      sessionId: null,
    },
  ],
  onWorkflowStepSelect: () => {},
  sessionSelector: {
    value: "spec-session",
    groups: [
      {
        label: "Spec",
        options: [
          {
            value: "spec-session",
            label: "Spec Revision · Spec",
            description: "Today · idle",
          },
        ],
      },
    ],
    disabled: false,
    onValueChange: () => {},
  },
  sessionCreateOptions: [
    {
      id: "build:build_implementation_start",
      role: "build" as const,
      scenario: "build_implementation_start" as const,
      label: "Build · Implementation Start",
      description: "Create build session",
      disabled: false,
    },
  ],
  onCreateSession: () => {},
  createSessionDisabled: false,
  isCreatingSession: false,
  stats: {
    sessions: 3,
    messages: 12,
    permissions: 1,
    questions: 2,
  },
  agentStudioReady: true,
});

describe("AgentStudioHeader", () => {
  test("renders workflow rail, session picker, create button, and stats", () => {
    const html = renderToStaticMarkup(
      createElement(AgentStudioHeader, {
        model: buildModel(),
      }),
    );

    expect(html).toContain("Rework Agent Studio UI");
    expect(html).toContain("fairnest-97f");
    expect(html).toContain("Viewing Session");
    expect(html).toContain("Create session");
    expect(html).toContain("Sessions:");
    expect(html).toContain("Messages:");
    expect(html).toContain("Permissions:");
    expect(html).toContain("Questions:");
    expect(html).not.toContain("Chat-first workspace for this task session.");
    expect(html).not.toContain("AGENT STUDIO");
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

  test("shows creation lock helper when session creation is disabled", () => {
    const html = renderToStaticMarkup(
      createElement(AgentStudioHeader, {
        model: {
          ...buildModel(),
          createSessionDisabled: true,
        },
      }),
    );

    expect(html).toContain(
      "Session creation is locked while the current session is actively running.",
    );
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
