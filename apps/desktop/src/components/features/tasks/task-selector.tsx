import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import type { TaskCard } from "@openblueprint/contracts";
import { useMemo } from "react";

type TaskSelectorProps = {
  tasks: TaskCard[];
  value: string;
  onValueChange: (taskId: string) => void;
  includeEmptyOption?: boolean;
  emptyLabel?: string;
  searchPlaceholder?: string;
};

const EMPTY_VALUE = "__none__";

export function TaskSelector({
  tasks,
  value,
  onValueChange,
  includeEmptyOption = true,
  emptyLabel = "Select task",
  searchPlaceholder = "Search tasks...",
}: TaskSelectorProps) {
  const options = useMemo<ComboboxOption[]>(() => {
    const entries = tasks.map((task) => ({
      value: task.id,
      label: `${task.id} · ${task.title}`,
      searchKeywords: [task.title.toLowerCase(), task.issueType, ...task.labels],
    }));

    if (!includeEmptyOption) {
      return entries;
    }

    return [{ value: EMPTY_VALUE, label: emptyLabel, searchKeywords: ["none"] }, ...entries];
  }, [emptyLabel, includeEmptyOption, tasks]);

  return (
    <Combobox
      value={value || EMPTY_VALUE}
      options={options}
      searchPlaceholder={searchPlaceholder}
      onValueChange={(nextValue) => onValueChange(nextValue === EMPTY_VALUE ? "" : nextValue)}
    />
  );
}
