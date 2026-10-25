/** One choice of a select control. Each platform renders it in its own way. */
export type SelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
  description?: string;
  secondaryLabel?: string;
  searchKeywords?: string[];
};
