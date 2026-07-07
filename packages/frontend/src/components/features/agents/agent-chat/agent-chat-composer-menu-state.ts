type ComposerMenuClosers = {
  closeSlashMenu: () => void;
  closeReferenceMenu: () => void;
  closeSkillMenu: () => void;
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
