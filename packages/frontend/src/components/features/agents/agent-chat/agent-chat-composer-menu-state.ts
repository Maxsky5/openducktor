type ComposerMenuClosers = {
  closeSlashMenu: () => void;
  closeFileMenu: () => void;
  closeSkillMenu: () => void;
};

export function closeComposerAutocompleteMenus({
  closeSlashMenu,
  closeFileMenu,
  closeSkillMenu,
}: ComposerMenuClosers): void {
  closeSlashMenu();
  closeFileMenu();
  closeSkillMenu();
}
