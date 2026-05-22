import { normalizePersistedSelection } from "../support/models";
import { readPlannerAgentSessionPresenceSnapshot } from "./load-sessions-runtime-resolution-stage";
import {
  EMPTY_PROMPT_OVERRIDES,
  SESSION_HISTORY_HYDRATION_CONCURRENCY,
} from "./load-sessions-stage-constants";
import type {
  LiveReconciliationStageInput,
  LiveReconciliationStageOutput,
} from "./load-sessions-stages";
import { createReattachLiveSession } from "./reattach-live-session";

export const reconcileLiveSessionsStage = async ({
  intent,
  options,
  adapter,
  sessionsRef,
  updateSession,
  attachSessionListener,
  isStaleRepoOperation,
  recordsToHydrate,
  runtimePlanner,
  promptAssembler,
  getRepoPromptOverrides,
}: LiveReconciliationStageInput): Promise<LiveReconciliationStageOutput> => {
  if (!intent.shouldReconcileLiveSessions) {
    return { reattachedSessionIds: new Set<string>() };
  }
  const maybeResumeLiveRecord = createReattachLiveSession({
    adapter,
    repoPath: intent.repoPath,
    getCurrentSession: (externalSessionId) => sessionsRef.current[externalSessionId] ?? null,
    updateSession,
    ...(attachSessionListener ? { attachSessionListener } : {}),
    promptOverrides: EMPTY_PROMPT_OVERRIDES,
    readSessionPresence: (record) =>
      readPlannerAgentSessionPresenceSnapshot(runtimePlanner, record),
    attachMissingLiveSession: async ({ record, runtimeKind, workingDirectory }) => {
      if (isStaleRepoOperation()) {
        return;
      }
      const promptOverrides = await getRepoPromptOverrides();
      if (isStaleRepoOperation()) {
        return;
      }
      const selectedModel = normalizePersistedSelection(record.selectedModel);
      const systemPrompt = await promptAssembler.buildHydrationSystemPrompt({
        record,
        promptOverrides,
      });
      if (isStaleRepoOperation()) {
        return;
      }
      const attachInput = {
        externalSessionId: record.externalSessionId,
        repoPath: intent.repoPath,
        runtimeKind,
        workingDirectory,
        taskId: intent.taskId,
        role: record.role,
        systemPrompt,
        ...(selectedModel ? { model: selectedModel } : {}),
      };

      if (intent.mode === "requested_history") {
        await adapter.attachSession(attachInput);
      } else {
        await adapter.resumeSession(attachInput);
      }
    },
    allowAttachMissingSession: options?.allowLiveSessionResume !== false,
    isStaleRepoOperation,
  });

  const reattachedSessionIds = new Set<string>();
  const processReattachBatch = async (offset: number): Promise<void> => {
    if (offset >= recordsToHydrate.length) {
      return;
    }
    if (isStaleRepoOperation()) {
      return;
    }
    const batch = recordsToHydrate.slice(offset, offset + SESSION_HISTORY_HYDRATION_CONCURRENCY);
    const reattachResults = await Promise.all(
      batch.map(async (record) => ({
        record,
        reattached: await maybeResumeLiveRecord(record),
      })),
    );
    if (!isStaleRepoOperation()) {
      for (const { record, reattached } of reattachResults) {
        if (reattached) {
          reattachedSessionIds.add(record.externalSessionId);
        }
      }
    }
    await processReattachBatch(offset + SESSION_HISTORY_HYDRATION_CONCURRENCY);
  };

  await processReattachBatch(0);

  return { reattachedSessionIds };
};
