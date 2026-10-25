/** One option that an option picker offers, such as a branch. */
export type OptionChoice = {
  value: string;
  label: string;
  /** Why the option cannot be chosen, or a short note such as "Current branch". */
  detail?: string | null | undefined;
  disabled?: boolean | undefined;
};

export type OptionPickerRow = {
  value: string;
  label: string;
  detail: string | null;
  selected: boolean;
  disabled: boolean;
};

const searchTerms = (query: string): string[] =>
  query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);

/**
 * The options that match a search, with the chosen option first. An option matches when its label
 * contains each word of the search, so "feat login" finds `feature/login-page`.
 */
export const optionPickerRows = (
  choices: readonly OptionChoice[],
  selectedValue: string | null | undefined,
  query: string,
): OptionPickerRow[] => {
  const terms = searchTerms(query);
  const rows: OptionPickerRow[] = [];
  let selectedRow: OptionPickerRow | null = null;
  for (const choice of choices) {
    const name = choice.label.toLocaleLowerCase();
    if (!terms.every((term) => name.includes(term))) continue;
    const row = {
      value: choice.value,
      label: choice.label,
      detail: choice.detail ?? null,
      selected: choice.value === selectedValue,
      disabled: choice.disabled === true,
    };
    if (row.selected) selectedRow = row;
    else rows.push(row);
  }
  return selectedRow ? [selectedRow, ...rows] : rows;
};
