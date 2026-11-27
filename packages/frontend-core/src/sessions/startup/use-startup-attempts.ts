import { useCallback, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { useClientConnection } from "../../connection/client-connection-react";
import type { AgentChatComposerDraft } from "../../drafts/agent-chat-composer-draft";
import type { StartupAttempt } from "./startup-attempt-store";
import {
  findDraftStartupAttempt,
  findWorkspaceSessionStartupAttempt,
  matchesStartupScope,
  startupIsPending,
  type StartupScopeMatcher,
} from "./startup-navigation";
export type {
  StartupAttempt,
  StartupRecoveryAction,
  StartupPresentation,
} from "./startup-attempt-store";

const EMPTY_ATTEMPTS: readonly StartupAttempt[] = [];

const isExpiredNotification = (attempt: StartupAttempt, now: number): boolean =>
  attempt.presentation === "notification" &&
  attempt.status.phase === "ready" &&
  attempt.status.successExpiresAt !== undefined &&
  attempt.status.successExpiresAt <= now;

const visibleStartupAttempts = (
  attempts: readonly StartupAttempt[],
  now: number,
): readonly StartupAttempt[] =>
  attempts.some((attempt) => isExpiredNotification(attempt, now))
    ? attempts.filter((attempt) => !isExpiredNotification(attempt, now))
    : attempts;

export const useStartupAttempts = (): readonly StartupAttempt[] => {
  const { startupAttempts } = useClientConnection();
  const attempts = useSyncExternalStore(
    startupAttempts.subscribe,
    startupAttempts.getSnapshot,
    startupAttempts.getSnapshot,
  );
  useEffect(() => {
    const deadlines = attempts.flatMap((attempt) =>
      attempt.presentation === "notification" &&
      attempt.status.phase === "ready" &&
      attempt.status.successExpiresAt !== undefined
        ? [attempt.status.successExpiresAt]
        : [],
    );
    if (deadlines.length === 0) return;
    const timer = setTimeout(
      () => startupAttempts.expireSuccess(),
      Math.max(0, Math.min(...deadlines) - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [attempts, startupAttempts]);
  // A native app can suspend timers. Expiry is absolute, including its hidden time.
  return visibleStartupAttempts(attempts, Date.now());
};

export const useStartupAttemptsSelector = <Selected>(
  select: (attempts: readonly StartupAttempt[]) => Selected,
): Selected => {
  const { startupAttempts } = useClientConnection();
  const readSnapshot = useCallback(
    () => select(startupAttempts.getSnapshot()),
    [select, startupAttempts],
  );
  return useSyncExternalStore(startupAttempts.subscribe, readSnapshot, readSnapshot);
};

export const useStartupAttempt = (id: string | null | undefined): StartupAttempt | null => {
  const { startupAttempts } = useClientConnection();
  const readSnapshot = useCallback(() => {
    if (!id) return null;
    const attempt = startupAttempts.getAttempt(id);
    return attempt && !isExpiredNotification(attempt, Date.now()) ? attempt : null;
  }, [id, startupAttempts]);
  return useSyncExternalStore(startupAttempts.subscribe, readSnapshot, readSnapshot);
};

export const useDraftStartupAttempt = (draftId: string | null | undefined): StartupAttempt | null =>
  useStartupAttemptsSelector(
    useCallback(
      (attempts) => (draftId ? findDraftStartupAttempt(attempts, draftId) : null),
      [draftId],
    ),
  );

const useWorkspaceSessionStartupField = <Selected>(
  workspaceId: string,
  sessionId: string | null | undefined,
  select: (attempt: StartupAttempt | null) => Selected,
): Selected =>
  useStartupAttemptsSelector(
    useCallback(
      (attempts) =>
        select(
          sessionId ? findWorkspaceSessionStartupAttempt(attempts, workspaceId, sessionId) : null,
        ),
      [select, sessionId, workspaceId],
    ),
  );

const selectHasAttempt = (attempt: StartupAttempt | null): boolean => attempt !== null;
const selectIsPending = (attempt: StartupAttempt | null): boolean =>
  attempt !== null && startupIsPending(attempt);
const selectLabel = (attempt: StartupAttempt | null): string | null => attempt?.label ?? null;
const selectSubmittedComposer = (attempt: StartupAttempt | null): AgentChatComposerDraft | null =>
  attempt?.submittedComposer ?? null;

export const useWorkspaceSessionHasStartupAttempt = (
  workspaceId: string,
  sessionId: string | null | undefined,
): boolean => useWorkspaceSessionStartupField(workspaceId, sessionId, selectHasAttempt);

export const useWorkspaceSessionStartupPending = (
  workspaceId: string,
  sessionId: string | null | undefined,
): boolean => useWorkspaceSessionStartupField(workspaceId, sessionId, selectIsPending);

export const useWorkspaceSessionStartupTitle = (
  workspaceId: string,
  sessionId: string | null | undefined,
): string | null => useWorkspaceSessionStartupField(workspaceId, sessionId, selectLabel);

export const useWorkspaceSessionStartupSubmittedComposer = (
  workspaceId: string,
  sessionId: string | null | undefined,
): AgentChatComposerDraft | null =>
  useWorkspaceSessionStartupField(workspaceId, sessionId, selectSubmittedComposer);

const arraysShallowEqual = (
  left: readonly StartupAttempt[],
  right: readonly StartupAttempt[],
): boolean =>
  left.length === right.length && left.every((attempt, index) => attempt === right[index]);

const buildScopeMatcher = (
  kind: StartupScopeMatcher["kind"],
  fields: {
    repoPath: string | null | undefined;
    workspaceId: string | null | undefined;
    taskId: string | null | undefined;
    role: Extract<StartupScopeMatcher, { kind: "task" }>["role"] | undefined;
    sessionId: string | null | undefined;
    draftId: string | null | undefined;
  },
): StartupScopeMatcher => {
  const matcher: StartupScopeMatcher =
    kind === "task"
      ? { kind: "task", taskId: fields.taskId, role: fields.role ?? null }
      : { kind: "workspace", sessionId: fields.sessionId, draftId: fields.draftId };
  if (fields.repoPath !== undefined) matcher.repoPath = fields.repoPath;
  if (fields.workspaceId !== undefined) matcher.workspaceId = fields.workspaceId;
  return matcher;
};

/** Subscribes only to inline startup attempts matching `scope` while `active` is true. */
export const useInlineStartupAttempts = (
  scope: StartupScopeMatcher,
  active: boolean,
): readonly StartupAttempt[] => {
  const { startupAttempts } = useClientConnection();
  const cachedRef = useRef<readonly StartupAttempt[]>(EMPTY_ATTEMPTS);
  const scopeKind = scope.kind;
  const scopeRepoPath = scope.repoPath;
  const scopeWorkspaceId = scope.workspaceId;
  const scopeTaskId = scope.kind === "task" ? scope.taskId : undefined;
  const scopeRole = scope.kind === "task" ? scope.role : undefined;
  const scopeSessionId = scope.kind === "workspace" ? scope.sessionId : undefined;
  const scopeDraftId = scope.kind === "workspace" ? scope.draftId : undefined;

  const readSnapshot = useCallback((): readonly StartupAttempt[] => {
    if (!active) {
      cachedRef.current = EMPTY_ATTEMPTS;
      return EMPTY_ATTEMPTS;
    }
    const matcher = buildScopeMatcher(scopeKind, {
      repoPath: scopeRepoPath,
      workspaceId: scopeWorkspaceId,
      taskId: scopeTaskId,
      role: scopeRole,
      sessionId: scopeSessionId,
      draftId: scopeDraftId,
    });
    const next = startupAttempts
      .getSnapshot()
      .filter(
        (attempt) => attempt.presentation === "inline" && matchesStartupScope(attempt, matcher),
      );
    if (next.length === 0) {
      cachedRef.current = EMPTY_ATTEMPTS;
      return EMPTY_ATTEMPTS;
    }
    if (arraysShallowEqual(cachedRef.current, next)) {
      return cachedRef.current;
    }
    cachedRef.current = next;
    return next;
  }, [
    active,
    scopeDraftId,
    scopeKind,
    scopeRepoPath,
    scopeRole,
    scopeSessionId,
    scopeTaskId,
    scopeWorkspaceId,
    startupAttempts,
  ]);

  return useSyncExternalStore(startupAttempts.subscribe, readSnapshot, readSnapshot);
};

export type InlineStartupLeaseTarget =
  | { attemptId: string | null | undefined }
  | { scope: StartupScopeMatcher };

/**
 * Holds store-owned inline startup leases for one attempt ID or every inline attempt matching
 * `scope` while `active` is true, optionally pulling background notifications back inline.
 */
export function useInlineStartupLease(
  target: InlineStartupLeaseTarget,
  active: boolean,
  options?: {
    returnFromNotification?: boolean;
    suppressBackground?: () => boolean;
  },
): void {
  const { startupAttempts } = useClientConnection();
  const suppressBackgroundRef = useRef(options?.suppressBackground);
  useLayoutEffect(() => {
    suppressBackgroundRef.current = options?.suppressBackground;
  }, [options?.suppressBackground]);

  const hasScope = "scope" in target;
  const attemptId = hasScope ? null : (target.attemptId ?? null);
  const scopeKind = hasScope ? target.scope.kind : null;
  const scopeRepoPath = hasScope ? target.scope.repoPath : undefined;
  const scopeWorkspaceId = hasScope ? target.scope.workspaceId : undefined;
  const scopeTaskId = hasScope && target.scope.kind === "task" ? target.scope.taskId : undefined;
  const scopeRole = hasScope && target.scope.kind === "task" ? target.scope.role : undefined;
  const scopeSessionId =
    hasScope && target.scope.kind === "workspace" ? target.scope.sessionId : undefined;
  const scopeDraftId =
    hasScope && target.scope.kind === "workspace" ? target.scope.draftId : undefined;
  const returnFromNotification = options?.returnFromNotification ?? false;

  useEffect(() => {
    if (!active) return;
    if (!hasScope) {
      if (!attemptId) return;
      const release = startupAttempts.attachInlineView(attemptId, { returnFromNotification });
      return () => {
        const suppress = suppressBackgroundRef.current?.() ?? false;
        release(suppress ? { suppressBackground: true } : undefined);
      };
    }
    if (!scopeKind) return;
    const matcher = buildScopeMatcher(scopeKind, {
      repoPath: scopeRepoPath,
      workspaceId: scopeWorkspaceId,
      taskId: scopeTaskId,
      role: scopeRole,
      sessionId: scopeSessionId,
      draftId: scopeDraftId,
    });
    const leases = new Map<string, ReturnType<typeof startupAttempts.attachInlineView>>();
    let syncing = false;
    const sync = () => {
      if (syncing) return;
      syncing = true;
      try {
        if (returnFromNotification) {
          const toReturn = startupAttempts
            .getSnapshot()
            .filter(
              (attempt) =>
                attempt.presentation === "notification" && matchesStartupScope(attempt, matcher),
            )
            .map((attempt) => attempt.id);
          for (const id of toReturn) {
            startupAttempts.returnToInline(id);
          }
        }
        const activeIds = new Set<string>();
        for (const attempt of startupAttempts.getSnapshot()) {
          if (attempt.presentation === "inline" && matchesStartupScope(attempt, matcher)) {
            activeIds.add(attempt.id);
            if (!leases.has(attempt.id)) {
              leases.set(attempt.id, startupAttempts.attachInlineView(attempt.id));
            }
          }
        }
        for (const [id, release] of leases.entries()) {
          if (!activeIds.has(id)) {
            leases.delete(id);
            release();
          }
        }
      } finally {
        syncing = false;
      }
    };
    sync();
    const unsubscribe = startupAttempts.subscribe(sync);
    return () => {
      unsubscribe();
      const suppress = suppressBackgroundRef.current?.() ?? false;
      for (const release of leases.values()) {
        release(suppress ? { suppressBackground: true } : undefined);
      }
      leases.clear();
    };
  }, [
    active,
    attemptId,
    hasScope,
    returnFromNotification,
    scopeDraftId,
    scopeKind,
    scopeRepoPath,
    scopeRole,
    scopeSessionId,
    scopeTaskId,
    scopeWorkspaceId,
    startupAttempts,
  ]);
}
