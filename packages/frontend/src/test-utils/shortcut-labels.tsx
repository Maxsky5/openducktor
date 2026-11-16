import { shortcutActionIdSchema } from "@openducktor/contracts";
import { use, useLayoutEffect, type PropsWithChildren } from "react";
import { CommandPaletteRegistryProvider } from "@/features/command-palette/command-palette-registry";
import { CommandPaletteRegistryContext } from "@/features/command-palette/command-palette-registry-context";

export function ShortcutLabels({
  labels,
  children,
}: PropsWithChildren<{ labels: Record<string, string | null> }>) {
  return (
    <CommandPaletteRegistryProvider>
      <PublishLabels labels={labels} />
      {children}
    </CommandPaletteRegistryProvider>
  );
}
function PublishLabels({ labels }: { labels: Record<string, string | null> }) {
  const registry = use(CommandPaletteRegistryContext)!;
  useLayoutEffect(() => {
    registry.shortcutLabels!.replace(
      new Map(
        Object.entries(labels).flatMap(([id, label]) =>
          label
            ? [
                [
                  shortcutActionIdSchema.parse(id),
                  { label, keys: label.split("+"), aria: label, owner: null },
                ],
              ]
            : [],
        ),
      ),
    );
  });
  return null;
}
