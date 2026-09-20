import { type ComponentProps, createContext, use, useMemo } from "react";
import { Tabs } from "@/components/ui/tabs";

type BrowserTabsSelection = {
  value: string;
  onValueChange: (value: string) => void;
};

const BrowserTabsContext = createContext<BrowserTabsSelection | null>(null);

export function BrowserTabsRoot({
  value,
  onValueChange,
  children,
  ...props
}: BrowserTabsSelection &
  Omit<ComponentProps<typeof Tabs>, "value" | "defaultValue" | "onValueChange">) {
  const selection = useMemo(() => ({ value, onValueChange }), [value, onValueChange]);
  return (
    <BrowserTabsContext value={selection}>
      <Tabs {...props} value={value} onValueChange={onValueChange}>
        {children}
      </Tabs>
    </BrowserTabsContext>
  );
}

export function useBrowserTabsSelection(): BrowserTabsSelection {
  const selection = use(BrowserTabsContext);
  if (!selection) throw new Error("BrowserTabs must be rendered within BrowserTabsRoot.");
  return selection;
}
