import type { RuntimeKind } from "@openducktor/contracts";
import type { ReactElement } from "react";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";

type AgentRuntimeComboboxProps = {
  value: RuntimeKind | "";
  onValueChange: (value: RuntimeKind) => void;
  runtimeOptions: ComboboxOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
};

export function AgentRuntimeCombobox({
  value,
  onValueChange,
  runtimeOptions,
  placeholder = "Select runtime",
  disabled = false,
  className,
  triggerClassName,
}: AgentRuntimeComboboxProps): ReactElement {
  return (
    <Combobox
      value={value}
      options={runtimeOptions}
      placeholder={placeholder}
      disabled={disabled}
      {...(className ? { className } : {})}
      {...(triggerClassName ? { triggerClassName } : {})}
      onValueChange={onValueChange}
    />
  );
}
