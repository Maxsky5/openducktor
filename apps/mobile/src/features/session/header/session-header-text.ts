import { RUNTIME_DESCRIPTORS_BY_KIND, type RuntimeKind } from "@openducktor/contracts";
import type { AgentModelCatalog, AgentModelSelection } from "@openducktor/core";
import { agentModelInfoParts } from "@openducktor/frontend-core/lib/agent-model-presentation";
import { workspaceSessionTitle } from "@openducktor/frontend-core/sessions/agent-orchestrator/session-read-model/workspace-session-records";
import { BUILTIN_ROLE_LABELS } from "@openducktor/workflows";
import type { SessionOwner } from "../session-target";

/** The title of the session header, its details, and what a screen reader hears. */
export type SessionHeaderText = {
  title: string;
  /** The role, the runtime, and the model. The menu shows them as its title. */
  details: string[];
  accessibilityLabel: string;
};

const ownerKindLabel = (owner: SessionOwner, readOnly: boolean): string => {
  if (owner.kind === "task") return "Task session";
  if (owner.kind === "chat") return "Chat";
  return readOnly ? "Subagent session, read only" : "Session";
};

/** The role of the session, or the kind of session when it has no role. */
const roleLabel = (owner: SessionOwner, readOnly: boolean): string | null => {
  if (owner.kind === "task") return BUILTIN_ROLE_LABELS[owner.role];
  if (owner.kind === "chat") return owner.record.roleSnapshot?.name ?? "Chat";
  return readOnly ? "Read only" : null;
};

/** A chat shows its name, and a task session the task title once the task loads. */
const headerTitle = (
  owner: SessionOwner,
  readOnly: boolean,
  sessionTitle: string | null,
  taskTitle: string | null,
): string => {
  if (owner.kind === "chat") return workspaceSessionTitle(owner.record);
  if (owner.kind === "task" && taskTitle) return taskTitle;
  return sessionTitle ?? (readOnly ? "Subagent activity" : "Session");
};

export const sessionHeaderText = ({
  owner,
  readOnly,
  sessionTitle,
  taskTitle,
  runtimeKind,
  selectedModel,
  modelCatalog,
}: {
  owner: SessionOwner;
  readOnly: boolean;
  /** The title of the session, or null before it has one. */
  sessionTitle: string | null;
  /** The title of the task of a task session, or null while it loads. */
  taskTitle: string | null;
  runtimeKind: RuntimeKind;
  selectedModel: AgentModelSelection | null;
  modelCatalog: AgentModelCatalog | null;
}): SessionHeaderText => {
  const title = headerTitle(owner, readOnly, sessionTitle, taskTitle);
  const modelLabel = selectedModel
    ? agentModelInfoParts(selectedModel, modelCatalog).join(" · ") || null
    : null;
  const details = [
    roleLabel(owner, readOnly),
    RUNTIME_DESCRIPTORS_BY_KIND[runtimeKind].label,
    modelLabel,
  ].filter((part) => part !== null);
  return {
    title,
    details,
    accessibilityLabel: [title, ownerKindLabel(owner, readOnly), ...details].join(", "),
  };
};
