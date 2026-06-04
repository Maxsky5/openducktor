import type { TaskCard } from "@openducktor/contracts";
import type { ComboboxOption } from "@/components/ui/combobox";

export const EMPTY_TASK_SELECTOR_VALUE = "__none__";

export function buildTaskSelectorOptions(
  tasks: TaskCard[],
  includeEmptyOption: boolean,
  emptyLabel: string,
): ComboboxOption[] {
  const entries = tasks.map((task) => ({
    value: task.id,
    label: `${task.id} · ${task.title}`,
    searchText: task.title,
  }));

  if (!includeEmptyOption) {
    return entries;
  }

  return [
    { value: EMPTY_TASK_SELECTOR_VALUE, label: emptyLabel, searchText: emptyLabel },
    ...entries,
  ];
}
