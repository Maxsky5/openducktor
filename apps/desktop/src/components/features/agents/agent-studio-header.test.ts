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
  selectedRole: "spec" as const,
  workflowSteps: [
    {
      role: "spec" as const,
      label: "Spec",
      icon: roleIcon(0),
      state: "in_progress" as const,
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
      state: "optional" as const,
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
  test("renders workflow rail with compact top-row session controls", () => {
    const html = renderToStaticMarkup(
      createElement(AgentStudioHeader, {
        model: buildModel(),
      }),
    );

    expect(html).toContain("Rework Agent Studio UI");
    expect(html).toContain("fairnest-97f");
    expect(html).toContain("Create session");
    expect(html).not.toContain("Viewing Session");
    expect(html).not.toContain("Sessions:");
    expect(html).not.toContain("Messages:");
    expect(html).not.toContain("Permissions:");
    expect(html).not.toContain("Questions:");
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

  test("keeps unavailable workflow step clickable without existing session", () => {
    const html = renderToStaticMarkup(
      createElement(AgentStudioHeader, {
        model: {
          ...buildModel(),
          workflowSteps: [
            {
              role: "spec" as const,
              label: "Spec",
              icon: roleIcon(0),
              state: "in_progress" as const,
              sessionId: "spec-session",
            },
            {
              role: "planner" as const,
              label: "Planner",
              icon: roleIcon(1),
              state: "blocked" as const,
              sessionId: null,
            },
          ],
        },
      }),
    );

    expect(html).toContain('title="Blocked by workflow state"');
    expect(html).not.toContain('title="Blocked by workflow state" disabled');
  });

  test("highlights selected role with a ring without changing done status color", () => {
    const html = renderToStaticMarkup(
      createElement(AgentStudioHeader, {
        model: {
          ...buildModel(),
          selectedRole: "planner",
          workflowSteps: [
            {
              role: "planner" as const,
              label: "Planner",
              icon: roleIcon(1),
              state: "done" as const,
              sessionId: "planner-session",
            },
          ],
        },
      }),
    );

    expect(html).toContain("ring-2 ring-offset-2 ring-emerald-400");
    expect(html).toContain("border-emerald-300");
    expect(html).toContain("bg-emerald-50");
    expect(html).toContain("text-emerald-700");
  });
});
