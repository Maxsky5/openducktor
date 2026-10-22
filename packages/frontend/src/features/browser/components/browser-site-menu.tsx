import type {
  BrowserPermissionDecision,
  BrowserPermissionKind,
  BrowserSitePermissionsResponse,
} from "@openducktor/contracts";
import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BROWSER_PERMISSION_TEXT } from "./browser-permission-text";

export type BrowserSitePermission = BrowserSitePermissionsResponse["permissions"][number];

export type BrowserSiteMenuProps = {
  /** The origin of the current page, or null when the page has no site, such as a blank page. */
  origin: string | null;
  /** The saved choices of the origin, or null before they load. */
  permissions: readonly BrowserSitePermission[] | null;
  /** True while the choices load or a reset runs. */
  loading: boolean;
  error: string | null;
  /** Resets one saved choice, or every saved choice of the origin when `permission` is null. */
  onReset: (permission: BrowserPermissionKind | null) => void;
};

const DECISION_TEXT = {
  granted: "Allowed",
  denied: "Denied",
} satisfies Record<BrowserPermissionDecision, string>;

const DECISION_CLASS_NAMES = {
  granted: "bg-success-surface text-success-surface-foreground",
  denied: "bg-destructive-surface text-destructive-surface-foreground",
} satisfies Record<BrowserPermissionDecision, string>;

/** The saved site permission choices of the current page, with reset actions. */
export function BrowserSiteMenu({
  origin,
  permissions,
  loading,
  error,
  onReset,
}: BrowserSiteMenuProps): ReactElement {
  return (
    <section aria-label="Site settings" className="flex flex-col gap-1 p-1">
      <div className="flex flex-col px-2 pt-1">
        <h2 className="text-xs font-medium text-foreground">Site settings</h2>
        {origin ? (
          <p className="truncate text-xs text-muted-foreground" title={origin}>
            {origin}
          </p>
        ) : null}
      </div>
      <SiteMenuBody
        origin={origin}
        permissions={permissions}
        loading={loading}
        error={error}
        onReset={onReset}
      />
    </section>
  );
}

function SiteMenuBody({
  origin,
  permissions,
  loading,
  error,
  onReset,
}: BrowserSiteMenuProps): ReactElement {
  if (origin === null) {
    return <SiteMenuText>This page has no site settings.</SiteMenuText>;
  }
  if (error !== null) {
    return (
      <p role="alert" className="px-2 py-2 text-xs text-destructive">
        {error}
      </p>
    );
  }
  if (permissions === null) {
    return (
      <p role="status" className="px-2 py-2 text-xs text-muted-foreground">
        Loading saved choices...
      </p>
    );
  }
  if (permissions.length === 0) {
    return (
      <SiteMenuText>
        No saved choices. When this site asks for a permission, OpenDucktor saves your answer here.
      </SiteMenuText>
    );
  }
  return (
    <>
      <ul aria-label="Saved choices" aria-busy={loading} className="flex flex-col gap-0.5">
        {permissions.map(({ permission, decision }) => {
          const text = BROWSER_PERMISSION_TEXT[permission];
          const Icon = text.icon;
          return (
            <li
              key={permission}
              className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-muted/50"
            >
              <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-xs text-foreground">{text.label}</span>
              <span
                className={cn(
                  "shrink-0 rounded-sm px-1.5 text-[10px] leading-4 font-medium",
                  DECISION_CLASS_NAMES[decision],
                )}
              >
                {DECISION_TEXT[decision]}
              </span>
              <Button
                type="button"
                size="xs"
                variant="ghost"
                aria-label={`Reset ${text.label}`}
                disabled={loading}
                onClick={() => onReset(permission)}
              >
                Reset
              </Button>
            </li>
          );
        })}
      </ul>
      <div className="flex justify-end border-t border-border px-1 pt-1">
        <Button
          type="button"
          size="xs"
          variant="ghost"
          disabled={loading}
          onClick={() => onReset(null)}
        >
          Reset all
        </Button>
      </div>
    </>
  );
}

function SiteMenuText({ children }: { children: string }): ReactElement {
  return <p className="px-2 py-2 text-xs text-muted-foreground">{children}</p>;
}
