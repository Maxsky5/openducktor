import type { ReactElement } from "react";
import { OpenDucktorMark } from "@/components/layout/openducktor-mark";
import { getAppVersion } from "@/lib/app-version";

const APP_VERSION = getAppVersion();

export function AppBrand(): ReactElement {
  return (
    <div className="flex items-center gap-3">
      <OpenDucktorMark className="size-10" />
      <div>
        <p className="text-base font-semibold tracking-tight">OpenDucktor</p>
        {APP_VERSION && <p className="text-[11px] text-sidebar-muted-foreground">{APP_VERSION}</p>}
      </div>
    </div>
  );
}
