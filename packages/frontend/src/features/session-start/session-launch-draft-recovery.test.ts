import { expect, mock, spyOn, test } from "bun:test";
import { Activity, createElement, type ComponentType, type PropsWithChildren } from "react";
import type {
  WorkflowLaunchSnapshot,
  WorkspaceSessionLaunchSnapshot,
} from "@openducktor/contracts";
import { toast, type Action } from "sonner";
import {
  createEmptyComposerDraft,
  createTextSegment,
  draftHasMeaningfulContent,
} from "@/components/features/agents/agent-chat/agent-chat-composer-draft";
import { useAgentChatComposerDraftState } from "@/components/features/agents/agent-chat/use-agent-chat-composer-draft-state";
import {
  createAgentStudioChatDraftPersistence,
  agentStudioChatDraftScopeKey,
} from "@/pages/agents/agent-studio-chat-draft";
import { createWorkspaceSessionChatDraftPersistence } from "@/pages/workspace-sessions/workspace-session-chat-draft";
import { presentWorkspaceSessionLaunch } from "@/pages/workspace-sessions/use-workspace-session-launch-recovery";
import { configureShellBridge, createUnavailableShellBridge } from "@/lib/shell-bridge";
import { createShellBridgeFixture } from "@/test-utils/focused-fixture";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import { presentWorkflowLaunchOutcome } from "./session-start-message-recovery";
import { updateSessionLaunchDraft } from "./session-launch-draft-recovery";
import type { AgentChatDraftScope } from "@/components/features/agents/agent-chat/agent-chat-draft-scope";
import { writeAgentChatDraftToStorage } from "@/components/features/agents/agent-chat/agent-chat-draft-storage";

const createDraftHarness = (
  scope: AgentChatDraftScope,
  wrapper: ComponentType<PropsWithChildren>,
) => createHookHarness(useAgentChatComposerDraftState, { scope }, { wrapper });

test.each(["task", "workspace"] as const)(
  "accepted recovery clears only the saved %s launch draft without the old renderer callback",
  async (owner) => {
    for (const change of [
      "unchanged",
      "before view opens",
      "edit before reload",
      "edit",
      "retype",
      "other attempt",
    ] as const) {
      const workspaceId = crypto.randomUUID();
      const session = {
        externalSessionId: "native",
        runtimeKind: "codex" as const,
        workingDirectory: "/repo",
      };
      const identity =
        owner === "task"
          ? { workspaceId, ...session }
          : { workspaceId, workspaceSessionId: "saved" };
      const persistence =
        owner === "task"
          ? createAgentStudioChatDraftPersistence({ workspaceId, taskId: "task", session })!
          : createWorkspaceSessionChatDraftPersistence(workspaceId, "saved");
      const draft = { segments: [createTextSegment("retry instruction")], attachments: [] };
      const common = {
        workspaceId,
        repoPath: "/repo",
        launchAttemptId: crypto.randomUUID(),
        phase: "completed" as const,
        acceptance: "accepted" as const,
        ownershipSaved: true,
        recoveryAllowed: false,
      };
      const launch: WorkflowLaunchSnapshot | WorkspaceSessionLaunchSnapshot =
        owner === "task"
          ? {
              ...common,
              taskId: "task",
              role: "spec",
              completedPreStartActions: [],
              session: { ...session, startedAt: "2026-10-04T00:00:00Z", status: "idle" },
            }
          : { ...common, sessionId: "saved" };
      // The new renderer has storage, but no callback from the renderer that restored the failure.
      let launchAttemptId: string | undefined = launch.launchAttemptId;
      if (change === "edit before reload") launchAttemptId = undefined;
      if (change === "other attempt") launchAttemptId = "new-attempt";
      writeAgentChatDraftToStorage({
        storage: localStorage,
        identity,
        taskId: owner === "task" ? "task" : null,
        draft,
        updatedAt: new Date().toISOString(),
        launchAttemptId,
      });
      const harness = createDraftHarness(
        { key: persistence.targetKey, persistence },
        ({ children }) => children,
      );
      if (change === "before view opens") updateSessionLaunchDraft(launch);
      await harness.mount();
      try {
        const cleared = change === "unchanged" || change === "before view opens";
        if (change === "before view opens")
          expect(draftHasMeaningfulContent(harness.getLatest().draft)).toBe(false);
        else expect(harness.getLatest().draft).toEqual(draft);
        if (change === "retype")
          await harness.run((state) => state.commitDraft(createEmptyComposerDraft()));
        if (change === "edit" || change === "retype")
          await harness.run((state) => state.commitDraft(draft));
        await harness.run(() => updateSessionLaunchDraft(launch));
        expect(draftHasMeaningfulContent(harness.getLatest().draft)).toBe(!cleared);
        expect(draftHasMeaningfulContent(persistence.hydrate())).toBe(!cleared);
        await persistence.flush();
      } finally {
        await harness.unmount();
        persistence.clear();
      }
    }
  },
);

test.each(["task", "workspace"] as const)(
  "Retry clears only its unchanged %s draft across view changes",
  async (owner) => {
    for (const change of [
      "unchanged",
      "edit",
      "other view",
      "hidden view",
      "remount",
      "remount and edit",
      "remount clear and edit",
      "retry failed",
    ] as const) {
      const workspaceId = crypto.randomUUID();
      const identity = {
        externalSessionId: "native",
        runtimeKind: "codex" as const,
        workingDirectory: "/repo",
      };
      const persistence =
        owner === "task"
          ? createAgentStudioChatDraftPersistence({
              workspaceId,
              taskId: "task",
              session: identity,
            })!
          : createWorkspaceSessionChatDraftPersistence(workspaceId, "saved");
      const key =
        owner === "task"
          ? agentStudioChatDraftScopeKey(workspaceId, {
              taskId: "task",
              role: "spec",
              session: identity,
            })
          : persistence.targetKey;
      const scope = { key, persistence };
      const origin = owner === "task" ? { key: "new", persistence: null } : scope;
      let mode: "visible" | "hidden" = "visible";
      const wrapper = ({ children }: PropsWithChildren) =>
        createElement(Activity, { mode, children });
      let harness = createDraftHarness(origin, wrapper);
      const draft = { segments: [createTextSegment("retry instruction")] };
      const newer = { segments: [createTextSegment("new input")] };
      const common = {
        launchAttemptId: crypto.randomUUID(),
        workspaceId,
        repoPath: "/repo",
        phase: "failed" as const,
        acceptance: "rejected" as const,
        ownershipSaved: true,
        recoveryAllowed: true,
        failure: { message: "Rejected", stage: "send", cleanupErrors: [] },
      };
      const launch: WorkflowLaunchSnapshot | WorkspaceSessionLaunchSnapshot =
        owner === "task"
          ? {
              ...common,
              taskId: "task",
              role: "spec",
              completedPreStartActions: [],
              session: { ...identity, startedAt: "2026-10-04T00:00:00Z", status: "idle" },
            }
          : { ...common, sessionId: "saved" };
      const pending = Promise.withResolvers<typeof launch>();
      const recover = mock(() => pending.promise);
      const failure = spyOn(toast, "error").mockImplementation(() => "toast");
      configureShellBridge(
        createShellBridgeFixture({
          client: {
            workspaceSessionLaunchRecover: async () => {
              const outcome = await recover();
              if (!("sessionId" in outcome)) throw new Error("Expected a workspace launch.");
              return outcome;
            },
          },
        }),
      );
      const present = () => {
        if ("taskId" in launch)
          presentWorkflowLaunchOutcome(launch, {
            agentSessionWorkflowLaunchRecover: async () => {
              const outcome = await recover();
              if (!("taskId" in outcome)) throw new Error("Expected a task launch.");
              return outcome;
            },
          });
        else presentWorkspaceSessionLaunch(launch, "Chat");
      };
      await harness.mount();
      try {
        const snapshot = harness.getLatest().createSubmittedDraftSnapshot(draft);
        await harness.run((state) => {
          state.clearSubmittedDraft(snapshot);
          state.setDisplayedDraft(createEmptyComposerDraft());
        });
        await harness.update({ scope });
        await harness.run((state) =>
          state.restoreSubmittedDraft(snapshot, {
            kind: "recover_draft",
            originKey: origin.key,
            recoveryKey: key,
            persistence,
            launchAttemptId: launch.launchAttemptId,
            error: new Error("Rejected"),
          }),
        );
        expect(harness.getLatest().draft).toEqual(draft);
        await persistence.flush();
        expect(JSON.parse(localStorage.getItem(persistence.targetKey)!)).toMatchObject({
          launchAttemptId: launch.launchAttemptId,
        });
        present();
        // A later live update can replace the toast before the user clicks Retry.
        present();
        const action = failure.mock.calls.at(-1)?.[1]?.action;
        expect(action).toEqual(
          expect.objectContaining({ label: "Retry message", onClick: expect.any(Function) }),
        );
        // SAFETY: The assertion checks the Action. Both presenters use a callback with no event argument.
        const retry = (action as Action).onClick as () => void;
        await harness.run(retry);
        if (change.startsWith("remount")) {
          await harness.unmount();
          harness = createDraftHarness(scope, wrapper);
          await harness.mount();
        }
        if (change === "remount clear and edit")
          await harness.run((state) => state.commitDraft(createEmptyComposerDraft()));
        const edited = change === "edit" || change.endsWith("edit");
        if (edited) await harness.run((state) => state.commitDraft(newer));
        if (change === "other view")
          await harness.update({ scope: { key: "other", persistence: null } });
        if (change === "hidden view") {
          mode = "hidden";
          await harness.update({ scope });
        }
        await harness.run(() =>
          pending.resolve(
            change === "retry failed"
              ? launch
              : {
                  ...launch,
                  phase: "completed",
                  acceptance: "accepted",
                  recoveryAllowed: false,
                  failure: undefined,
                },
          ),
        );
        expect(recover).toHaveBeenCalledTimes(1);
        if (change === "other view") await harness.update({ scope });
        if (change === "hidden view") {
          mode = "visible";
          await harness.update({ scope });
        }
        if (edited) {
          expect(harness.getLatest().draft).toEqual(newer);
          expect(persistence.hydrate()).toEqual(newer);
        } else if (change === "retry failed") expect(harness.getLatest().draft).toEqual(draft);
        else {
          expect(draftHasMeaningfulContent(harness.getLatest().draft)).toBe(false);
          expect(draftHasMeaningfulContent(persistence.hydrate())).toBe(false);
        }
      } finally {
        await harness.unmount();
        persistence.clear();
        failure.mockRestore();
        configureShellBridge(createUnavailableShellBridge());
      }
    }
  },
);
