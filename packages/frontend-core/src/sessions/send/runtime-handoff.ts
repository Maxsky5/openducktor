import {
  RUNTIME_DESCRIPTORS_BY_KIND,
  type AgentChatRef,
  type AgentSessionModelSelection,
  type AgentSessionUserMessagePart,
  type HandoffLink,
  type WorkspaceSession,
} from "@openducktor/contracts";
import { findCatalogModel, type AgentModelCatalog } from "@openducktor/core";
import { use, useMemo, useSyncExternalStore } from "react";
import { createStore } from "zustand/vanilla";
import { useClientConnection, useHostClient } from "../../connection/client-connection-react";
import type { ClientConnection } from "../../connection/client-connection";
import { useRuntimeAvailabilityContext } from "../../app-state/app-state-contexts";
import {
  agentSessionIdentityKey,
  matchesAgentSessionIdentity,
} from "../../lib/agent-session-identity";
import { perConnection } from "../../lib/per-connection";
import { useRuntimeModelCatalogs } from "../../queries/use-runtime-model-catalogs";
import type { AgentSessionIdentity, RuntimeHandoffDirection } from "../../types/agent-orchestrator";
import { AgentSessionsContext, useAgentSessionsContext } from "../session-contexts";
import type { AgentSessionsStore } from "../agent-sessions-store";
import { workspaceSessionIdentity } from "../agent-orchestrator/session-read-model/workspace-session-records";
import {
  modelPickerResourceFromCatalogQuery,
  type ModelPickerValue,
} from "../model-selection/model-picker-model";
import {
  type HandoffDeliverySnapshot,
  type HandoffDeliveryState,
  createHandoffDelivery,
  handoffReplyForHost,
  observeHandoffCommit,
  readHandoffDelivery,
} from "./runtime-handoff-delivery";

export type HandoffSelection = {
  model: AgentSessionModelSelection;
  descriptor: AgentModelCatalog["models"][number];
  supportsAttachments: boolean;
};
type HandoffUIState = HandoffDeliveryState & { selection?: HandoffSelection | undefined };

const EMPTY: HandoffUIState = Object.freeze({});
const storeFor = perConnection(() =>
  createStore<ReadonlyMap<string, HandoffUIState>>(() => new Map()),
);
const selectionKey = (repoPath: string, identity: AgentSessionIdentity) =>
  JSON.stringify([repoPath, agentSessionIdentityKey(identity)]);

const useHandoffState = (
  repoPath: string | null,
  identity: AgentSessionIdentity | null,
  followAccepted = false,
) => {
  const connection = useClientConnection();
  const store = storeFor(connection);
  const sessions = use(AgentSessionsContext);
  const readHostEpoch = sessions?.getHandoffHostEpoch ?? noHostEpoch;
  const hostEpoch = useSyncExternalStore(
    sessions?.subscribe ?? noSubscription,
    readHostEpoch,
    readHostEpoch,
  );
  const ownKey = repoPath && identity ? selectionKey(repoPath, identity) : null;
  const readKey = () => {
    if (followAccepted && identity && repoPath) {
      for (const [source, state] of store.getState()) {
        const handoff = handoffReplyForHost(state, hostEpoch)?.response?.handoff;
        if (
          handoff?.chat.repoPath === repoPath &&
          (state.attempt || !handoff.committed) &&
          matchesAgentSessionIdentity(handoff.acceptedLink?.to, identity)
        )
          return source;
      }
    }
    return ownKey;
  };
  const key = useSyncExternalStore(store.subscribe, readKey, readKey);
  const read = () => (key ? (store.getState().get(key) ?? EMPTY) : EMPTY);
  const state = useSyncExternalStore(store.subscribe, read, read);
  const set = (changes: Partial<HandoffUIState>) => {
    if (!key) return;
    store.setState(
      (current) => new Map(current).set(key, { ...current.get(key), ...changes }),
      true,
    );
  };
  const select = (selection: HandoffSelection | undefined) => {
    if (read().attempt) return false;
    set({ selection, reply: undefined, hideSettled: true });
    return true;
  };
  return {
    state,
    hostEpoch,
    set,
    read,
    choose: (model: ModelPickerValue, descriptor: HandoffSelection["descriptor"]) =>
      select({
        model,
        descriptor,
        supportsAttachments:
          RUNTIME_DESCRIPTORS_BY_KIND[model.runtimeKind].capabilities.promptInput
            .supportsAttachments,
      }),
    clear: () => select(undefined),
  };
};

export const useHandoffSelection = (
  repoPath: string | null,
  identity: AgentSessionIdentity | null,
) => {
  const { state, choose, clear } = useHandoffState(repoPath, identity);
  return { selection: state.selection, choose, clear };
};

export const useHandoffModelRuntimes = ({
  repoPath,
  identity,
  open,
}: {
  repoPath: string | null;
  identity: AgentSessionIdentity | null;
  open: boolean;
}) => {
  const { allRuntimeDefinitions, availableRuntimeDefinitions, loadRepoRuntimeCatalog } =
    useRuntimeAvailabilityContext();
  const descriptors = useMemo(
    () =>
      identity
        ? allRuntimeDefinitions.filter((runtime) => runtime.kind !== identity.runtimeKind)
        : [],
    [allRuntimeDefinitions, identity],
  );
  const kinds = useMemo(() => descriptors.map((runtime) => runtime.kind), [descriptors]);
  const enabledKinds = useMemo(
    () =>
      open
        ? kinds.filter((kind) =>
            availableRuntimeDefinitions.some((runtime) => runtime.kind === kind),
          )
        : [],
    [open, availableRuntimeDefinitions, kinds],
  );
  const { resources } = useRuntimeModelCatalogs({
    repoPath,
    workingDirectory: identity?.workingDirectory,
    runtimeKinds: kinds,
    enabledRuntimeKinds: enabledKinds,
    loadRuntimeCatalog: loadRepoRuntimeCatalog,
  });
  const runtimes = descriptors.map((descriptor) => ({
    descriptor,
    isEnabledForFavorites: availableRuntimeDefinitions.some(
      (runtime) => runtime.kind === descriptor.kind,
    ),
    resource: modelPickerResourceFromCatalogQuery(
      resources.find((resource) => resource.runtimeKind === descriptor.kind),
    ),
  }));
  return {
    runtimes,
    find: (value: ModelPickerValue) =>
      findCatalogModel(
        resources.find((resource) => resource.runtimeKind === value.runtimeKind)?.catalog,
        value,
      ),
  };
};

export type RuntimeHandoffNotice = {
  direction: RuntimeHandoffDirection;
  destinationModel: string | undefined;
  title: string;
  details: string;
  check: (() => Promise<void>) | null;
  cancel: (() => boolean) | null;
};

const projectHandoffNotice = (
  delivery: HandoffDeliverySnapshot,
  selection: HandoffSelection | undefined,
  identity: AgentSessionIdentity | null,
) => {
  const { latest, pending, reply } = delivery;
  const destination = latest?.handoff?.destination ?? selection?.model;
  const link = latest?.handoff?.acceptedLink;
  const from = link?.from.runtimeKind ?? identity?.runtimeKind;
  const to = link?.to.runtimeKind ?? destination?.runtimeKind;
  if (!from || !to || (latest?.handoff?.committed && !latest.failure)) return null;
  let title = "Handoff pending";
  if (pending) title = "Sending handoff…";
  else if (reply?.error || latest?.failure) title = "Handoff needs attention";
  const details =
    reply?.error ??
    (latest?.failure
      ? `${latest.failure.message} ${latest.failure.nextAction}`
      : "Sending can share earlier messages and some chat activity.");
  return {
    direction: { from, to },
    destinationModel: selection?.descriptor.modelName ?? destination?.modelId,
    title,
    details,
  } satisfies Omit<RuntimeHandoffNotice, "check" | "cancel">;
};

function useLiveHandoffObservation(identity: AgentSessionIdentity | null) {
  const sessions = use(AgentSessionsContext);
  const read = () => (identity ? sessions?.getHandoffOperation(identity) : undefined);
  return useSyncExternalStore(sessions?.subscribe ?? noSubscription, read, read);
}
const noSubscription = () => () => {};
const noHostEpoch = () => null;

export function useHandoffObservation(
  identity: AgentSessionIdentity | null,
  repoPath: string | null,
) {
  const observed = useLiveHandoffObservation(identity);
  const { state, hostEpoch } = useHandoffState(repoPath, observed?.ref ?? identity, true);
  return readHandoffDelivery(observed, state, hostEpoch).latest;
}

export function subscribeHandoffCommit(
  connection: ClientConnection,
  sessions: AgentSessionsStore,
  repoPath: string,
  source: AgentSessionIdentity,
  onCommit: (link: HandoffLink) => void,
) {
  const store = storeFor(connection);
  const key = selectionKey(repoPath, source);
  return observeHandoffCommit(
    sessions,
    source,
    { read: () => store.getState().get(key) ?? EMPTY, subscribe: store.subscribe },
    onCommit,
  );
}

export const useRuntimeHandoff = (
  chat: AgentChatRef | null,
  identity: AgentSessionIdentity | null,
) => {
  const client = useHostClient();
  const sessions = useAgentSessionsContext();
  const observed = useLiveHandoffObservation(identity);
  const source = observed?.handoff && !observed.handoff.committed ? observed.ref : identity;
  const { state, hostEpoch, read, set, clear } = useHandoffState(
    chat?.repoPath ?? null,
    source,
    true,
  );
  const snapshot = readHandoffDelivery(observed, state, hostEpoch);
  const { latest, blocked, waitingForLocalDraft, pending } = snapshot;
  const committed = latest?.handoff?.committed === true;
  const notice = projectHandoffNotice(
    snapshot,
    state.selection,
    snapshot.reply?.response?.ref ?? observed?.ref ?? source,
  );
  const delivery = createHandoffDelivery({ client, sessions, chat, identity, read, set });
  const releaseLocalDraft = () => {
    const { reply } = read();
    set({
      attempt: undefined,
      selection: undefined,
      reply: reply?.error === undefined ? reply : { ...reply, error: undefined },
    });
  };
  return {
    send: (parts: AgentSessionUserMessagePart[]) => {
      const destination = read().selection?.model;
      return destination ? delivery.send(destination, parts) : Promise.resolve(false);
    },
    enabled: chat !== null && identity !== null,
    repoPath: chat?.repoPath ?? null,
    identity,
    selection: state.selection,
    blocked,
    waitingForLocalDraft,
    releaseLocalDraft,
    acceptedLink: latest?.handoff?.acceptedLink,
    acceptedModel: latest?.handoff?.destination,
    committedLink: committed ? latest?.handoff?.acceptedLink : undefined,
    notice: notice
      ? {
          ...notice,
          check: blocked && !pending ? delivery.check : null,
          cancel: !blocked ? clear : null,
        }
      : null,
  };
};

export function handoffLinksWithAcceptance(
  links: HandoffLink[] | undefined,
  link: HandoffLink | undefined,
) {
  if (!link || links?.some(({ to }) => matchesAgentSessionIdentity(to, link.to))) return links;
  return [...(links ?? []), link];
}

export function projectAcceptedWorkspaceChat(
  record: WorkspaceSession,
  link: HandoffLink | undefined,
  model: AgentSessionModelSelection | undefined,
): WorkspaceSession {
  if (!link || !matchesAgentSessionIdentity(link.from, workspaceSessionIdentity(record)))
    return record;
  return {
    ...record,
    externalSessionId: link.to.externalSessionId,
    runtimeKind: link.to.runtimeKind,
    selectedModel: model ?? record.selectedModel,
    handoff: { links: handoffLinksWithAcceptance(record.handoff?.links, link)! },
  };
}
