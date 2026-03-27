import { Bot } from "lucide-react";
import type { ReactElement } from "react";
import { getAppVersion } from "@/lib/app-version";

const APP_VERSION = getAppVersion();

export function AppBrand(): ReactElement {
  return (
    <div className="flex items-center gap-3">
      <div className="rounded-xl bg-sidebar-accent p-2 text-sidebar-accent-foreground shadow-md">
        <Bot className="size-5" />
      </div>
      <div>
        <p className="text-lg font-semibold tracking-tight">OpenDucktor</p>
        {APP_VERSION && <p className="text-xs text-sidebar-muted-foreground">{APP_VERSION}</p>}
      </div>
    </div>
  );
}
