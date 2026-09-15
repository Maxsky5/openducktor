const TASK_DESCRIPTION_PREVIEW_MAX_CHARACTERS = 480;

export const buildTaskDescriptionPreviewMarkdown = (description: string): string => {
  if (description.length <= TASK_DESCRIPTION_PREVIEW_MAX_CHARACTERS) {
    return description;
  }
  return description.slice(0, TASK_DESCRIPTION_PREVIEW_MAX_CHARACTERS);
};
