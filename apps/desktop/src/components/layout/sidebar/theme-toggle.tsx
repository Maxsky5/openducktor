import { Moon, Sun } from "lucide-react";
import type { ReactElement } from "react";
import { useTheme } from "@/components/layout/theme-provider";
import { Switch } from "@/components/ui/switch";

export function ThemeToggle(): ReactElement {
  const { theme, setTheme } = useTheme();
  const resolvedDark = theme === "dark";

  return (
    <div className="flex items-center gap-2">
      <Sun className="size-3.5 text-sidebar-muted-foreground" />
      <Switch
        checked={resolvedDark}
        onCheckedChange={(checked) => setTheme(checked ? "dark" : "light")}
        aria-label="Toggle dark mode"
      />
      <Moon className="size-3.5 text-sidebar-muted-foreground" />
    </div>
  );
}
