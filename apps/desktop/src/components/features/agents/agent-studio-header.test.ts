import { describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TEST_ROLE_OPTIONS } from "./agent-chat/agent-chat-test-fixtures";
import { AgentStudioHeader } from "./agent-studio-header";

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

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
  onOpenTaskDetails: () => {},
  sessionStatus: "running" as const,
  selectedRole: "spec" as const,
  workflowSteps: [
    {
      role: "spec" as const,
      label: "Spec",
      icon: roleIcon(0),
      state: {
        tone: "in_progress" as const,
        availability: "available" as const,
        completion: "in_progress" as const,
        liveSession: "running" as const,
      },
      sessionId: "spec-session",
    },
    {
      role: "planner" as const,
      label: "Planner",
      icon: roleIcon(1),
      state: {
        tone: "done" as const,
        availability: "available" as const,
        completion: "done" as const,
        liveSession: "idle" as const,
      },
      sessionId: "planner-session",
    },
    {
      role: "build" as const,
      label: "Builder",
      icon: roleIcon(2),
      state: {
        tone: "available" as const,
        availability: "available" as const,
        completion: "not_started" as const,
        liveSession: "none" as const,
      },
      sessionId: null,
    },
    {
      role: "qa" as const,
      label: "QA",
      icon: roleIcon(3),
      state: {
        tone: "optional" as const,
        availability: "optional" as const,
        completion: "not_started" as const,
        liveSession: "none" as const,
      },
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
      label: "Builder · Implementation Start",
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
    expect(html).toContain('aria-label="Open task details"');
    expect(html).toMatch(/aria-label="Session history[^"]*"/);
    expect(html).toContain(">Open<");
    expect(html).toContain("Create session");
    expect(html).not.toMatch(/flex-wrap/);
    expect(html).toContain("mt-1 flex items-center gap-1.5");
    const taskIdIndex = html.indexOf("fairnest-97f");
    const openButtonIndex = html.indexOf('aria-label="Open task details"');
    expect(taskIdIndex).toBeGreaterThan(-1);
    expect(openButtonIndex).toBeGreaterThan(taskIdIndex);
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

  test("adds full task title as hover affordance on truncated heading", () => {
    const html = renderToStaticMarkup(
      createElement(AgentStudioHeader, {
        model: buildModel(),
      }),
    );

    expect(html).toContain('title="Rework Agent Studio UI"');
  });

  test("shows selected session label in history trigger title", () => {
    const html = renderToStaticMarkup(
      createElement(AgentStudioHeader, {
        model: buildModel(),
      }),
    );

    expect(html).toContain('title="Session history · Spec Revision · Spec"');
  });

  test("opens session history menu with grouped options and selects session", () => {
    const onValueChange = mock(() => {});
    const { unmount } = render(
      createElement(AgentStudioHeader, {
        model: {
          ...buildModel(),
          sessionSelector: {
            value: "spec-session",
            groups: [
              {
                label: "Spec sessions",
                options: [
                  {
                    value: "spec-session",
                    label: "Spec Revision · Spec",
                    description: "Today · idle",
                  },
                ],
              },
              {
                label: "Build sessions",
                options: [
                  {
                    value: "build-session",
                    label: "Builder Draft · Build",
                    description: "Today · running",
                  },
                ],
              },
            ],
            disabled: false,
            onValueChange,
          },
        },
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: /Session history/i }));

    expect(screen.getByPlaceholderText(/Search sessions/i)).toBeTruthy();
    expect(screen.getByText("Spec sessions")).toBeTruthy();
    expect(screen.getByText("Build sessions")).toBeTruthy();

    fireEvent.click(screen.getByText("Builder Draft · Build"));

    expect(onValueChange).toHaveBeenCalledWith("build-session");

    unmount();
  });

  test("hides the task details button when no task is selected", () => {
    const html = renderToStaticMarkup(
      createElement(AgentStudioHeader, {
        model: {
          ...buildModel(),
          taskId: null,
          onOpenTaskDetails: null,
        },
      }),
    );

    expect(html).not.toContain('aria-label="Open task details"');
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

    expect(html).toMatch(
      /<button[^>]*(aria-label="Session history[^"]*"[^>]*disabled=""|disabled=""[^>]*aria-label="Session history[^"]*")/,
    );
    expect(html).toMatch(
      /<button[^>]*(aria-label="Create session"[^>]*disabled=""|disabled=""[^>]*aria-label="Create session")/,
    );
  });

  test("disables session history trigger when selector is disabled", () => {
    const model = buildModel();
    const html = renderToStaticMarkup(
      createElement(AgentStudioHeader, {
        model: {
          ...model,
          sessionSelector: {
            ...model.sessionSelector,
            disabled: true,
          },
        },
      }),
    );

    expect(html).toMatch(
      /<button[^>]*(aria-label="Session history[^"]*"[^>]*disabled=""|disabled=""[^>]*aria-label="Session history[^"]*")/,
    );
  });

  test("disables create session while a session is starting without showing a loader", () => {
    const html = renderToStaticMarkup(
      createElement(AgentStudioHeader, {
        model: {
          ...buildModel(),
          isCreatingSession: true,
        },
      }),
    );

    expect(html).toContain('aria-label="Create session"');
    expect(html).toContain('disabled="" title="Create session"');
    expect(html).toContain('class="lucide lucide-plus size-4"');
    expect(html).not.toContain(
      'title="Create session"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-loader-circle size-4 animate-spin"',
    );
  });

  test("keeps unavailable workflow step clickable without existing session", () => {
    const html = renderToStaticMarkup(
      createElement(AgentStudioHeader, {
        model: {
          ...buildModel(),
          selectedRole: "qa",
          workflowSteps: [
            {
              role: "spec" as const,
              label: "Spec",
              icon: roleIcon(0),
              state: {
                tone: "in_progress" as const,
                availability: "available" as const,
                completion: "in_progress" as const,
                liveSession: "running" as const,
              },
              sessionId: "spec-session",
            },
            {
              role: "planner" as const,
              label: "Planner",
              icon: roleIcon(1),
              state: {
                tone: "blocked" as const,
                availability: "blocked" as const,
                completion: "not_started" as const,
                liveSession: "none" as const,
              },
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
              state: {
                tone: "done" as const,
                availability: "available" as const,
                completion: "done" as const,
                liveSession: "idle" as const,
              },
              sessionId: "planner-session",
            },
          ],
        },
      }),
    );

    expect(html).toContain("ring-2 ring-offset-2 ring-offset-card ring-success-ring");
    expect(html).toContain("border-success-border");
    expect(html).toContain("bg-success-surface");
    expect(html).toContain("text-success-muted");
  });

  test("renders waiting-input workflow step hint and warning styling", () => {
    const html = renderToStaticMarkup(
      createElement(AgentStudioHeader, {
        model: {
          ...buildModel(),
          selectedRole: "qa",
          workflowSteps: [
            {
              role: "qa" as const,
              label: "QA",
              icon: roleIcon(3),
              state: {
                tone: "waiting_input" as const,
                availability: "optional" as const,
                completion: "in_progress" as const,
                liveSession: "waiting_input" as const,
              },
              sessionId: "qa-session",
            },
          ],
        },
      }),
    );

    expect(html).toContain('title="Session is waiting for input"');
    expect(html).toContain("border-warning-border");
  });

  test("renders optional workflow step as neutral dashed styling", () => {
    const html = renderToStaticMarkup(
      createElement(AgentStudioHeader, {
        model: {
          ...buildModel(),
          selectedRole: "qa",
          workflowSteps: [
            {
              role: "qa" as const,
              label: "QA",
              icon: roleIcon(3),
              state: {
                tone: "optional" as const,
                availability: "optional" as const,
                completion: "not_started" as const,
                liveSession: "none" as const,
              },
              sessionId: null,
            },
          ],
        },
      }),
    );

    expect(html).toContain("border-dashed");
    expect(html).toContain("border-input");
    expect(html).toContain("text-foreground");
    expect(html).not.toContain("border-warning-border");
    expect(html).not.toContain("text-warning-muted");
  });

  test("does not keep the dashed border once an optional step becomes active", () => {
    const html = renderToStaticMarkup(
      createElement(AgentStudioHeader, {
        model: {
          ...buildModel(),
          workflowSteps: [
            {
              role: "qa" as const,
              label: "QA",
              icon: roleIcon(3),
              state: {
                tone: "in_progress" as const,
                availability: "optional" as const,
                completion: "in_progress" as const,
                liveSession: "running" as const,
              },
              sessionId: "qa-session",
            },
          ],
        },
      }),
    );

    expect(html).not.toContain("border-dashed");
  });

  test("renders failed workflow step hint and destructive styling", () => {
    const html = renderToStaticMarkup(
      createElement(AgentStudioHeader, {
        model: {
          ...buildModel(),
          workflowSteps: [
            {
              role: "planner" as const,
              label: "Planner",
              icon: roleIcon(1),
              state: {
                tone: "failed" as const,
                availability: "available" as const,
                completion: "in_progress" as const,
                liveSession: "error" as const,
              },
              sessionId: "planner-session",
            },
          ],
        },
      }),
    );

    expect(html).toContain('title="Latest session failed"');
    expect(html).toContain("border-destructive-border");
  });

  test("renders failed workflow step without session as actionable startup failure", () => {
    const html = renderToStaticMarkup(
      createElement(AgentStudioHeader, {
        model: {
          ...buildModel(),
          workflowSteps: [
            {
              role: "planner" as const,
              label: "Planner",
              icon: roleIcon(1),
              state: {
                tone: "failed" as const,
                availability: "blocked" as const,
                completion: "not_started" as const,
                liveSession: "none" as const,
              },
              sessionId: null,
            },
          ],
        },
      }),
    );

    expect(html).toContain('title="Step failed before a session could start"');
    expect(html).not.toContain('title="Blocked by workflow state"');
  });

  test("uses neutral rejection copy for rejected review steps", () => {
    const html = renderToStaticMarkup(
      createElement(AgentStudioHeader, {
        model: {
          ...buildModel(),
          workflowSteps: [
            {
              role: "qa" as const,
              label: "QA",
              icon: roleIcon(3),
              state: {
                tone: "rejected" as const,
                availability: "available" as const,
                completion: "rejected" as const,
                liveSession: "idle" as const,
              },
              sessionId: "qa-session",
            },
          ],
        },
      }),
    );

    expect(html).toContain('title="Latest review rejected this task"');
    expect(html).not.toContain("Latest QA review rejected this task");
    expect(html).toContain("border-rejected-border");
    expect(html).toContain("bg-rejected-surface");
    expect(html).toContain("text-rejected-muted");
  });

  test("throws for invalid workflow tones instead of masking them as blocked", () => {
    expect(() =>
      renderToStaticMarkup(
        createElement(AgentStudioHeader, {
          model: {
            ...buildModel(),
            workflowSteps: [
              {
                role: "qa" as const,
                label: "QA",
                icon: roleIcon(3),
                state: {
                  tone: "broken" as never,
                  availability: "available" as const,
                  completion: "not_started" as const,
                  liveSession: "none" as const,
                },
                sessionId: null,
              },
            ],
          },
        }),
      ),
    ).toThrow("Unknown workflow tone");
  });
});
