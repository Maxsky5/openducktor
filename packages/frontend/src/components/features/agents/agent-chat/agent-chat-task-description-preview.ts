const TASK_DESCRIPTION_PREVIEW_MAX_CHARACTERS = 480;

export const buildTaskDescriptionPreviewMarkdown = (description: string): string => {
  if (description.length <= TASK_DESCRIPTION_PREVIEW_MAX_CHARACTERS) {
    return description;
  }

  const bounded = description.slice(0, TASK_DESCRIPTION_PREVIEW_MAX_CHARACTERS);
  const lastLineBreak = bounded.lastIndexOf("\n");
  return lastLineBreak > 0 ? bounded.slice(0, lastLineBreak) : bounded;
};
