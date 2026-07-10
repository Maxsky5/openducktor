import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act, createElement, createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { createSessionMessagesState } from "@/state/operations/agent-orchestrator/support/messages";
import {
  createAnimationFrameTestDriver,
  withAnimationFrameTestDriver,
} from "@/test-utils/animation-frame-test-driver";
import { createChatSettingsFixture } from "@/test-utils/shared-test-fixtures";
import { AGENT_CHAT_ROW_WINDOW_SIZE } from "./agent-chat-row-windows";
import { AgentChatSettingsProvider } from "./agent-chat-settings-context";
import {
  type AgentChatThreadModelInput,
  buildApprovalRequest,
  buildBaseModel,
  buildMessage,
  buildQuestionRequest,
  buildSession,
  buildThreadTranscriptState,
  buildTodoItem,
  completeThreadModel,
} from "./agent-chat-test-fixtures";
import { AgentChatThread as AgentChatThreadComponent } from "./agent-chat-thread";

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const DEFAULT_TEST_CHAT_SETTINGS = createChatSettingsFixture();

const AgentChatThread = ({ model }: { model: AgentChatThreadModelInput }) =>
  createElement(
    AgentChatSettingsProvider,
    { value: DEFAULT_TEST_CHAT_SETTINGS },
    createElement(AgentChatThreadComponent, {
      model: completeThreadModel(model),
    }),
  );

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

const getGlobalWindow = (): unknown => {
  return (globalThis as { window?: unknown }).window;
};

const setGlobalWindow = (value: unknown): void => {
  const target = globalThis as { window?: unknown };
  if (typeof value === "undefined") {
    delete target.window;
    return;
  }

  target.window = value;
};

const createContainer = () => {
  return {
    addEventListener: mock(() => {}),
    clientHeight: 320,
    removeEventListener: mock(() => {}),
    scrollHeight: 2_000,
    scrollTop: 1_680,
  } as unknown as HTMLDivElement;
};

type ScrollContainerMock = {
  addEventListener: ReturnType<typeof mock>;
  clientHeight: number;
  removeEventListener: ReturnType<typeof mock>;
  scrollHeight: number;
  scrollTop: number;
};

type MockResizeObserverController = {
  callback: ResizeObserverCallback;
  observer: ResizeObserver;
  observedElements: Set<Element>;
};

const mockResizeObserverControllers = new Set<MockResizeObserverController>();

class MockResizeObserver implements ResizeObserver {
  private readonly observedElements = new Set<Element>();

  constructor(callback: ResizeObserverCallback) {
    mockResizeObserverControllers.add({
      callback,
      observer: this,
      observedElements: this.observedElements,
    });
  }

  disconnect(): void {
    this.observedElements.clear();
  }

  observe(target: Element): void {
    this.observedElements.add(target);
  }

  unobserve(target: Element): void {
    this.observedElements.delete(target);
  }
}

const triggerResizeObservers = (heightByElement = new Map<Element, number>()): void => {
  for (const controller of mockResizeObserverControllers) {
    if (controller.observedElements.size === 0) {
      continue;
    }

    controller.callback(
      Array.from(controller.observedElements).map((target) => ({
        borderBoxSize: [] as ResizeObserverSize[],
        contentBoxSize: [] as ResizeObserverSize[],
        contentRect: {
          height: heightByElement.get(target) ?? 0,
        } as DOMRectReadOnly,
        devicePixelContentBoxSize: [] as ResizeObserverSize[],
        target,
      })),
      controller.observer,
    );
  }
};

const buildLongSession = (externalSessionId: string, count = 80) => {
  const messages = Array.from({ length: count }, (_, index) =>
    buildMessage("user", `Message ${index + 1}`, {
      id: `message-${index + 1}`,
    }),
  );

  return buildSession({
    externalSessionId,
    messages,
    status: "idle",
  });
};

describe("AgentChatThread", () => {
  const originalWindow = getGlobalWindow();
  const originalIntersectionObserver = globalThis.IntersectionObserver;
  const originalMatchMedia = globalThis.matchMedia;
  const originalResizeObserver = globalThis.ResizeObserver;
  const animationFrameDriver = createAnimationFrameTestDriver();

  beforeEach(() => {
    mockResizeObserverControllers.clear();
    globalThis.matchMedia = ((query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList) as typeof matchMedia;
    animationFrameDriver.installAutoFlush();
    globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
    globalThis.IntersectionObserver = class MockIntersectionObserver {
      disconnect(): void {}

      observe(): void {}

      takeRecords(): IntersectionObserverEntry[] {
        return [];
      }

      unobserve(): void {}
    } as unknown as typeof IntersectionObserver;
  });

  afterEach(() => {
    setGlobalWindow(originalWindow);
    globalThis.IntersectionObserver = originalIntersectionObserver;
    globalThis.matchMedia = originalMatchMedia;
    animationFrameDriver.restore();
    globalThis.ResizeObserver = originalResizeObserver;
  });

  test("renders empty state when no session is active", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatThread, {
        model: {
          ...buildBaseModel(),
          session: null,
          emptyState: {
            title: "Select a task to begin.",
            actionLabel: "Start Spec",
            onAction: () => {},
          },
        },
      }),
    );

    expect(html).toContain("Select a task to begin.");
    expect(html).toContain("Start Spec");
  });

  test("does not render a synthetic running indicator row", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatThread, {
        model: {
          ...buildBaseModel(),
          session: buildSession({
            status: "running",
          }),
        },
      }),
    );

    expect(html).not.toContain("Agent is thinking...");
  });

  test("keeps the transcript area blank when displayed session has no renderable rows yet", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatThread, {
        model: {
          ...buildBaseModel(),
          session: buildSession({
            status: "stopped",
            messages: [],
          }),
        },
      }),
    );

    expect(html).not.toContain("Loading session history...");
    expect(html).not.toContain("Loading session...");
  });

  test("renders blank transcript area when session has messages but all were filtered", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatThread, {
        model: {
          ...buildBaseModel(),
          session: buildSession({
            status: "stopped",
            messages: [
              buildMessage("thinking", "Reasoning trace 1", {
                id: "thinking-1",
              }),
              buildMessage("thinking", "Reasoning trace 2", {
                id: "thinking-2",
              }),
            ],
          }),
        },
      }),
    );

    expect(html).not.toContain("Loading session history...");
  });

  test("renders pending question and approval cards below blank transcript when filtered to zero", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatThread, {
        model: {
          ...buildBaseModel(),
          session: buildSession({
            status: "stopped",
            messages: [buildMessage("thinking", "Reasoning trace", { id: "thinking-1" })],
          }),
          pendingQuestionRequests: [buildQuestionRequest()],
          pendingApprovalRequests: [buildApprovalRequest()],
        },
      }),
    );

    expect(html).not.toContain("Loading session history...");
    expect(html).toContain("Input needed");
    expect(html).toContain("Approval required");
  });

  test("renders initializing state while autostart session is pending", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatThread, {
        model: {
          ...buildBaseModel(),
          session: null,
          isStarting: true,
          emptyState: {
            title: "Initializing session...",
            actionLabel: "Start Spec",
            onAction: () => {},
            isActionPending: true,
          },
        },
      }),
    );

    expect(html).toContain("Initializing session...");
    expect(html).not.toContain("Send a message to start a new session automatically.");
  });

  test("renders blocked warning with recheck action when studio is unavailable", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatThread, {
        model: {
          ...buildBaseModel(),
          transcriptState: buildThreadTranscriptState({
            kind: "runtime_waiting",
          }),
          runtimeReadiness: {
            ...buildBaseModel().runtimeReadiness,
            state: "blocked",
            message: "OpenCode runtime is unavailable",
          },
          isInteractionEnabled: false,
          session: null,
        },
      }),
    );

    expect(html).toContain("OpenCode runtime is unavailable");
    expect(html).toContain("Recheck");
    expect(html).not.toContain("Send a message to start a new session automatically.");
    expect(html).not.toContain("No conversation available.");
  });

  test("keeps renderable transcript visible when runtime readiness becomes blocked", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatThread, {
        model: {
          ...buildBaseModel(),
          runtimeReadiness: {
            ...buildBaseModel().runtimeReadiness,
            state: "blocked",
            message: "OpenCode runtime is unavailable",
          },
          isInteractionEnabled: false,
          session: buildSession({
            messages: [
              buildMessage("assistant", "Already loaded transcript", {
                id: "loaded-1",
              }),
            ],
          }),
        },
      }),
    );

    expect(html).toContain("Already loaded transcript");
    expect(html).not.toContain("OpenCode runtime is unavailable");
    expect(html).not.toContain("Recheck");
  });

  test("renders transcript rows without untracked vertical gap spacing", () => {
    render(
      createElement(AgentChatThread, {
        model: {
          ...buildBaseModel(),
          session: buildSession({
            messages: [buildMessage("assistant", "Measured transcript row", { id: "loaded-1" })],
          }),
        },
      }),
    );

    const row = screen.getByText("Measured transcript row").closest(".agent-chat-row-motion");
    if (!row?.parentElement) {
      throw new Error("Expected transcript row wrapper");
    }

    expect(row.parentElement.className).not.toContain("space-y-");
  });

  test("renders failed session loading state instead of a blank transcript", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatThread, {
        model: {
          ...buildBaseModel(),
          transcriptState: buildThreadTranscriptState({ kind: "failed" }),
          isInteractionEnabled: false,
          session: null,
        },
      }),
    );

    expect(html).toContain("Failed to load session");
    expect(html).toContain("The selected conversation could not be loaded.");
    expect(html).not.toContain("Send a message to start a new session automatically.");
  });

  test("renders the runtime-starting overlay without unmounting transcript content", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatThread, {
        model: {
          ...buildBaseModel(),
          transcriptState: buildThreadTranscriptState({
            kind: "runtime_waiting",
          }),
          runtimeReadiness: {
            ...buildBaseModel().runtimeReadiness,
            state: "checking",
          },
          isInteractionEnabled: false,
          session: buildSession({
            messages: [
              buildMessage("assistant", "Cached transcript", {
                id: "assistant-1",
              }),
            ],
          }),
        },
      }),
    );

    expect(html).toContain("Runtime is starting");
    expect(html).toContain("Waiting for runtime and MCP health before loading this session.");
    expect(html).toContain("Cached transcript");
  });

  test("renders the runtime-starting overlay while waiting for a worktree runtime after page readiness succeeds", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatThread, {
        model: {
          ...buildBaseModel(),
          transcriptState: buildThreadTranscriptState({
            kind: "runtime_waiting",
          }),
          session: buildSession({
            messages: [
              buildMessage("assistant", "Cached transcript", {
                id: "assistant-1",
              }),
            ],
          }),
        },
      }),
    );

    expect(html).toContain("Runtime is starting");
    expect(html).toContain("Waiting for runtime and MCP health before loading this session.");
    expect(html).toContain("Cached transcript");
  });

  test("does not show the runtime-starting overlay for generic readiness checks without a waiting session", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatThread, {
        model: {
          ...buildBaseModel(),
          runtimeReadiness: {
            ...buildBaseModel().runtimeReadiness,
            state: "checking",
          },
          isInteractionEnabled: false,
          session: buildSession({
            messages: [
              buildMessage("assistant", "Cached transcript", {
                id: "assistant-1",
              }),
            ],
          }),
        },
      }),
    );

    expect(html).not.toContain("Runtime is starting");
    expect(html).toContain("Cached transcript");
  });

  test("renders transcript messages and question cards without synthetic draft rows", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatThread, {
        model: {
          ...buildBaseModel(),
          session: buildSession({
            messages: [
              buildMessage("assistant", "Done", {
                id: "assistant-1",
                meta: {
                  kind: "assistant",
                  agentRole: "spec",
                  profileId: "Hephaestus (Deep Agent)",
                  durationMs: 1_500,
                },
              }),
              buildMessage("assistant", "Streaming message", {
                id: "assistant-2",
              }),
            ],
          }),
          pendingQuestionRequests: [buildQuestionRequest()],
        },
      }),
    );

    expect(html).toContain("Worked for");
    expect(html).toContain("Streaming message");
    expect(html).toContain("Input needed");
  });

  test("keeps pending question cards visible after the session becomes idle", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatThread, {
        model: {
          ...buildBaseModel(),
          session: buildSession({
            status: "idle",
            messages: [
              buildMessage("assistant", "Need your input", {
                id: "assistant-idle-1",
              }),
            ],
          }),
          pendingQuestionRequests: [buildQuestionRequest()],
        },
      }),
    );

    expect(html).toContain("Need your input");
    expect(html).toContain("Input needed");
  });

  test("renders approval cards for pending approval requests", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatThread, {
        model: {
          ...buildBaseModel(),
          session: buildSession(),
          pendingApprovalRequests: [
            buildApprovalRequest({
              requestId: "perm-1",
              requestType: "permission_grant" as const,
              title: `Approve permission: ${"bash"}`,
              summary: `Approval request for ${"bash"}.`,
              affectedPaths: ["**/*.sh", "/tmp/*"],
              action: { name: "bash" },
              mutation: "read_only" as const,
              supportedReplyOutcomes: [
                "approve_once" as const,
                "approve_session" as const,
                "reject" as const,
              ],
            }),
          ],
        },
      }),
    );

    expect(html).toContain("Approval required");
    expect(html).toContain("bash");
    expect(html).toContain("Affected paths:");
    expect(html).toContain("**/*.sh");
    expect(html).toContain("/tmp/*");
    expect(html).toContain("Approve once");
    expect(html).toContain("Approve for session");
    expect(html).toContain("Reject");
  });

  test("keeps pending question and approval cards mounted for long sessions", () => {
    const longMessages = Array.from({ length: 80 }, (_, index) =>
      buildMessage("assistant", `Message ${index + 1}`, {
        id: `message-${index + 1}`,
      }),
    );

    const html = renderToStaticMarkup(
      createElement(AgentChatThread, {
        model: {
          ...buildBaseModel(),
          session: buildSession({
            messages: longMessages,
          }),
          pendingQuestionRequests: [buildQuestionRequest()],
          pendingApprovalRequests: [buildApprovalRequest()],
        },
      }),
    );

    expect(html).toContain("Message 80");
    expect(html).toContain("Input needed");
    expect(html).toContain("Approval required");
    expect(html).toContain("hide-scrollbar");
  });

  test("keeps pending cards and todo in a bottom stack outside the scroll region", async () => {
    const rendered = render(
      createElement(AgentChatThread, {
        model: {
          ...buildBaseModel(),
          session: buildSession(),
          pendingQuestionRequests: [buildQuestionRequest()],
          pendingApprovalRequests: [buildApprovalRequest()],
          todos: [
            buildTodoItem({
              id: "todo-1",
              content: "Analyze current styling",
              status: "completed",
            }),
            buildTodoItem({
              id: "todo-2",
              content: "Read layout and pages",
              status: "in_progress",
            }),
          ],
        },
      }),
    );
    await act(flush);

    const scrollRegion = rendered.container.querySelector(".agent-chat-scroll-region");
    const bottomStack = rendered.container.querySelector(".agent-chat-bottom-stack");

    expect(scrollRegion?.textContent).not.toContain("Input needed");
    expect(scrollRegion?.textContent).not.toContain("Approval required");
    expect(scrollRegion?.textContent).not.toContain("Read layout and pages");
    expect(bottomStack?.textContent).toContain("Input needed");
    expect(bottomStack?.textContent).toContain("Approval required");
    expect(bottomStack?.textContent).toContain("Todo");
    expect(bottomStack?.textContent).toContain("Analyze current styling");
    expect(bottomStack?.textContent).toContain("Read layout and pages");
    expect((bottomStack as HTMLDivElement).innerHTML.indexOf("Input needed")).toBeLessThan(
      (bottomStack as HTMLDivElement).innerHTML.indexOf("Approval required"),
    );
    expect((bottomStack as HTMLDivElement).innerHTML.indexOf("Approval required")).toBeLessThan(
      (bottomStack as HTMLDivElement).innerHTML.indexOf("Todo"),
    );
    const questionLayer = screen.getByText("Input needed").closest("section")?.parentElement;
    expect(questionLayer?.className).toContain("relative z-30");

    rendered.unmount();
  });

  test("uses the Codex runtime accent for no-profile session todos", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatThread, {
        model: {
          ...buildBaseModel(),
          session: buildSession({
            runtimeKind: "codex",
            status: "idle",
          }),
          todos: [
            buildTodoItem({
              id: "todo-1",
              content: "Keep Codex todo accented",
              status: "in_progress",
            }),
          ],
          sessionAccentColor: "var(--odt-runtime-accent-codex)",
        },
      }),
    );

    expect(html).toContain("Keep Codex todo accented");
    expect(html).toContain("border-left-color:var(--odt-runtime-accent-codex)");
  });

  test("uses the Claude runtime accent for no-profile session todos", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatThread, {
        model: {
          ...buildBaseModel(),
          session: buildSession({
            runtimeKind: "claude",
            status: "idle",
          }),
          todos: [
            buildTodoItem({
              id: "todo-1",
              content: "Keep Claude todo accented",
              status: "in_progress",
            }),
          ],
          sessionAccentColor: "var(--odt-runtime-accent-claude)",
        },
      }),
    );

    expect(html).toContain("Keep Claude todo accented");
    expect(html).toContain("border-left-color:var(--odt-runtime-accent-claude)");
  });

  test("keeps explicit profile color ahead of runtime defaults for todos", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatThread, {
        model: {
          ...buildBaseModel(),
          session: buildSession({
            runtimeKind: "opencode",
            status: "idle",
          }),
          todos: [
            buildTodoItem({
              id: "todo-1",
              content: "Keep explicit todo accented",
              status: "in_progress",
            }),
          ],
          sessionAccentColor: "#123456",
        },
      }),
    );

    expect(html).toContain("Keep explicit todo accented");
    expect(html).toContain("border-left-color:#123456");
  });

  test("shows the loader before rendering an attachment transcript after session switch", async () => {
    await withAnimationFrameTestDriver(async (animationFrameDriver) => {
      const attachmentMessages = Array.from({ length: 140 }, (_, index) =>
        buildMessage(
          "user",
          `Attachment message ${index + 1}`,
          index === 0
            ? {
                id: `attachment-message-${index + 1}`,
                meta: {
                  kind: "user",
                  state: "read",
                  parts: [
                    {
                      kind: "attachment",
                      attachment: {
                        id: "attachment-1",
                        name: "spec.md",
                        kind: "pdf",
                        path: "/tmp/spec.md",
                      },
                    },
                  ],
                },
              }
            : {
                id: `attachment-message-${index + 1}`,
              },
        ),
      );

      const rendered = render(
        createElement(AgentChatThread, {
          model: {
            ...buildBaseModel(),
            session: buildSession({
              externalSessionId: "session-normal",
              messages: [
                buildMessage("assistant", "Baseline transcript", {
                  id: "assistant-1",
                }),
              ],
            }),
          },
        }),
      );

      rendered.rerender(
        createElement(AgentChatThread, {
          model: {
            ...buildBaseModel(),
            session: buildSession({
              externalSessionId: "session-attachments",
              messages: attachmentMessages,
            }),
          },
        }),
      );

      expect(rendered.queryByText("Loading session")).not.toBeNull();
      expect(rendered.queryByText("Attachment message 140")).toBeNull();

      await waitFor(async () => {
        await animationFrameDriver.flushFrames();
        await animationFrameDriver.flushTimers();
        expect(rendered.queryByText("Attachment message 140")).not.toBeNull();
      });
      expect(
        rendered.queryByText(`Attachment message ${140 - AGENT_CHAT_ROW_WINDOW_SIZE + 1}`),
      ).not.toBeNull();
      expect(rendered.queryByText("Attachment message 1")).toBeNull();
      expect(rendered.container.querySelector('[style*="content-visibility"]')).toBeNull();

      rendered.unmount();
    });
  });

  test("shows the loader before rendering cached large transcripts after switching back", async () => {
    await withAnimationFrameTestDriver(async (animationFrameDriver) => {
      const largeMessages = Array.from({ length: 18 }, (_, turnIndex) => [
        buildMessage("user", `Turn ${turnIndex + 1} request`, {
          id: `turn-${turnIndex + 1}-user`,
        }),
        ...Array.from({ length: 18 }, (_, replyIndex) =>
          buildMessage("assistant", `Turn ${turnIndex + 1} reply ${replyIndex + 1}`, {
            id: `turn-${turnIndex + 1}-assistant-${replyIndex + 1}`,
          }),
        ),
      ]).flat();
      const largeSession = buildSession({
        externalSessionId: "session-cached-large",
        status: "idle",
        messages: createSessionMessagesState("session-cached-large", largeMessages, 1),
      });
      const smallSession = buildSession({
        externalSessionId: "session-small",
        messages: [
          buildMessage("assistant", "Small transcript", {
            id: "small-assistant-1",
          }),
        ],
      });
      const rendered = render(
        createElement(AgentChatThread, {
          model: {
            ...buildBaseModel(),
            session: largeSession,
          },
        }),
      );

      await waitFor(async () => {
        await animationFrameDriver.flushFrames();
        await animationFrameDriver.flushTimers();
        expect(rendered.queryByText("Turn 18 reply 18")).not.toBeNull();
      });

      rendered.rerender(
        createElement(AgentChatThread, {
          model: {
            ...buildBaseModel(),
            session: smallSession,
          },
        }),
      );
      await waitFor(async () => {
        await animationFrameDriver.flushFrames();
        await animationFrameDriver.flushTimers();
        expect(rendered.queryByText("Small transcript")).not.toBeNull();
      });

      rendered.rerender(
        createElement(AgentChatThread, {
          model: {
            ...buildBaseModel(),
            session: buildSession({
              ...largeSession,
              messages: createSessionMessagesState("session-cached-large", largeMessages, 1),
            }),
          },
        }),
      );

      expect(rendered.queryByText("Loading session")).not.toBeNull();
      expect(rendered.queryByText("Turn 18 reply 18")).toBeNull();

      await waitFor(async () => {
        await animationFrameDriver.flushFrames();
        await animationFrameDriver.flushTimers();
        expect(rendered.queryByText("Turn 18 reply 18")).not.toBeNull();
      });
      const immediateRowCount = rendered.container.querySelectorAll("[data-row-key]").length;
      expect(immediateRowCount).toBeGreaterThan(0);
      expect(immediateRowCount).toBeLessThan(largeMessages.length);
      expect(rendered.queryByText("Turn 1 request")).toBeNull();

      rendered.unmount();
    });
  });

  test("keeps stale same-session rows visible without a loading overlay", async () => {
    await withAnimationFrameTestDriver(async () => {
      const initialMessages = [
        buildMessage("assistant", "Baseline transcript", { id: "assistant-1" }),
      ];
      const session = buildSession({
        externalSessionId: "session-streaming",
        messages: initialMessages,
      });
      const rendered = render(
        createElement(AgentChatThread, {
          model: {
            ...buildBaseModel(),
            session,
          },
        }),
      );

      rendered.rerender(
        createElement(AgentChatThread, {
          model: {
            ...buildBaseModel(),
            session: {
              ...session,
              activityState: "running",
              messages: createSessionMessagesState("session-streaming", [
                ...initialMessages,
                buildMessage("assistant", "Streaming update", {
                  id: "assistant-2",
                }),
              ]),
            },
          },
        }),
      );

      expect(rendered.queryByText("Loading session")).toBeNull();
      expect(rendered.queryByText("Baseline transcript")).not.toBeNull();
      expect(rendered.queryByText("Streaming update")).not.toBeNull();

      rendered.unmount();
    });
  });

  test("does not apply content-visibility containment after a running session completes", async () => {
    const externalSessionId = "session-completed-scroll";
    const messages = Array.from({ length: 12 }, (_, index) => [
      buildMessage("user", `Command ${index + 1}`, {
        id: `user-${index + 1}`,
      }),
      buildMessage("assistant", `Result ${index + 1}`, {
        id: `assistant-${index + 1}`,
      }),
    ]).flat();
    const runningSession = buildSession({
      externalSessionId,
      messages,
      status: "running",
    });
    const sessionKey = agentSessionIdentityKey(runningSession);
    const model = {
      ...buildBaseModel(),
      isSessionWorking: true,
      session: runningSession,
    };
    const rendered = render(
      createElement(AgentChatThread, {
        model,
      }),
    );
    await act(flush);

    const getTurnStyle = (rowKey: string): string | null => {
      const row = rendered.container.querySelector(`[data-row-key="${rowKey}"]`);
      const turn = row?.parentElement;
      if (!(turn instanceof HTMLDivElement)) {
        return null;
      }

      return turn.getAttribute("style") ?? "";
    };

    const runningLatestTurnStyle = getTurnStyle(`${sessionKey}:22:user-12`);
    expect(runningLatestTurnStyle).not.toBeNull();
    expect(runningLatestTurnStyle).not.toContain("content-visibility");

    rendered.rerender(
      createElement(AgentChatThread, {
        model: {
          ...model,
          isSessionWorking: false,
          session: buildSession({
            externalSessionId,
            messages,
            status: "idle",
          }),
        },
      }),
    );
    await act(flush);
    await waitFor(() => {
      expect(
        rendered.container.querySelector(`[data-row-key="${sessionKey}:4:user-3"]`),
      ).not.toBeNull();
    });

    const completedOlderTurnStyle = getTurnStyle(`${sessionKey}:4:user-3`);
    const completedLatestTurnStyle = getTurnStyle(`${sessionKey}:22:user-12`);
    expect(completedOlderTurnStyle).not.toBeNull();
    expect(completedOlderTurnStyle).not.toContain("content-visibility");
    expect(completedLatestTurnStyle).not.toBeNull();
    expect(completedLatestTurnStyle).not.toContain("content-visibility");

    rendered.unmount();
  });

  test("adds bottom spacing before the composer when the last bottom-stack item is a question", async () => {
    const rendered = render(
      createElement(AgentChatThread, {
        model: {
          ...buildBaseModel(),
          session: buildSession(),
          pendingQuestionRequests: [buildQuestionRequest()],
        },
      }),
    );
    await act(flush);

    const bottomStack = rendered.container.querySelector(".agent-chat-bottom-stack");
    expect(bottomStack?.className).toContain("pb-3");

    rendered.unmount();
  });

  test("adds bottom spacing before the composer when the last bottom-stack item is an approval", async () => {
    const rendered = render(
      createElement(AgentChatThread, {
        model: {
          ...buildBaseModel(),
          session: buildSession(),
          pendingApprovalRequests: [buildApprovalRequest()],
        },
      }),
    );
    await act(flush);

    const bottomStack = rendered.container.querySelector(".agent-chat-bottom-stack");
    expect(bottomStack?.className).toContain("pb-3");

    rendered.unmount();
  });

  test("renders auxiliary errors even when the session has no questions, approvals, or todos", async () => {
    const rendered = render(
      createElement(AgentChatThread, {
        model: {
          ...buildBaseModel(),
          session: buildSession(),
          sessionAuxiliaryError: "todos unavailable",
        },
      }),
    );
    await act(flush);

    const bottomStack = rendered.container.querySelector(".agent-chat-bottom-stack");
    expect(bottomStack).not.toBeNull();
    expect(bottomStack?.textContent).toContain("todos unavailable");
    expect(bottomStack?.className).toContain("pb-3");
    const runtimeError = screen.getByText(/todos unavailable/);
    expect(runtimeError.className).toContain("border-destructive-border");
    expect(runtimeError.className).toContain("bg-destructive-surface");
    expect(runtimeError.className).toContain("text-destructive-surface-foreground");

    rendered.unmount();
  });

  test("keeps the todo panel flush with the composer when todo is the last bottom-stack item", async () => {
    const rendered = render(
      createElement(AgentChatThread, {
        model: {
          ...buildBaseModel(),
          session: buildSession(),
          pendingQuestionRequests: [buildQuestionRequest()],
          todos: [
            buildTodoItem({
              id: "todo-1",
              content: "Read layout and pages",
              status: "in_progress",
            }),
          ],
        },
      }),
    );
    await act(flush);

    const bottomStack = rendered.container.querySelector(".agent-chat-bottom-stack");
    expect(bottomStack?.className).toContain("pb-0");

    rendered.unmount();
  });

  test("refreshes rendered rows when the session gains new visible rows", async () => {
    const messages = Array.from({ length: 80 }, (_, index) =>
      buildMessage("user", `Message ${index + 1}`, {
        id: `message-${index + 1}`,
      }),
    );
    const session = buildSession({ messages });
    const model = {
      ...buildBaseModel(),
      messagesContainerRef: { current: createContainer() },
      session,
    };

    const rendered = render(
      createElement(AgentChatThread, {
        model,
      }),
    );
    await act(flush);

    expect(rendered.container.textContent).toContain("Message 80");

    const nextSession = buildSession({
      externalSessionId: session.externalSessionId,
      messages: Array.from({ length: 81 }, (_, index) =>
        buildMessage("user", `Message ${index + 1}`, {
          id: `message-${index + 1}`,
        }),
      ),
      status: "idle",
    });

    rendered.rerender(
      createElement(AgentChatThread, {
        model: {
          ...model,
          session: nextSession,
        },
      }),
    );
    await act(flush);

    expect(rendered.container.textContent).toContain("Message 81");
    rendered.unmount();
  });

  test("shows loading overlay while transcript is pending", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatThread, {
        model: {
          ...buildBaseModel(),
          transcriptState: buildThreadTranscriptState({
            kind: "session_loading",
            reason: "preparing",
          }),
          session: buildSession({
            externalSessionId: "session-loading",
            messages: [buildMessage("assistant", "Loading", { id: "assistant-1" })],
          }),
        },
      }),
    );

    expect(html).toContain("Loading session");
    expect(html).toContain("Preparing the selected session view.");
  });

  test("hides transcript rows while same-session history is loading", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatThread, {
        model: {
          ...buildBaseModel(),
          transcriptState: buildThreadTranscriptState({
            kind: "session_loading",
            reason: "history",
          }),
          session: buildSession({
            externalSessionId: "session-history-loading",
            messages: [
              buildMessage("assistant", "Old cached message", {
                id: "assistant-old-1",
              }),
            ],
          }),
        },
      }),
    );

    expect(html).toContain("Loading session");
    expect(html).toContain("Loading the selected conversation.");
    expect(html).not.toContain("Old cached message");
  });

  test("preserves expanded tool details while same-session history load appends messages", async () => {
    const messages = [
      buildMessage("tool", "Tool read_task completed", {
        id: "tool-1",
        meta: {
          kind: "tool",
          partId: "part-1",
          callId: "call-1",
          tool: "read_task",
          toolType: "generic" as const,
          status: "completed",
          input: { taskId: "openducktor-d4li" },
          output: '{"task":{"id":"openducktor-d4li","title":"Fix chat flicker"}}',
        },
      }),
    ];
    const session = buildSession({
      externalSessionId: "session-tool-history-loading",
      messages,
    });
    const model = {
      ...buildBaseModel(),
      transcriptState: buildThreadTranscriptState({ kind: "visible" }),
      session,
    };

    const rendered = render(
      createElement(AgentChatThread, {
        model,
      }),
    );
    await act(flush);

    const toolDetails = rendered.container.querySelector(
      "details.group",
    ) as HTMLDetailsElement | null;
    if (!toolDetails) {
      throw new Error("Expected expandable tool details");
    }
    toolDetails.open = true;

    rendered.rerender(
      createElement(AgentChatThread, {
        model: {
          ...model,
          session: buildSession({
            ...session,
            messages: [
              ...messages,
              buildMessage("assistant", "Next streamed response", {
                id: "assistant-2",
              }),
            ],
          }),
        },
      }),
    );
    await act(flush);

    expect(toolDetails.isConnected).toBe(true);
    expect(toolDetails.open).toBe(true);

    rendered.unmount();
  });

  test("renders native scroll controls for top and bottom navigation", async () => {
    setGlobalWindow(globalThis);
    const rendered = render(
      createElement(AgentChatThread, {
        model: {
          ...buildBaseModel(),
          messagesContainerRef: createRef<HTMLDivElement>(),
          session: buildLongSession("session-scroll", 80),
        },
      }),
    );
    await act(flush);

    const containerNode = rendered.container.querySelector(".hide-scrollbar") as
      | (HTMLDivElement & ScrollContainerMock)
      | null;
    if (!containerNode) {
      throw new Error("Expected messages container node");
    }
    Object.defineProperty(containerNode, "clientHeight", {
      configurable: true,
      value: 320,
    });
    Object.defineProperty(containerNode, "scrollHeight", {
      configurable: true,
      value: 2000,
    });
    Object.defineProperty(containerNode, "scrollTop", {
      configurable: true,
      writable: true,
      value: 1680,
    });

    const scrollToTopButton = screen.getByRole("button", {
      name: "Scroll to top",
    });
    const scrollToBottomButton = screen.getByRole("button", {
      name: "Scroll to bottom",
    });

    fireEvent.click(scrollToTopButton);
    await act(flush);

    expect(containerNode.scrollTop).toBe(0);

    fireEvent.click(scrollToBottomButton);
    await act(flush);

    expect(containerNode.scrollTop).toBe(2_000);

    rendered.unmount();
  });

  test("resyncs the transcript when the todo stack first appears", async () => {
    const syncBottomAfterComposerLayout = mock(() => {});
    const syncBottomAfterComposerLayoutRef = {
      current: null,
    } as { current: (() => void) | null };
    const model = {
      ...buildBaseModel(),
      syncBottomAfterComposerLayoutRef,
      session: buildSession(),
    };

    const rendered = render(
      createElement(AgentChatThread, {
        model,
      }),
    );
    await act(flush);
    syncBottomAfterComposerLayoutRef.current = syncBottomAfterComposerLayout;

    rendered.rerender(
      createElement(AgentChatThread, {
        model: {
          ...model,
          session: buildSession({
            externalSessionId: model.session?.externalSessionId,
          }),
          todos: [
            buildTodoItem({
              content: "Keep transcript pinned",
              status: "in_progress",
            }),
          ],
        },
      }),
    );
    await act(flush);

    const bottomStack = rendered.container.querySelector(".agent-chat-bottom-stack");
    if (!(bottomStack instanceof HTMLDivElement)) {
      throw new Error("Expected bottom stack element");
    }
    const bottomStackWrapper = bottomStack.parentElement;
    if (!(bottomStackWrapper instanceof HTMLDivElement)) {
      throw new Error("Expected bottom stack wrapper element");
    }

    syncBottomAfterComposerLayoutRef.current = syncBottomAfterComposerLayout;
    syncBottomAfterComposerLayout.mockClear();

    triggerResizeObservers(new Map([[bottomStackWrapper, 72]]));

    expect(syncBottomAfterComposerLayout).toHaveBeenCalledTimes(1);

    rendered.unmount();
  });

  test("resyncs the transcript when the todo panel expands", async () => {
    const syncBottomAfterComposerLayout = mock(() => {});
    const syncBottomAfterComposerLayoutRef = {
      current: null,
    } as { current: (() => void) | null };
    const session = buildSession();
    const model = {
      ...buildBaseModel(),
      syncBottomAfterComposerLayoutRef,
      session,
      todos: [
        buildTodoItem({
          content: "Keep transcript pinned",
          status: "in_progress",
        }),
      ],
      todoPanelCollapsed: true,
    };

    const rendered = render(
      createElement(AgentChatThread, {
        model,
      }),
    );
    await act(flush);
    syncBottomAfterComposerLayoutRef.current = syncBottomAfterComposerLayout;

    const bottomStack = rendered.container.querySelector(".agent-chat-bottom-stack");
    if (!(bottomStack instanceof HTMLDivElement)) {
      throw new Error("Expected bottom stack element");
    }
    const bottomStackWrapper = bottomStack.parentElement;
    if (!(bottomStackWrapper instanceof HTMLDivElement)) {
      throw new Error("Expected bottom stack wrapper element");
    }

    syncBottomAfterComposerLayout.mockClear();
    triggerResizeObservers(new Map([[bottomStackWrapper, 56]]));
    syncBottomAfterComposerLayout.mockClear();

    rendered.rerender(
      createElement(AgentChatThread, {
        model: {
          ...model,
          todoPanelCollapsed: false,
        },
      }),
    );
    await act(flush);

    syncBottomAfterComposerLayoutRef.current = syncBottomAfterComposerLayout;
    triggerResizeObservers(new Map([[bottomStackWrapper, 140]]));

    expect(syncBottomAfterComposerLayout).toHaveBeenCalledTimes(1);

    rendered.unmount();
  });
});
