import { useState } from "react";
import { SessionNavigationList as View } from "./session-navigation-list";
export function SessionNavigationList(
  props: Omit<Parameters<typeof View>[0], "collapsedGroups" | "onToggleGroup">,
) {
  const [collapsedGroups, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  return (
    <View
      {...props}
      collapsedGroups={collapsedGroups}
      onToggleGroup={(id) =>
        setCollapsed((current) => {
          const next = new Set(current);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        })
      }
    />
  );
}
