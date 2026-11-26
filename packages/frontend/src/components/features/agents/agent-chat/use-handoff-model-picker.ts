import { useState } from "react";
import {
  useHandoffModelRuntimes,
  useHandoffSelection,
} from "@openducktor/frontend-core/sessions/send/runtime-handoff";
import type { AgentChatComposerModel } from "./agent-chat.types";

export const useHandoffModelPicker = (
  picker: AgentChatComposerModel["modelPicker"],
  handoff: AgentChatComposerModel["handoff"],
): AgentChatComposerModel["modelPicker"] => {
  const [open, setOpen] = useState(false);
  const identity = handoff?.enabled ? handoff.identity : null;
  const repoPath = handoff?.repoPath ?? null;
  const selection = useHandoffSelection(repoPath, identity);
  const destinations = useHandoffModelRuntimes({ repoPath, identity, open });
  if (!identity || handoff?.blocked) return picker;
  return {
    ...picker,
    value: selection.selection?.model ?? picker.value,
    selectionPolicy: { kind: "editable" },
    runtimes: open
      ? [
          ...picker.runtimes.filter(({ descriptor }) => descriptor.kind === identity.runtimeKind),
          ...destinations.runtimes,
        ]
      : picker.runtimes,
    onOpenChange: (next) => {
      setOpen(next);
      picker.onOpenChange?.(next);
    },
    onValueChange: (value) => {
      if (value.runtimeKind === identity.runtimeKind) {
        if (selection.clear()) picker.onValueChange(value);
        return;
      }
      const descriptor = destinations.find(value);
      if (descriptor) selection.choose(value, descriptor);
    },
  };
};
