import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import type { SessionNavigationModel } from "@/state/read-models/session-navigation-read-model";
import {
  navigationModel,
  taskSessionEntry,
  workspaceSessionEntry,
} from "./session-navigation.test-support";
import { useRevealSelectedSession } from "./use-reveal-selected-session";

function RevealHarness({
  model,
  selectedKey,
  visibleKey = selectedKey,
  mode = "list",
  exitingTitle,
}: {
  model: SessionNavigationModel;
  selectedKey: string | null;
  visibleKey?: string | null;
  mode?: "list" | "rail";
  exitingTitle?: string;
}): ReactElement {
  const scrollRegionRef = useRevealSelectedSession(
    model,
    { entryKey: selectedKey, visibleKey },
    mode,
  );
  return (
    <div ref={scrollRegionRef} data-testid="session-list">
      {exitingTitle ? (
        <div inert aria-hidden="true">
          <button type="button" aria-current="true" disabled>
            {exitingTitle}
          </button>
        </div>
      ) : null}
      {model.groups
        .flatMap((group) => group.entries)
        .map((entry) => (
          <button
            key={entry.key}
            type="button"
            aria-current={entry.key === selectedKey ? "true" : undefined}
          >
            {entry.title}
          </button>
        ))}
    </div>
  );
}

const chat = workspaceSessionEntry("chat");
const task = taskSessionEntry("task");
const originalScrollIntoView = Element.prototype.scrollIntoView;
let revealed: string[] = [];

beforeEach(() => {
  revealed = [];
  Element.prototype.scrollIntoView = function (this: Element) {
    revealed.push(this.textContent ?? "");
  };
});

afterEach(() => {
  Element.prototype.scrollIntoView = originalScrollIntoView;
});

describe("useRevealSelectedSession", () => {
  test("keeps the scroll position when another session becomes the task's card", () => {
    const view = render(
      <RevealHarness
        model={navigationModel({ recent: [task] })}
        selectedKey={task.key}
        visibleKey="open-task-session"
      />,
    );
    expect(revealed).toEqual(["Task task"]);
    fireEvent.wheel(screen.getByTestId("session-list"));
    const replacement = taskSessionEntry("replacement", { taskId: "task-task" });
    view.rerender(
      <RevealHarness
        model={navigationModel({ recent: [replacement] })}
        selectedKey={replacement.key}
        visibleKey="open-task-session"
      />,
    );
    expect(revealed).toEqual(["Task task"]);
  });

  test("reveals the live selection instead of a retained exit visual", () => {
    render(
      <RevealHarness
        model={navigationModel({ recent: [chat] })}
        selectedKey={chat.key}
        exitingTitle="Outgoing session"
      />,
    );

    expect(revealed).toEqual(["Chat chat"]);
  });

  test("does not scroll the list when session activity changes its order", () => {
    const view = render(
      <RevealHarness model={navigationModel({ recent: [chat, task] })} selectedKey={chat.key} />,
    );
    expect(revealed).toEqual(["Chat chat"]);

    view.rerender(
      <RevealHarness model={navigationModel({ recent: [task, chat] })} selectedKey={chat.key} />,
    );
    expect(revealed).toEqual(["Chat chat"]);

    fireEvent.wheel(screen.getByTestId("session-list"));
    view.rerender(
      <RevealHarness model={navigationModel({ recent: [chat, task] })} selectedKey={chat.key} />,
    );
    expect(revealed).toEqual(["Chat chat"]);
  });

  test("keeps the user's scroll position through status changes and reveals a new selection or mode", () => {
    const view = render(
      <RevealHarness model={navigationModel({ recent: [chat, task] })} selectedKey={chat.key} />,
    );
    fireEvent.wheel(screen.getByTestId("session-list"));

    view.rerender(
      <RevealHarness
        model={navigationModel({ running: [chat], recent: [task] })}
        selectedKey={chat.key}
      />,
    );
    expect(revealed).toEqual(["Chat chat"]);

    view.rerender(
      <RevealHarness
        model={navigationModel({ running: [chat], recent: [task] })}
        selectedKey={task.key}
      />,
    );
    expect(revealed).toEqual(["Chat chat", "Task task"]);

    view.rerender(
      <RevealHarness
        model={navigationModel({ running: [chat], recent: [task] })}
        selectedKey={task.key}
        mode="rail"
      />,
    );
    expect(revealed).toEqual(["Chat chat", "Task task", "Task task"]);
  });

  test("waits for the selected session to load and reveals it again after leaving", () => {
    const view = render(
      <RevealHarness model={navigationModel({ recent: [task] })} selectedKey={null} />,
    );
    view.rerender(
      <RevealHarness model={navigationModel({ recent: [task] })} selectedKey={chat.key} />,
    );

    expect(revealed).toEqual([]);

    view.rerender(
      <RevealHarness model={navigationModel({ recent: [chat, task] })} selectedKey={chat.key} />,
    );
    expect(revealed).toEqual(["Chat chat"]);

    view.rerender(
      <RevealHarness model={navigationModel({ recent: [chat, task] })} selectedKey={null} />,
    );
    view.rerender(
      <RevealHarness model={navigationModel({ recent: [chat, task] })} selectedKey={chat.key} />,
    );
    expect(revealed).toEqual(["Chat chat", "Chat chat"]);
  });
});
