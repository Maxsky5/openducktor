import { Bot } from "lucide-react";
import type { ReactElement } from "react";
import { getAppVersion } from "@/lib/app-version";

export function AppBrand(): ReactElement {
  const version = getAppVersion();

  return (
    <div className="flex items-center gap-3">
      <div className="rounded-xl bg-sidebar-accent p-2 text-sidebar-accent-foreground shadow-md">
        <Bot className="size-5" />
      </div>
      <div>
        <p className="text-lg font-semibold tracking-tight">OpenDucktor</p>
        {version && <p className="text-xs text-sidebar-muted-foreground">{version}</p>}
      </div>
    </div>
  );
}
