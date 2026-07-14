type ComposerMenuClosers = {
  closeSlashMenu: () => void;
  closeReferenceMenu: () => void;
  closeSkillMenu: () => void;
};

type ReferenceMenuVisibilityState = {
  itemCount: number;
  fileSearchError: string | null;
  isFileSearchPending: boolean;
  isFileSearchLoading: boolean;
  subagentsError: string | null;
  isSubagentsLoading: boolean;
};

export const shouldRenderAgentChatComposerReferenceMenu = ({
  itemCount,
  fileSearchError,
  isFileSearchPending,
  isFileSearchLoading,
  subagentsError,
  isSubagentsLoading,
}: ReferenceMenuVisibilityState): boolean => {
  const hasResults = itemCount > 0;
  const showSubagentsLoading = isSubagentsLoading && !hasResults;
  const showFileSearchLoading = isFileSearchLoading && !hasResults;
  const showEmptyState =
    !hasResults &&
    !isFileSearchPending &&
    !isSubagentsLoading &&
    !fileSearchError &&
    !subagentsError;

  return (
    hasResults ||
    showFileSearchLoading ||
    showSubagentsLoading ||
    Boolean(fileSearchError) ||
    Boolean(subagentsError) ||
    showEmptyState
  );
};

export function closeComposerAutocompleteMenus({
  closeSlashMenu,
  closeReferenceMenu,
  closeSkillMenu,
}: ComposerMenuClosers): void {
  closeSlashMenu();
  closeReferenceMenu();
  closeSkillMenu();
}
