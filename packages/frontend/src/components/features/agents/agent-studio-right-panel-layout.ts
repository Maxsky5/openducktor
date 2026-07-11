export const shouldUseExpandedDevServerLayout = ({
  devServerIsExpanded,
  devServerSettingsIsOpen,
}: {
  devServerIsExpanded: boolean;
  devServerSettingsIsOpen: boolean;
}): boolean => devServerIsExpanded && !devServerSettingsIsOpen;
