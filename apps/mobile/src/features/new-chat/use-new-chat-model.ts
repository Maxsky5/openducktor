import type { AgentModelFavorite } from "@openducktor/contracts";
import type { AgentModelSelection } from "@openducktor/core";
import { useWorkspaceSessionCreateModel } from "@openducktor/frontend-core/workspace-sessions/create/use-workspace-session-create-model";
import { useModelFavorites } from "@/features/model-picker/use-model-favorites";
import { type NewChatModelState, newChatModelState } from "./new-chat-request";

export type NewChatModel = ReturnType<typeof useWorkspaceSessionCreateModel> & {
  /** What the model allows: Create sends the chat only for a ready model. */
  state: NewChatModelState;
  /** The favorite models of the host, which the model picker shows first. */
  favorites: AgentModelFavorite[] | null;
};

/**
 * The model of a new chat, as the desktop new chat dialog, with the state that decides if Create
 * can send the chat.
 */
export function useNewChatModel(
  repoPath: string,
  defaultSelection: AgentModelSelection | null,
  /** The read of the repository settings, which hold the Default Model. */
  repoSettings: { pending: boolean; error: string | null },
): NewChatModel {
  const { favorites } = useModelFavorites();
  const model = useWorkspaceSessionCreateModel(repoPath, defaultSelection);
  // Until the Default Model is checked against its catalog, the state reads that catalog.
  const runtimeKind = model.runtimeKind ?? defaultSelection?.runtimeKind ?? null;
  const state = newChatModelState({
    selection: model.selection,
    defaultSelection,
    repoSettings,
    runtimeKind,
    runtimeKinds: model.runtimeKinds,
    resource: model.resources.find((entry) => entry.runtimeKind === runtimeKind) ?? null,
    selectedModelFound: model.selectedModelEntry !== null,
  });
  return { ...model, state, favorites };
}
