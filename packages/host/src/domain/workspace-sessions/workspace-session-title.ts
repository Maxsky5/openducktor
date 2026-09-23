import {
  WORKSPACE_SESSION_GENERATED_TITLE_LIMIT,
  type AcceptedAgentUserMessage,
  type WorkspaceSession,
} from "@openducktor/contracts";

export const runtimeTitle = (
  session: Pick<WorkspaceSession, "generatedTitle" | "manualTitle">,
): string | null => chooseTitle(session.manualTitle, session.generatedTitle);

export const runtimeTitleWithManualTitle = (
  session: Pick<WorkspaceSession, "generatedTitle">,
  manualTitle: string | null,
): string | null => chooseTitle(manualTitle, session.generatedTitle);

/**
 * Plans the runtime rename for a Workspace Session title change.
 * Returns null when the title stays the same or the session is not bound to a runtime session.
 */
export const planRuntimeTitleRename = (
  session: Pick<WorkspaceSession, "externalSessionId" | "generatedTitle" | "manualTitle">,
  nextTitle: string | null,
): { externalSessionId: string; title: string } | null =>
  session.externalSessionId !== null && nextTitle !== null && nextTitle !== runtimeTitle(session)
    ? { externalSessionId: session.externalSessionId, title: nextTitle }
    : null;

export const buildWorkspaceSessionTitle = (message: AcceptedAgentUserMessage): string | null => {
  const text = message.parts
    .map((part) => {
      switch (part.kind) {
        case "text":
          return part.synthetic ? "" : part.text;
        case "file_reference":
          return part.file.name;
        case "skill_mention":
          return part.skill.name;
        case "subagent_reference":
          return part.subagent.name;
        case "attachment":
          return part.attachment.name;
      }
    })
    .join(" ")
    .trim()
    .replace(/\s+/g, " ");
  if (!text) return null;
  if (text.length <= WORKSPACE_SESSION_GENERATED_TITLE_LIMIT) return text;
  let prefix = "";
  for (const character of text) {
    if (prefix.length + character.length >= WORKSPACE_SESSION_GENERATED_TITLE_LIMIT) break;
    prefix += character;
  }
  const lastSpace = prefix.lastIndexOf(" ");
  if (lastSpace > 0 && text[prefix.length] !== " ") prefix = prefix.slice(0, lastSpace);
  return `${prefix.trimEnd()}…`;
};

const chooseTitle = (manualTitle: string | null, generatedTitle: string | null): string | null => {
  const title = manualTitle?.trim() || generatedTitle;
  return title ? title : null;
};
