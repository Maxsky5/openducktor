import {
  WORKSPACE_SESSION_GENERATED_TITLE_LIMIT,
  type AcceptedAgentUserMessage,
  type WorkspaceSession,
} from "@openducktor/contracts";

const effectiveRuntimeTitle = (
  manualTitle: string | null,
  generatedTitle: string | null,
): string | null => {
  const title = manualTitle?.trim() || generatedTitle;
  return title ? title : null;
};

export const runtimeTitle = (
  session: Pick<WorkspaceSession, "generatedTitle" | "manualTitle">,
): string | null => effectiveRuntimeTitle(session.manualTitle, session.generatedTitle);

export const runtimeTitleWithManualTitle = (
  session: Pick<WorkspaceSession, "generatedTitle">,
  manualTitle: string | null,
): string | null => effectiveRuntimeTitle(manualTitle, session.generatedTitle);

/**
 * Plans the native rename for a Workspace Session title change.
 * Returns null when the session has no native session or the title does not change.
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
