import type { ReactElement } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { GIT_PANEL_TABS, type GitPanelTab } from "./constants";

export type GitPanelTabsProps = {
  activeTab: GitPanelTab;
  onTabChange: (tab: GitPanelTab) => void;
  /** The file count of the Uncommitted changes tab, or null for none. */
  uncommittedCount: number | null;
  /** The file count of the Branch changes tab, or null for none. */
  targetCount: number | null;
  panelId?: string | undefined;
};

/**
 * Content-width tabs in one row. The row scrolls sideways when the panel is narrow. Every tab
 * stays selectable; a tab whose read loads or fails shows that state in its view.
 */
export function GitPanelTabs({
  activeTab,
  onTabChange,
  uncommittedCount,
  targetCount,
  panelId,
}: GitPanelTabsProps): ReactElement {
  return (
    <Tabs
      value={activeTab}
      onValueChange={(value) => {
        const tab = GIT_PANEL_TABS.find((option) => option.tab === value);
        if (tab) onTabChange(tab.tab);
      }}
      className="gap-0"
    >
      <TabsList
        aria-label="Git views"
        className="h-9 w-full justify-start gap-0.5 overflow-x-auto overflow-y-hidden rounded-none border-b border-border bg-transparent p-0 px-1 [scrollbar-width:none]"
      >
        {GIT_PANEL_TABS.map((option) => {
          return (
            <TabsTrigger
              key={option.tab}
              value={option.tab}
              id={panelId ? `${panelId}-tab-${option.tab}` : undefined}
              aria-controls={panelId}
              className={cn(
                "relative h-full flex-none cursor-pointer gap-1.5 rounded-none border-0 px-2.5 text-xs transition-none",
                "after:absolute after:inset-x-1.5 after:bottom-0 after:h-0.5 after:rounded-full after:bg-transparent",
                "hover:text-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:after:bg-primary",
                "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
              )}
              data-testid={option.testId}
            >
              {option.label}
              <CountBadge count={tabCount(option.tab, uncommittedCount, targetCount)} />
            </TabsTrigger>
          );
        })}
      </TabsList>
    </Tabs>
  );
}

const tabCount = (
  tab: GitPanelTab,
  uncommittedCount: number | null,
  targetCount: number | null,
): number | null => {
  if (tab === "uncommitted") return uncommittedCount;
  if (tab === "target") return targetCount;
  return null;
};

function CountBadge({ count }: { count: number | null }): ReactElement | null {
  if (count === null) return null;
  return (
    <span
      className="rounded-full bg-muted px-1.5 text-[10px] font-medium tabular-nums text-muted-foreground"
      aria-label={`${count} files`}
    >
      {count}
    </span>
  );
}
