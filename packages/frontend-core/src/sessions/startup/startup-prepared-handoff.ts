import type {
  AgentSessionLiveEnvelope,
  AgentSessionLiveRef,
  StartupOperationSnapshot,
  StartupPreparedHandoff,
  RuntimeKind,
} from "@openducktor/contracts";
import { agentSessionRefKey } from "@openducktor/core";
import type { QueryClient } from "@tanstack/react-query";
import type { WorkspaceSessionLiveSource } from "../../workspace-activity/workspace-session-live-source";
import { hostRuntimeStatusQueryKeys } from "../../queries/host-runtime-status";
import type { HostStatusSnapshot } from "../../types/diagnostics";

type RepositoryEvidence = {
  epoch: number;
  ready: Promise<void>;
  stop?: () => void;
  closed: boolean;
  baseline: number;
  present: Map<string, number>;
  targets: Set<string>;
  removed: Map<string, number>;
};
type Receipt = { handoff: StartupPreparedHandoff; epoch: number };
type Owner = {
  source: WorkspaceSessionLiveSource | null;
  repositories: Map<string, RepositoryEvidence>;
  attempts: Map<string, { repoPath: string; epoch: number; runtimes: Map<RuntimeKind, number> }>;
  runtimeEpochs: Map<RuntimeKind, number>;
  runtimeStates: Map<RuntimeKind, { state: string; runtimeId: string | null }>;
  receipts: Map<string, Receipt>;
  listeners: Set<() => void>;
  stopRuntime: () => void;
  released: boolean;
};
const owners = new WeakMap<QueryClient, Owner>();

export function registerStartupLiveSource(
  queryClient: QueryClient,
  source: WorkspaceSessionLiveSource,
): () => void {
  const owner = ownerFor(queryClient);
  owner.source = source;
  return () => {
    if (owner.source === source) releaseStartupPreparations(queryClient);
  };
}

/** Observe the existing repository source before dispatch. This sends no native session command. */
export async function observeStartupPreparation(
  queryClient: QueryClient,
  repoPath: string,
  startupAttemptId: string,
): Promise<void> {
  const owner = ownerFor(queryClient);
  if (!owner.source)
    throw new Error(
      "Session progress is not connected. Reopen the workspace before starting a session.",
    );
  let evidence = owner.repositories.get(repoPath);
  if (!evidence) {
    const entry: RepositoryEvidence = {
      epoch: 0,
      ready: Promise.resolve(),
      closed: false,
      baseline: -1,
      present: new Map(),
      targets: new Set(),
      removed: new Map(),
    };
    owner.repositories.set(repoPath, entry);
    entry.ready = owner.source
      .observeAgentSessionLive({ repoPath }, (envelope) => accept(owner, repoPath, entry, envelope))
      .then((stop) => {
        if (entry.closed || owner.released) stop();
        else entry.stop = stop;
      });
    evidence = entry;
  }
  const existing = owner.attempts.get(startupAttemptId);
  const attempt = existing ?? { repoPath, epoch: 0, runtimes: new Map<RuntimeKind, number>() };
  if (!existing) owner.attempts.set(startupAttemptId, attempt);
  await evidence.ready;
  if (owner.released || evidence.closed || owner.attempts.get(startupAttemptId) !== attempt)
    throw new Error(
      "Session preparation is no longer observed. Inspect the saved session before starting it again.",
    );
  if (!existing) {
    attempt.epoch = evidence.epoch;
    attempt.runtimes = new Map(owner.runtimeEpochs);
  }
}

/** Wait for ordered live evidence, without a second native preparation or a replacement launch. */
export async function adoptStartupPreparedHandoff(
  queryClient: QueryClient,
  snapshot: StartupOperationSnapshot,
): Promise<void> {
  const handoff = snapshot.prepared;
  if (!handoff) return;
  const owner = ownerFor(queryClient);
  const attempt = owner.attempts.get(snapshot.context.startupAttemptId);
  const evidence = owner.repositories.get(snapshot.repoPath);
  if (!attempt || !evidence || owner.released)
    throw new Error(
      "Session preparation is no longer observed. Inspect the saved session before starting it again.",
    );
  const key = agentSessionRefKey(handoff.ref);
  await new Promise<void>((resolve, reject) => {
    const check = () => {
      if (
        owner.released ||
        evidence.closed ||
        owner.attempts.get(snapshot.context.startupAttemptId) !== attempt ||
        attempt.epoch !== evidence.epoch ||
        (attempt.runtimes.get(handoff.ref.runtimeKind) ?? 0) !==
          (owner.runtimeEpochs.get(handoff.ref.runtimeKind) ?? 0) ||
        (evidence.removed.get(key) ?? -1) >= handoff.liveStateSequence ||
        (evidence.baseline >= handoff.liveStateSequence && !evidence.targets.has(key))
      ) {
        owner.listeners.delete(check);
        reject(
          new Error(
            "Session preparation could not be confirmed. Inspect the saved session before starting it again.",
          ),
        );
      } else if (isCovered(evidence, handoff)) {
        owner.listeners.delete(check);
        const status = queryClient.getQueryData<HostStatusSnapshot>(
          hostRuntimeStatusQueryKeys.snapshot,
        );
        const runtime = status?.runtimes.find((item) => item.kind === handoff.ref.runtimeKind);
        if (
          (status && status.hostInstanceId !== snapshot.hostInstanceId) ||
          (runtime && (runtime.state !== "ready" || runtime.runtimeId !== handoff.runtimeId))
        ) {
          reject(
            new Error("The session runtime changed during startup. Inspect the saved session."),
          );
          return;
        }
        owner.receipts.set(key, { handoff, epoch: evidence.epoch });
        resolve();
        notify(owner);
      }
    };
    owner.listeners.add(check);
    check();
  });
}

export function hasStartupPreparedHandoff(
  queryClient: QueryClient,
  ref: AgentSessionLiveRef | null,
): boolean {
  if (!ref) return false;
  const owner = owners.get(queryClient);
  const receipt = owner?.receipts.get(agentSessionRefKey(ref));
  const evidence = owner?.repositories.get(ref.repoPath);
  return (
    receipt !== undefined &&
    evidence !== undefined &&
    receipt.epoch === evidence.epoch &&
    isCovered(evidence, receipt.handoff)
  );
}

export function isStartupPreparedHandoffCurrent(
  queryClient: QueryClient,
  startupAttemptId: string,
  handoff: StartupPreparedHandoff,
): boolean {
  const owner = owners.get(queryClient);
  const attempt = owner?.attempts.get(startupAttemptId);
  const evidence = owner?.repositories.get(handoff.ref.repoPath);
  const receipt = owner?.receipts.get(agentSessionRefKey(handoff.ref));
  if (!owner || !attempt || !evidence || !receipt) return false;
  return (
    attempt.repoPath === handoff.ref.repoPath &&
    attempt.epoch === evidence.epoch &&
    receipt.epoch === evidence.epoch &&
    (attempt.runtimes.get(handoff.ref.runtimeKind) ?? 0) ===
      (owner.runtimeEpochs.get(handoff.ref.runtimeKind) ?? 0) &&
    receipt.handoff.runtimeId === handoff.runtimeId &&
    isCovered(evidence, handoff)
  );
}

export function subscribeStartupPreparations(
  queryClient: QueryClient,
  listener: () => void,
): () => void {
  const owner = ownerFor(queryClient);
  owner.listeners.add(listener);
  return () => {
    owner.listeners.delete(listener);
  };
}

export function releaseStartupPreparationAttempt(
  queryClient: QueryClient,
  startupAttemptId: string,
): void {
  const owner = owners.get(queryClient);
  if (!owner) return;
  owner.attempts.delete(startupAttemptId);
  notify(owner);
}

export function retainStartupPreparationWorkspaces(
  queryClient: QueryClient,
  repoPaths: readonly string[],
): void {
  const owner = owners.get(queryClient);
  if (!owner) return;
  const retained = new Set(repoPaths);
  for (const [repoPath, evidence] of owner.repositories) {
    if (retained.has(repoPath)) continue;
    evidence.closed = true;
    evidence.stop?.();
    owner.repositories.delete(repoPath);
    for (const [key, receipt] of owner.receipts)
      if (receipt.handoff.ref.repoPath === repoPath) owner.receipts.delete(key);
  }
  notify(owner);
}

export function releaseStartupPreparations(queryClient: QueryClient): void {
  const owner = owners.get(queryClient);
  if (!owner) return;
  owner.released = true;
  owner.stopRuntime();
  for (const evidence of owner.repositories.values()) {
    evidence.closed = true;
    evidence.stop?.();
  }
  owner.receipts.clear();
  owner.attempts.clear();
  notify(owner);
  owner.listeners.clear();
  owners.delete(queryClient);
}

function ownerFor(queryClient: QueryClient): Owner {
  const owner = owners.get(queryClient);
  if (owner) return owner;
  const entry: Owner = {
    source: null,
    repositories: new Map(),
    attempts: new Map(),
    runtimeEpochs: new Map(),
    runtimeStates: new Map(),
    receipts: new Map(),
    listeners: new Set(),
    stopRuntime: () => {},
    released: false,
  };
  entry.stopRuntime = queryClient.getQueryCache().subscribe(() => {
    const status = queryClient.getQueryData<HostStatusSnapshot>(
      hostRuntimeStatusQueryKeys.snapshot,
    );
    if (!status) return;
    const runtimes = new Map(status.runtimes.map((runtime) => [runtime.kind, runtime]));
    let changed = false;
    for (const runtime of status.runtimes) {
      const previous = entry.runtimeStates.get(runtime.kind);
      if (
        previous &&
        (previous.runtimeId !== runtime.runtimeId ||
          (previous.state === "ready" && runtime.state !== "ready"))
      ) {
        entry.runtimeEpochs.set(runtime.kind, (entry.runtimeEpochs.get(runtime.kind) ?? 0) + 1);
        changed = true;
      }
      entry.runtimeStates.set(runtime.kind, runtime);
    }
    for (const [key, receipt] of entry.receipts) {
      const runtime = runtimes.get(receipt.handoff.ref.runtimeKind);
      if (
        runtime &&
        (runtime.state !== "ready" || runtime.runtimeId !== receipt.handoff.runtimeId)
      ) {
        entry.receipts.delete(key);
        changed = true;
      }
    }
    if (changed) notify(entry);
  });
  owners.set(queryClient, entry);
  return entry;
}

function notify(owner: Owner): void {
  for (const listener of Array.from(owner.listeners)) listener();
}

function accept(
  owner: Owner,
  repoPath: string,
  evidence: RepositoryEvidence,
  envelope: AgentSessionLiveEnvelope,
): void {
  if (owner.released || evidence.closed) return;
  if (envelope.type === "snapshot") {
    if (envelope.historyReplayGap) {
      evidence.epoch += 1;
      for (const [key, receipt] of owner.receipts)
        if (receipt.handoff.ref.repoPath === repoPath) owner.receipts.delete(key);
    }
    if (envelope.sequence !== undefined) {
      evidence.baseline = envelope.sequence;
      const present = new Map<string, number>();
      const targets = new Set<string>();
      for (const session of envelope.sessions) {
        const key = agentSessionRefKey(session.ref);
        targets.add(key);
        const sequence = session.statusUnavailableReason
          ? evidence.present.get(key)
          : envelope.sequence;
        if (sequence !== undefined) present.set(key, sequence);
      }
      for (const key of evidence.targets)
        if (!targets.has(key)) evidence.removed.set(key, envelope.sequence);
      evidence.present = present;
      evidence.targets = targets;
    }
  } else if (envelope.type === "session_removed") {
    const key = agentSessionRefKey(envelope.ref);
    evidence.present.delete(key);
    evidence.targets.delete(key);
    evidence.removed.set(key, envelope.sequence ?? evidence.baseline);
    owner.receipts.delete(key);
  } else if (
    envelope.type === "session_upsert" ||
    envelope.type === "task_session_records_updated"
  ) {
    const session = envelope.type === "session_upsert" ? envelope.session : envelope.liveSession;
    if (session && envelope.sequence !== undefined) {
      const key = agentSessionRefKey(session.ref);
      evidence.targets.add(key);
      if (!session.statusUnavailableReason) evidence.present.set(key, envelope.sequence);
    }
  }
  for (const [key, receipt] of owner.receipts)
    if (receipt.handoff.ref.repoPath === repoPath && !isCovered(evidence, receipt.handoff))
      owner.receipts.delete(key);
  notify(owner);
}

function isCovered(evidence: RepositoryEvidence, handoff: StartupPreparedHandoff): boolean {
  const key = agentSessionRefKey(handoff.ref);
  return (
    !evidence.closed &&
    (evidence.removed.get(key) ?? -1) < handoff.liveStateSequence &&
    (evidence.present.get(key) ?? -1) >= handoff.liveStateSequence
  );
}
