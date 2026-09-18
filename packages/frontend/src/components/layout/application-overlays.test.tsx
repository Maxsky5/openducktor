import { describe, expect, test } from "bun:test";
import { Children, type ElementType, isValidElement, type ReactNode } from "react";
import { AgentSessionTranscriptDialogHost } from "@/components/features/agents/agent-chat/use-agent-session-transcript-dialog";
import { TaskWorkflowActionsProvider } from "@/features/task-workflow/task-workflow-actions-provider";
import { ApplicationOverlays } from "./application-overlays";

function findElementByType(node: ReactNode, type: ElementType): ReactNode {
  for (const child of Children.toArray(node)) {
    if (!isValidElement<{ children?: ReactNode }>(child)) {
      continue;
    }
    if (child.type === type) {
      return child;
    }
    const match = findElementByType(child.props.children, type);
    if (match) {
      return match;
    }
  }
  return null;
}

function containsElementByType(node: ReactNode, type: ElementType): boolean {
  return findElementByType(node, type) !== null;
}

describe("ApplicationOverlays", () => {
  test("mounts the transcript dialog host inside the task workflow actions provider", () => {
    const overlays = ApplicationOverlays({ children: null });
    const provider = findElementByType(overlays, TaskWorkflowActionsProvider);
    const dialogHost = findElementByType(overlays, AgentSessionTranscriptDialogHost);

    expect(provider).not.toBeNull();
    expect(dialogHost).not.toBeNull();
    expect(containsElementByType(provider, AgentSessionTranscriptDialogHost)).toBe(true);
    expect(containsElementByType(dialogHost, TaskWorkflowActionsProvider)).toBe(false);
  });
});
