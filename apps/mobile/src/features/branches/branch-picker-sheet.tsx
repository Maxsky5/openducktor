import type { ReactElement } from "react";
import type { OptionChoice } from "@/ui/option-picker-model";
import { OptionPickerSheet } from "@/ui/option-picker-sheet";

/**
 * A branch choice, as the desktop branch selector: a search field with the keyboard open and the
 * branch names in the code font, the chosen branch first. A choice closes the sheet.
 */
export function BranchPickerSheet({
  visible,
  title,
  hint = null,
  choices,
  error = null,
  onRetry,
  selected,
  emptyMessage = "The repository lists no branches.",
  onSelect,
  onClose,
}: {
  visible: boolean;
  title: string;
  /** A short note under the search field, such as a rule for the branch. */
  hint?: string | null | undefined;
  /** The branches, or undefined until the read answers. */
  choices: readonly OptionChoice[] | undefined;
  /** The failure of the branch read. */
  error?: Error | null | undefined;
  onRetry?: (() => void) | undefined;
  selected: string | null | undefined;
  emptyMessage?: string | undefined;
  onSelect: (value: string) => void;
  onClose: () => void;
}): ReactElement {
  return (
    <OptionPickerSheet
      visible={visible}
      title={title}
      searchPlaceholder="Search branches"
      hint={hint}
      choices={choices}
      error={error}
      errorTitle="Branches did not load"
      loadingLabel="Loading branches"
      onRetry={onRetry}
      selected={selected}
      emptyMessage={emptyMessage}
      emptyIcon="git-branch"
      mono
      autoFocus
      onSelect={onSelect}
      onClose={onClose}
    />
  );
}
