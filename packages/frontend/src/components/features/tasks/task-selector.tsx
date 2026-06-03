import type { TaskCard } from "@openducktor/contracts";
import { useMemo } from "react";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { buildTaskSelectorOptions, EMPTY_TASK_SELECTOR_VALUE } from "./task-selector-model";

type TaskSelectorProps = {
  tasks: TaskCard[];
  value: string;
  onValueChange: (taskId: string) => void;
  includeEmptyOption?: boolean;
  emptyLabel?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
};

export function TaskSelector({
  tasks,
  value,
  onValueChange,
  includeEmptyOption = true,
  emptyLabel = "Select task",
  searchPlaceholder = "Search tasks...",
  disabled = false,
}: TaskSelectorProps) {
  const options = useMemo<ComboboxOption[]>(
    () => buildTaskSelectorOptions(tasks, includeEmptyOption, emptyLabel),
    [emptyLabel, includeEmptyOption, tasks],
  );

  return (
    <Combobox
      value={value || EMPTY_TASK_SELECTOR_VALUE}
      options={options}
      searchPlaceholder={searchPlaceholder}
      matchAllSearchTerms
      disabled={disabled}
      onValueChange={(nextValue) =>
        onValueChange(nextValue === EMPTY_TASK_SELECTOR_VALUE ? "" : nextValue)
      }
    />
  );
}
