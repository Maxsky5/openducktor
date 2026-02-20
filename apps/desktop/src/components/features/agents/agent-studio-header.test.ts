import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TEST_ROLE_OPTIONS, buildTask } from "./agent-chat/agent-chat-test-fixtures";
import { AgentStudioHeader } from "./agent-studio-header";

const buildModel = () => ({
  sessionStatus: "running" as const,
  taskId: "task-1",
  tasks: [buildTask()],
  onTaskChange: () => {},
  selectedTaskTitle: "Add social login",
  roleOptions: TEST_ROLE_OPTIONS,
  role: "spec" as const,
  onRoleChange: () => {},
  sessionOptions: [
    {
      value: "session-1",
      label: "Initial Spec · Feb 20, 10:00 AM",
      description: "Initial Spec · running",
    },
  ],
  selectedSessionValue: "session-1",
  onSessionChange: () => {},
  scenario: "spec_initial" as const,
  scenarioOptions: [{ value: "spec_initial", label: "Initial Spec" }],
  scenarioDisabled: false,
  onScenarioChange: () => {},
  canKickoffNewSession: true,
  kickoffLabel: "Start Spec",
  onKickoff: () => {},
  isStarting: false,
  isSending: false,
  showFollowLatest: true,
  onFollowLatest: () => {},
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

    expect(html).toContain("Agent Studio");
    expect(html).toContain("Start Spec");
    expect(html).toContain("Sessions:");
    expect(html).toContain("Messages:");
    expect(html).toContain("Permissions:");
    expect(html).toContain("Questions:");
    expect(html).toContain("Follow Latest");
  });

  test("hides optional actions when not applicable", () => {
    const html = renderToStaticMarkup(
      createElement(AgentStudioHeader, {
        model: {
          ...buildModel(),
          sessionStatus: "idle",
          canKickoffNewSession: false,
          showFollowLatest: false,
        },
      }),
    );

    expect(html).toContain("idle");
    expect(html).not.toContain("Start Spec");
    expect(html).not.toContain("Follow Latest");
  });

  test("disables task and role controls when studio is blocked", () => {
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
