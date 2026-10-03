import type {
  AzureDevOpsConnectionState,
  WorkspaceProviderSetupSession,
  WorkspaceProviderSetupDetection,
  WorkspaceProviderSetupGithub,
} from "@openducktor/contracts";
import { azureDevOpsConnectionConfigurationFingerprint } from "@openducktor/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { hostBridge } from "@/lib/host-client";
import { errorMessage } from "@/lib/errors";
import {
  setupDetectionOptions,
  setupStatusOptions,
  setupStatusObserverOptions,
  setupGithubOptions,
  setupAreasOptions,
  setupProgressOptions,
  workspaceProviderSetupKeys,
} from "@/state/queries/workspace-provider-setup";
import {
  detectedWorkspaceProviderDraft,
  emptyWorkspaceProviderDraft,
  parseWorkspaceProviderDraft,
  httpConsentUrl,
  type WorkspaceProviderDraft,
} from "./workspace-provider-draft";

type Operation = { label: string; signInStartup: boolean };

/** Owns the unsaved draft and keeps its host setup until cleanup succeeds. */
export function useWorkspaceProviderSetup(bridge = hostBridge) {
  const queryClient = useQueryClient();
  const client = bridge.client;
  const [session, setSession] = useState<WorkspaceProviderSetupSession | null>(null);
  const sessionRef = useRef(session);
  const [draft, setDraft] = useState(emptyWorkspaceProviderDraft);
  const draftRef = useRef(draft);
  const version = useRef(0);
  const edited = useRef(false);
  const [operation, setOperation] = useState<Operation | null>(null);
  const actionLock = useRef<Operation | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const cancellationLock = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [detectionError, setDetectionError] = useState<string | null>(null);
  const [detection, setDetection] = useState<WorkspaceProviderSetupDetection | null>(null);
  const [detectionProposal, setDetectionProposal] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const statusQuery = useQuery(setupStatusObserverOptions(client, session));
  const [github, setGithub] = useState<WorkspaceProviderSetupGithub | null>(null);
  const [areas, setAreas] = useState<string[]>([]);
  const [connection, setConnection] = useState<AzureDevOpsConnectionState>({
    status: "disconnected",
  });
  const [pat, setPat] = useState("");
  const unsubscribe = useRef<(() => void) | null>(null);
  const attempt = useRef<{
    id: string | null;
    early: Map<string, AzureDevOpsConnectionState>;
  } | null>(null);
  const accepted = useRef<string | null>(null);
  const mounted = useRef(true);
  const clearStatus = () => {
    const current = sessionRef.current;
    if (current)
      void queryClient.resetQueries({
        queryKey: setupStatusOptions(client, current).queryKey,
        exact: true,
      });
  };
  const applySession = (next: WorkspaceProviderSetupSession | null) => {
    sessionRef.current = next;
    setSession(next);
  };
  const update = (updater: (current: WorkspaceProviderDraft) => WorkspaceProviderDraft) => {
    edited.current = true;
    setDetectionProposal(detection?.outcome === "detected");
    const before = draftRef.current;
    let next = updater(before);
    if (
      next.azure.project !== before.azure.project ||
      next.azure.organization !== before.azure.organization ||
      next.azure.serviceUrl !== before.azure.serviceUrl ||
      next.azure.deployment !== before.azure.deployment
    ) {
      next = { ...next, areaPath: "" };
      setAreas([]);
    }
    if (httpConsentUrl(next) !== httpConsentUrl(before)) next = { ...next, consent: null };
    if (next.providerId !== before.providerId) {
      next = { ...next, enabled: true, autoDetected: false };
    }
    if (
      JSON.stringify(next.github) !== JSON.stringify(before.github) ||
      JSON.stringify(next.azure) !== JSON.stringify(before.azure)
    )
      next = { ...next, autoDetected: false };
    draftRef.current = next;
    version.current += 1;
    setDraft(next);
    clearStatus();
    setGithub(null);
    setError(null);
    const connectionChanged =
      next.providerId !== before.providerId ||
      next.enabled !== before.enabled ||
      JSON.stringify(next.azure) !== JSON.stringify(before.azure);
    if (connectionChanged) {
      stopListening();
      setPat("");
      setConnection({ status: "disconnected" });
    }
    if (attempt.current) {
      stopListening();
      if (connection.status === "pending") setConnection({ status: "disconnected" });
    }
    void run("Update provider configuration", async () => {
      await sendSelection(parseWorkspaceProviderDraft(next).selection);
    });
  };
  const sendSelection = async (
    selection = parseWorkspaceProviderDraft(draftRef.current).selection,
  ) => {
    const current = sessionRef.current;
    if (!current) throw new Error("Choose the repository again to start provider setup.");
    const key = JSON.stringify(selection);
    if (accepted.current === key) return current;
    try {
      const next = await client.workspaceProviderSetupSet({
        setupId: current.setupId,
        revision: current.revision,
        selection,
      });
      applySession(next);
      accepted.current = key;
      return next;
    } catch (cause) {
      // The host can accept the selection before its reply is lost.
      accepted.current = null;
      throw cause;
    }
  };
  const run = async <T>(
    label: string,
    action: (owner: Operation) => Promise<T>,
    { keepError = false }: { keepError?: boolean } = {},
  ): Promise<T | undefined> => {
    if (actionLock.current || cancellationLock.current) return undefined;
    const owner = { label, signInStartup: false };
    actionLock.current = owner;
    setOperation(owner);
    if (!keepError) setError(null);
    try {
      return await action(owner);
    } catch (cause) {
      if (actionLock.current === owner && !cancellationLock.current)
        setError(`${label} failed: ${errorMessage(cause)}`);
      return undefined;
    } finally {
      // A cancelled startup can finish after the next action starts.
      if (actionLock.current === owner) {
        actionLock.current = null;
        if (mounted.current) setOperation(null);
      }
    }
  };
  const readStatus = async (ref: WorkspaceProviderSetupSession) => {
    const result = await queryClient.fetchQuery(setupStatusOptions(client, ref));
    if (
      sessionRef.current?.setupId === ref.setupId &&
      sessionRef.current.revision === ref.revision
    ) {
      if (result.connection) setConnection(result.connection);
    }
    return result;
  };
  const retryDetection = async () => {
    const current = sessionRef.current;
    if (!current) return;
    const localVersion = version.current;
    setDetecting(true);
    setDetectionError(null);
    try {
      const result = await queryClient.fetchQuery(setupDetectionOptions(client, current));
      if (sessionRef.current?.setupId !== current.setupId) return;
      setDetection(result);
      if (
        !edited.current &&
        localVersion === version.current &&
        result.outcome === "detected" &&
        result.candidates[0]
      ) {
        const next = detectedWorkspaceProviderDraft(result.candidates[0].config);
        draftRef.current = next;
        setDraft(next);
        accepted.current = null;
        setDetectionProposal(false);
      } else {
        setDetectionProposal(result.outcome === "detected");
      }
    } catch (cause) {
      if (sessionRef.current?.setupId === current.setupId)
        setDetectionError(`Detection failed: ${errorMessage(cause)}`);
    } finally {
      if (sessionRef.current?.setupId === current.setupId) setDetecting(false);
    }
  };
  const acceptDetection = () =>
    run("Use detected repository", async () => {
      const candidate = detection?.outcome === "detected" ? detection.candidates[0] : null;
      if (!candidate) return;
      const next = {
        ...detectedWorkspaceProviderDraft(candidate.config),
        enabled: draftRef.current.enabled,
      };
      await sendSelection(parseWorkspaceProviderDraft(next).selection);
      stopListening();
      setPat("");
      setConnection({ status: "disconnected" });
      clearStatus();
      setGithub(null);
      setAreas([]);
      edited.current = true;
      version.current += 1;
      draftRef.current = next;
      setDraft(next);
      setDetectionProposal(false);
    });
  const stopListening = () => {
    unsubscribe.current?.();
    unsubscribe.current = null;
    attempt.current = null;
  };
  const discard = async (): Promise<boolean> => {
    if (cancellationLock.current || (actionLock.current && !actionLock.current.signInStartup))
      return false;
    cancellationLock.current = true;
    setIsCancelling(true);
    setError(null);
    try {
      version.current += 1;
      const current = sessionRef.current;
      if (current) {
        await client.workspaceProviderSetupDiscard({ setupId: current.setupId });
        queryClient.removeQueries({
          queryKey: workspaceProviderSetupKeys.session(current.setupId),
        });
      }
      stopListening();
      actionLock.current = null;
      setOperation(null);
      applySession(null);
      accepted.current = null;
      setPat("");
      setConnection({ status: "disconnected" });
      return true;
    } catch (cause) {
      setError(`Cancel provider setup failed: ${errorMessage(cause)}`);
      return false;
    } finally {
      cancellationLock.current = false;
      if (mounted.current) setIsCancelling(false);
    }
  };
  const begin = async (repoPath: string) => {
    if (sessionRef.current?.repoPath === repoPath) return sessionRef.current;
    if (sessionRef.current && !(await discard()))
      throw new Error("Retry provider setup cleanup before selecting another repository.");
    const next = await client.workspaceProviderSetupBegin({ repoPath });
    if (!mounted.current) {
      await client.workspaceProviderSetupDiscard({ setupId: next.setupId });
      throw new Error("Workspace setup was cancelled.");
    }
    applySession(next);
    version.current += 1;
    edited.current = false;
    accepted.current = JSON.stringify({ kind: "none" });
    const empty = emptyWorkspaceProviderDraft();
    draftRef.current = empty;
    setDraft(empty);
    setDetection(null);
    setDetectionProposal(false);
    setDetectionError(null);
    setError(null);
    clearStatus();
    setGithub(null);
    setAreas([]);
    setConnection({ status: "disconnected" });
    void retryDetection();
    return next;
  };
  const ensureSelection = () => {
    const parsed = parseWorkspaceProviderDraft(draftRef.current);
    // Accept incomplete input first so the host cannot retain a stale valid snapshot.
    return sendSelection(parsed.selection).then((current) => {
      if (parsed.selection.kind === "incomplete")
        throw new Error("Correct the provider fields or skip setup.");
      return current;
    });
  };
  const check = () =>
    run("Check provider readiness", async () => {
      const current = await ensureSelection();
      const result = await readStatus(current);
      const selection = parseWorkspaceProviderDraft(draftRef.current).selection;
      if (selection.kind === "configured" && selection.config.enabled && !result.health?.available)
        throw new Error(result.health?.reason ?? "The provider is not ready.");
      return true;
    });
  const skip = () =>
    run("Skip Git provider setup", async () => {
      edited.current = true;
      await sendSelection({ kind: "none" });
      stopListening();
      setPat("");
      setConnection({ status: "disconnected" });
      const next = { ...draftRef.current, providerId: null, autoDetected: false };
      draftRef.current = next;
      setDraft(next);
      version.current += 1;
      return true;
    });
  const startSignIn = () =>
    run("Microsoft sign-in", async (owner) => {
      const current = await ensureSelection();
      const selection = parseWorkspaceProviderDraft(draftRef.current).selection;
      const repository = selection.kind === "configured" ? selection.config.repository : undefined;
      if (!repository || !("deployment" in repository))
        throw new Error("Complete the Azure DevOps repository first.");
      clearStatus();
      stopListening();
      const owned: NonNullable<typeof attempt.current> = {
        id: null,
        early: new Map<string, AzureDevOpsConnectionState>(),
      };
      attempt.current = owned;
      const fingerprint = azureDevOpsConnectionConfigurationFingerprint(
        current.setupId,
        current.repoPath,
        repository,
      );
      // Events can arrive before the host returns the sign-in attempt ID.
      const stop = await bridge.subscribeWorkspaceProviderSetupUpdates((event) => {
        if (
          attempt.current !== owned ||
          sessionRef.current?.setupId !== event.setupId ||
          event.repoPath !== current.repoPath ||
          event.revision !== current.revision ||
          event.configurationFingerprint !== fingerprint
        )
          return;
        if (!owned.id) {
          owned.early.set(event.attemptId, event.state);
          return;
        }
        if (owned.id === event.attemptId) {
          setConnection(event.state);
          clearStatus();
        }
      });
      if (!mounted.current || attempt.current !== owned) {
        stop();
        return;
      }
      unsubscribe.current = stop;
      owner.signInStartup = true;
      setOperation({ ...owner });
      const code = await client.workspaceProviderSetupSignIn(current);
      if (attempt.current !== owned || sessionRef.current?.setupId !== current.setupId) return;
      owned.id = code.attemptId;
      setConnection(owned.early.get(code.attemptId) ?? { status: "pending", deviceCode: code });
      owned.early.clear();
    });
  const cancelSignIn = () =>
    run("Cancel Microsoft sign-in", async () => {
      const current = sessionRef.current;
      const id =
        attempt.current?.id ??
        (connection.status === "pending" ? connection.deviceCode.attemptId : null);
      if (current && id)
        await client.workspaceProviderSetupCancelSignIn({
          setupId: current.setupId,
          revision: current.revision,
          attemptId: id,
        });
      clearStatus();
      stopListening();
      setConnection({ status: "disconnected" });
    });
  const savePat = () =>
    run("Validate PAT", async () => {
      const current = await ensureSelection();
      const result = await client.workspaceProviderSetupPat({
        setupId: current.setupId,
        revision: current.revision,
        pat,
      });
      setPat("");
      stopListening();
      setConnection(result);
      clearStatus();
    });
  const disconnect = () =>
    run("Disconnect setup connection", async () => {
      const current = await sendSelection();
      await client.workspaceProviderSetupDisconnect(current);
      stopListening();
      setConnection({ status: "disconnected" });
      clearStatus();
      setPat("");
    });
  const inspectGithub = () =>
    run("Check GitHub CLI", async () => {
      const current = await sendSelection();
      const result = await queryClient.fetchQuery(
        setupGithubOptions(client, current, draftRef.current.github.host.trim()),
      );
      setGithub(result);
    });
  const loadAreas = () =>
    run("Load work item areas", async () => {
      const current = await ensureSelection();
      setAreas(
        await queryClient.fetchQuery(
          setupAreasOptions(client, current, draftRef.current.azure.project),
        ),
      );
    });
  const recover = () =>
    run(
      "Read setup state",
      async () => {
        const current = sessionRef.current;
        if (!current) throw new Error("Workspace setup is unavailable.");
        const value = await queryClient.fetchQuery(setupProgressOptions(client, current));
        if (!mounted.current || sessionRef.current?.setupId !== current.setupId) return;
        clearStatus();
        applySession(value);
        accepted.current = JSON.stringify(value.selection);
        setError(null);
        return value;
      },
      { keepError: true },
    );
  const complete = () => {
    stopListening();
    const current = sessionRef.current;
    if (current)
      queryClient.removeQueries({ queryKey: workspaceProviderSetupKeys.session(current.setupId) });
    applySession(null);
    setPat("");
  };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stopListening();
      const current = sessionRef.current;
      if (current)
        void client
          .workspaceProviderSetupDiscard({ setupId: current.setupId })
          .catch((cause) =>
            console.error("Workspace provider setup cleanup failed", errorMessage(cause)),
          );
    };
  }, [client]);
  return {
    session,
    draft,
    update,
    pending: isCancelling ? "Cancel provider setup" : (operation?.label ?? null),
    isStartingSignIn: operation?.signInStartup ?? false,
    isCancelling,
    error,
    detecting,
    detection,
    detectionProposal,
    detectionError,
    retryDetection,
    acceptDetection,
    status:
      operation || isCancelling || error || statusQuery.isFetching || statusQuery.isError
        ? null
        : (statusQuery.data ?? null),
    github,
    areas,
    connection,
    pat,
    setPat,
    begin,
    discard,
    check,
    skip,
    startSignIn,
    cancelSignIn,
    savePat,
    disconnect,
    inspectGithub,
    loadAreas,
    ensureSelection,
    recover,
    complete,
    errors: parseWorkspaceProviderDraft(draft).errors,
  };
}
export type WorkspaceProviderSetupController = ReturnType<typeof useWorkspaceProviderSetup>;
