import type { AgentEnginePort } from "@openducktor/core";
import { useCallback } from "react";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentOperationsContextValue } from "@/types/state-slices";
import { mergeHydratedMessages } from "../support/hydrated-message-merge";
import { getSessionMessageCount } from "../support/messages";
import { createRuntimeTranscriptSession } from "../support/runtime-transcript-session";
import { isTranscriptAgentSession } from "../support/session-purpose";
import type { UpdateAgentSession } from "./use-agent-session-mutations";

type AttachRuntimeTranscriptSessionInput = Parameters<
  AgentOperationsContextValue["attachRuntimeTranscriptSession"]
>[0];

type UseRuntimeTranscriptAttachmentArgs = {
  agentEngine: AgentEnginePort;
  sessionsRef: { current: Record<string, AgentSessionState> };
  unsubscribersRef: { current: Map<string, () => void> };
  commitSessions: (
    updater:
      | Record<string, AgentSessionState>
      | ((current: Record<string, AgentSessionState>) => Record<string, AgentSessionState>),
  ) => void;
  updateSession: UpdateAgentSession;
  attachSessionListener: (repoPath: string, externalSessionId: string) => void;
  removeSessionIds: (externalSessionIds: string[]) => void;
};

export const useRuntimeTranscriptAttachment = ({
  agentEngine,
  sessionsRef,
  unsubscribersRef,
  commitSessions,
  updateSession,
  attachSessionListener,
  removeSessionIds,
}: UseRuntimeTranscriptAttachmentArgs) => {
  return useCallback(
    async (input: AttachRuntimeTranscriptSessionInput): Promise<void> => {
      const existingSession = sessionsRef.current[input.externalSessionId];
      if (existingSession && !isTranscriptAgentSession(existingSession)) {
        throw new Error(
          `Session ${input.externalSessionId} is already active and is not a transcript.`,
        );
      }
      const { kind: runtimeKind, runtimeId } = input.runtimeRef;

      const hadRuntimeSession = agentEngine.hasSession(input.externalSessionId);
      let attachedListener = false;
      const unsubscribeTranscriptListener = (): void => {
        const unsubscribe = unsubscribersRef.current.get(input.externalSessionId);
        unsubscribe?.();
        unsubscribersRef.current.delete(input.externalSessionId);
      };
      const detachRuntimeSessionIfPresent = async (): Promise<void> => {
        unsubscribeTranscriptListener();
        if (!hadRuntimeSession && agentEngine.hasSession(input.externalSessionId)) {
          await agentEngine.detachSession(input.externalSessionId);
        }
      };
      const isCurrentTranscriptRequest = (): boolean => {
        const current = sessionsRef.current[input.externalSessionId];
        return (
          current !== undefined &&
          isTranscriptAgentSession(current) &&
          current.externalSessionId === input.externalSessionId &&
          current.runtimeKind === runtimeKind &&
          current.runtimeId === runtimeId
        );
      };
      const hasMatchingLocalSession = isCurrentTranscriptRequest();
      const hadLocalSession = hasMatchingLocalSession;
      if (existingSession && hadRuntimeSession && !hasMatchingLocalSession) {
        throw new Error(
          "Transcript session identity does not match the requested runtime session.",
        );
      }
      if (hasMatchingLocalSession && hadRuntimeSession) {
        attachSessionListener(input.repoPath, input.externalSessionId);
        return;
      }
      if (!hasMatchingLocalSession) {
        unsubscribeTranscriptListener();
        const initialSession = createRuntimeTranscriptSession({
          repoPath: input.repoPath,
          externalSessionId: input.externalSessionId,
          runtimeRef: input.runtimeRef,
          workingDirectory: input.workingDirectory,
          history: [],
          isLive: true,
          pendingApprovals: input.pendingApprovals ?? [],
          pendingQuestions: input.pendingQuestions ?? [],
        });
        commitSessions((current) => ({
          ...current,
          [input.externalSessionId]: initialSession,
        }));
      }

      try {
        const summaryPromise = hadRuntimeSession
          ? Promise.resolve(null)
          : agentEngine.attachSession({
              externalSessionId: input.externalSessionId,
              repoPath: input.repoPath,
              runtimeKind,
              runtimeId,
              workingDirectory: input.workingDirectory,
              purpose: "transcript",
              taskId: "",
              role: null,
              systemPrompt: "",
            });

        attachSessionListener(input.repoPath, input.externalSessionId);
        attachedListener = true;
        const summary = await summaryPromise;
        if (!isCurrentTranscriptRequest()) {
          await detachRuntimeSessionIfPresent();
        } else {
          const history = await agentEngine.loadSessionHistory({
            repoPath: input.repoPath,
            runtimeKind,
            workingDirectory: input.workingDirectory,
            externalSessionId: input.externalSessionId,
          });
          if (!isCurrentTranscriptRequest()) {
            await detachRuntimeSessionIfPresent();
          } else {
            const hydratedSession = createRuntimeTranscriptSession({
              repoPath: input.repoPath,
              externalSessionId: input.externalSessionId,
              runtimeRef: input.runtimeRef,
              workingDirectory: input.workingDirectory,
              history,
              isLive: true,
              pendingApprovals: input.pendingApprovals ?? [],
              pendingQuestions: input.pendingQuestions ?? [],
            });

            updateSession(
              input.externalSessionId,
              (current) => {
                const messages =
                  getSessionMessageCount(current) === 0
                    ? hydratedSession.messages
                    : mergeHydratedMessages(
                        input.externalSessionId,
                        hydratedSession.messages,
                        current.messages,
                      );

                return {
                  ...current,
                  startedAt: summary?.startedAt ?? hydratedSession.startedAt,
                  status: summary?.status ?? current.status,
                  runtimeKind,
                  runtimeId,
                  workingDirectory: input.workingDirectory,
                  historyHydrationState: "hydrated",
                  runtimeRecoveryState: "idle",
                  pendingApprovals: current.pendingApprovals,
                  pendingQuestions: current.pendingQuestions,
                  messages,
                };
              },
              { persist: false },
            );
          }
        }
      } catch (error) {
        if (attachedListener && !hadLocalSession) {
          unsubscribeTranscriptListener();
        }
        if (!hadRuntimeSession && agentEngine.hasSession(input.externalSessionId)) {
          await agentEngine.detachSession(input.externalSessionId);
        }
        if (!hadLocalSession) {
          removeSessionIds([input.externalSessionId]);
        }
        throw error;
      }
    },
    [
      agentEngine,
      attachSessionListener,
      commitSessions,
      removeSessionIds,
      sessionsRef,
      unsubscribersRef,
      updateSession,
    ],
  );
};
