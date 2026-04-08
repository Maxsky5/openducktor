import type { TaskCard } from "@openducktor/contracts";
import { useMemo } from "react";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";

type TaskSelectorProps = {
  tasks: TaskCard[];
  value: string;
  onValueChange: (taskId: string) => void;
  includeEmptyOption?: boolean;
  emptyLabel?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
};

const EMPTY_VALUE = "__none__";

export function TaskSelector({
  tasks,
  value,
  onValueChange,
  includeEmptyOption = true,
  emptyLabel = "Select task",
  searchPlaceholder = "Search tasks...",
  disabled = false,
}: TaskSelectorProps) {
  const options = useMemo<ComboboxOption[]>(() => {
    const entries = tasks.map((task) => ({
      value: task.id,
      label: `${task.id} · ${task.title}`,
      searchText: task.title,
    }));

    if (!includeEmptyOption) {
      return entries;
    }

    return [{ value: EMPTY_VALUE, label: emptyLabel, searchText: emptyLabel }, ...entries];
  }, [emptyLabel, includeEmptyOption, tasks]);

  return (
    <Combobox
      value={value || EMPTY_VALUE}
      options={options}
      searchPlaceholder={searchPlaceholder}
      searchMode="allTerms"
      disabled={disabled}
      onValueChange={(nextValue) => onValueChange(nextValue === EMPTY_VALUE ? "" : nextValue)}
    />
  );
}
