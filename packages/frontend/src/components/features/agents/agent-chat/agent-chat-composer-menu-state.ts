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

type ReferenceMenuVisibility = {
  hasResults: boolean;
  showSubagentsLoading: boolean;
  showFileSearchLoading: boolean;
  showEmptyState: boolean;
  shouldRenderMenu: boolean;
};

export const getComposerPopupOptionId = (listboxId: string, index: number): string => {
  return `${listboxId}-option-${index}`;
};

export const resolveAgentChatComposerReferenceMenuVisibility = ({
  itemCount,
  fileSearchError,
  isFileSearchPending,
  isFileSearchLoading,
  subagentsError,
  isSubagentsLoading,
}: ReferenceMenuVisibilityState): ReferenceMenuVisibility => {
  const hasResults = itemCount > 0;
  const showSubagentsLoading = isSubagentsLoading && !hasResults;
  const showFileSearchLoading = isFileSearchLoading && !hasResults;
  const showEmptyState =
    !hasResults &&
    !isFileSearchPending &&
    !isSubagentsLoading &&
    !fileSearchError &&
    !subagentsError;

  const shouldRenderMenu =
    hasResults ||
    showFileSearchLoading ||
    showSubagentsLoading ||
    Boolean(fileSearchError) ||
    Boolean(subagentsError) ||
    showEmptyState;

  return {
    hasResults,
    showSubagentsLoading,
    showFileSearchLoading,
    showEmptyState,
    shouldRenderMenu,
  };
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
