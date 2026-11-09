import type { ShortcutActionId } from "@openducktor/contracts";
import { ShortcutScope, ShortcutText } from "@/features/shortcuts/shortcut-controls";
import type { BrowserNavigation, BrowserTabSummary } from "@openducktor/contracts";

import {
  ArrowLeft,
  ArrowRight,
  Bot,
  CodeXml,
  Download,
  type LucideIcon,
  MessageSquareText,
  RotateCw,
  SlidersHorizontal,
  SquareDashedMousePointer,
  X,
} from "lucide-react";
import { useLocalShortcuts } from "@/features/shortcuts/use-local-shortcuts";
import { useRef, type ReactElement, type ReactNode, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import {
  BROWSER_ADDRESS_INPUT_CLASS_NAME,
  BROWSER_ADDRESS_PLACEHOLDER,
  BrowserAddressBar,
} from "./browser-address-bar";

/** The tools of an Electron tab: site settings, annotations, sharing, DevTools, and downloads. */
export type BrowserPageTools = {
  supportsDevTools: boolean;
  pickerActive: boolean;
  /** The pending annotations of the tab owner. */
  annotationCount: number;
  /** The annotation list. The popover mounts it only while it is open. */
  annotationsContent: ReactNode;
  /** The site menu. The popover mounts it only while it is open. */
  siteMenuContent: ReactNode;
  /** The downloads menu, or null to hide the downloads button. */
  downloadsContent: ReactNode | null;
  onTogglePicker: () => void;
  /** A rejected promise shows its message under the toolbar. */
  onSetShared: (shared: boolean) => Promise<void>;
  /** True while the docked DevTools of the tab show. */
  devToolsOpen: boolean;
  onToggleDevTools: () => void;
};

export type BrowserToolbarProps = {
  tab: BrowserTabSummary;
  /** When it changes to a value above zero, the address bar takes focus and selects its text. */
  addressFocusRequest: number;
  /** A rejected promise shows its message under the toolbar. */
  onNavigate: (navigation: BrowserNavigation) => Promise<void>;
  /** Moves the keyboard focus into the page on F6 in the address bar, or null. */
  onFocusPage: (() => void) | null;
  /** Runs after Enter loads a typed address. It moves the focus into the page, as in a browser. */
  onAddressLoad: () => void;
  /**
   * The tools of an Electron tab, or null for a web runner tab. A web runner page uses the
   * permissions, downloads, and DevTools of this browser, and agents cannot use it.
   */
  tools: BrowserPageTools | null;
};

type ToolbarError = {
  message: string;
  /** True when the message is about the typed address. */
  invalidAddress: boolean;
  /** The page URL when the error happened. A new page URL hides the error. */
  url: string;
};

const ICON_BUTTON_CLASS_NAME = "size-7 shrink-0 text-muted-foreground hover:text-foreground";
const PRESSED_CLASS_NAME =
  "aria-pressed:bg-info-surface aria-pressed:text-info-surface-foreground aria-pressed:hover:bg-info-surface-hover";

/** The controls of a browser tab: navigation, address bar, annotations, sharing, and tools. */
export function BrowserToolbar({
  tab,
  addressFocusRequest,
  onNavigate,
  onFocusPage,
  onAddressLoad,
  tools,
}: BrowserToolbarProps): ReactElement {
  const [storedError, setStoredError] = useState<ToolbarError | null>(null);
  const errorId = useId();
  const error = storedError?.url === tab.url ? storedError : null;

  const showError = (cause: unknown): void => {
    setStoredError({ message: errorMessage(cause), invalidAddress: false, url: tab.url });
  };

  const navigate = (navigation: BrowserNavigation): void => {
    setStoredError(null);
    void onNavigate(navigation).catch(showError);
  };

  const root = useRef<HTMLDivElement>(null);
  const shortcutOwner = useLocalShortcuts(
    root,
    [
      {
        id: "browser-back" as const,
        run: () => navigate({ kind: "back" }),
        disabledReason: tab.canGoBack ? null : "No previous page.",
      },
      {
        id: "browser-forward" as const,
        run: () => navigate({ kind: "forward" }),
        disabledReason: tab.canGoForward ? null : "No next page.",
      },
      { id: "browser-reload" as const, run: () => navigate({ kind: "reload" }) },
      {
        id: "browser-stop" as const,
        run: () => navigate({ kind: "stop" }),
        disabledReason: tab.loading ? null : "The page is not loading.",
      },
      {
        id: "browser-address" as const,
        run: () => root.current?.querySelector<HTMLInputElement>("input")?.focus(),
      },
      {
        id: "browser-devtools" as const,
        run: () => tools?.onToggleDevTools(),
        disabledReason: tools?.supportsDevTools ? null : "Developer tools are unavailable.",
      },
      {
        id: "browser-picker" as const,
        run: () => tools?.onTogglePicker(),
        disabledReason: tools ? null : "The element picker is unavailable.",
      },
      {
        id: "browser-share" as const,
        run: () => {
          void tools?.onSetShared(!tab.shared).catch(showError);
        },
        disabledReason: tools ? null : "Sharing is unavailable.",
      },
      ...(
        [
          ["browser-downloads", "Downloads"],
          ["browser-permissions", "Site settings"],
        ] as const
      ).map(([id, label]) => ({
        id,
        label,
        run: () =>
          root.current?.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)?.click(),
        disabledReason: tools ? null : "Browser tools are unavailable.",
      })),
    ],
    '[data-testid="browser-tab-view"]',
  );

  return (
    <ShortcutScope owners={[shortcutOwner]}>
      <TooltipProvider>
        <div ref={root} className="flex shrink-0 flex-col border-b border-border bg-card">
          <div
            role="group"
            aria-label="Browser controls"
            className="flex h-9 items-center gap-0.5 px-1"
          >
            <ToolbarButton
              shortcutId="browser-back"
              icon={ArrowLeft}
              label="Back"
              disabled={!tab.canGoBack}
              onClick={() => navigate({ kind: "back" })}
            />
            <ToolbarButton
              shortcutId="browser-forward"
              icon={ArrowRight}
              label="Forward"
              disabled={!tab.canGoForward}
              onClick={() => navigate({ kind: "forward" })}
            />
            {tab.loading ? (
              <ToolbarButton
                shortcutId="browser-stop"
                icon={X}
                label="Stop"
                onClick={() => navigate({ kind: "stop" })}
              />
            ) : (
              <ToolbarButton
                shortcutId="browser-reload"
                icon={RotateCw}
                label="Reload"
                onClick={() => navigate({ kind: "reload" })}
              />
            )}
            {tools ? (
              <ToolbarPopoverButton
                shortcutId="browser-permissions"
                icon={SlidersHorizontal}
                label="Site settings"
                align="start"
              >
                {tools.siteMenuContent}
              </ToolbarPopoverButton>
            ) : null}
            <BrowserAddressBar
              url={tab.url}
              focusRequest={addressFocusRequest}
              onFocusPage={onFocusPage}
              errorId={error ? errorId : null}
              invalid={error?.invalidAddress ?? false}
              onError={(message) =>
                setStoredError(message ? { message, invalidAddress: true, url: tab.url } : null)
              }
              onSubmit={(url) => {
                navigate({ kind: "address", address: url });
                onAddressLoad();
              }}
            />
            {tools ? (
              <PageTools
                tab={tab}
                tools={tools}
                onStart={() => setStoredError(null)}
                onError={showError}
              />
            ) : null}
          </div>
          {error ? (
            <p id={errorId} role="alert" className="px-2 pb-1.5 text-xs text-destructive">
              {error.message}
            </p>
          ) : null}
        </div>
      </TooltipProvider>
    </ShortcutScope>
  );
}

/**
 * The toolbar of a tab before its host summary comes. It has the layout of the toolbar of a new
 * tab and takes no input, so the real toolbar replaces it without a visible change.
 */
export function BrowserToolbarPlaceholder(): ReactElement {
  return (
    <div className="flex shrink-0 flex-col border-b border-border bg-card" inert>
      <div className="flex h-9 items-center gap-0.5 px-1">
        <PlaceholderButton icon={ArrowLeft} disabled />
        <PlaceholderButton icon={ArrowRight} disabled />
        <PlaceholderButton icon={RotateCw} disabled={false} />
        <Input
          readOnly
          aria-label="Address"
          placeholder={BROWSER_ADDRESS_PLACEHOLDER}
          className={BROWSER_ADDRESS_INPUT_CLASS_NAME}
        />
      </div>
    </div>
  );
}

function PlaceholderButton({
  icon: Icon,
  disabled,
}: {
  icon: LucideIcon;
  disabled: boolean;
}): ReactElement {
  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      disabled={disabled}
      className={ICON_BUTTON_CLASS_NAME}
    >
      <Icon className="size-4" aria-hidden="true" />
    </Button>
  );
}

/** The tools after the address bar of an Electron tab. */
function PageTools({
  tab,
  tools,
  onStart,
  onError,
}: {
  tab: BrowserTabSummary;
  tools: BrowserPageTools;
  /** A tool action starts, so an older toolbar error goes away. */
  onStart: () => void;
  onError: (cause: unknown) => void;
}): ReactElement {
  const [isSharing, setIsSharing] = useState(false);
  const { annotationCount } = tools;

  const toggleShared = async (): Promise<void> => {
    onStart();
    setIsSharing(true);
    try {
      await tools.onSetShared(!tab.shared);
    } catch (cause) {
      onError(cause);
    } finally {
      setIsSharing(false);
    }
  };

  return (
    <>
      <ToolbarButton
        shortcutId="browser-picker"
        icon={SquareDashedMousePointer}
        label="Annotate"
        tooltip={tools.pickerActive ? "Stop annotating (Esc)" : "Annotate page elements"}
        pressed={tools.pickerActive}
        onClick={tools.onTogglePicker}
      />
      <ToolbarPopoverButton
        icon={MessageSquareText}
        label={
          annotationCount > 0 ? `Pending annotations: ${annotationCount}` : "Pending annotations"
        }
        align="end"
        count={annotationCount}
        contentClassName="w-96"
      >
        {tools.annotationsContent}
      </ToolbarPopoverButton>
      <SharingControl tab={tab} isSharing={isSharing} onToggle={() => void toggleShared()} />
      {tools.supportsDevTools ? (
        <ToolbarButton
          shortcutId="browser-devtools"
          icon={CodeXml}
          label="DevTools"
          tooltip={tools.devToolsOpen ? "Hide DevTools" : "Show DevTools"}
          pressed={tools.devToolsOpen}
          onClick={tools.onToggleDevTools}
        />
      ) : null}
      {tools.downloadsContent !== null ? (
        <ToolbarPopoverButton
          shortcutId="browser-downloads"
          icon={Download}
          label="Downloads"
          align="end"
          activity={tab.downloads.some((download) => download.state === "in_progress")}
        >
          {tools.downloadsContent}
        </ToolbarPopoverButton>
      ) : null}
    </>
  );
}

/** Share with agents for a user tab, and the agent badge for an agent tab. */
function SharingControl({
  tab,
  isSharing,
  onToggle,
}: {
  tab: BrowserTabSummary;
  isSharing: boolean;
  onToggle: () => void;
}): ReactElement {
  if (tab.createdBy !== "user") return <AgentBadge />;
  return (
    <ToolbarButton
      shortcutId="browser-share"
      icon={Bot}
      label="Share with agents"
      tooltip={
        tab.shared ? "Agents can use this tab. Click to stop sharing." : "Let agents use this tab."
      }
      pressed={tab.shared}
      disabled={isSharing}
      onClick={onToggle}
    />
  );
}

function ToolbarButton({
  shortcutId,
  icon: Icon,
  label,
  tooltip,
  pressed,
  disabled,
  onClick,
}: {
  shortcutId: ShortcutActionId;
  icon: LucideIcon;
  /** The accessible name. The tooltip shows it unless `tooltip` is set. */
  label: string;
  tooltip?: string;
  /** Makes the button a toggle with this state. */
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
}): ReactElement {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label={label}
          aria-pressed={pressed}
          disabled={disabled}
          className={cn(ICON_BUTTON_CLASS_NAME, PRESSED_CLASS_NAME)}
          onClick={onClick}
        >
          <Icon className="size-4" aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <ShortcutText id={shortcutId} available={!disabled}>
          {tooltip ?? label}
        </ShortcutText>
      </TooltipContent>
    </Tooltip>
  );
}

function ToolbarPopoverButton({
  shortcutId,
  icon: Icon,
  label,
  align,
  count = 0,
  activity = false,
  contentClassName,
  children,
}: {
  shortcutId?: ShortcutActionId;
  icon: LucideIcon;
  label: string;
  align: "start" | "end";
  /** Shows a count next to the icon when it is above zero. */
  count?: number;
  /** Shows a mark over the icon, such as for a download in progress. */
  activity?: boolean;
  contentClassName?: string;
  children: ReactNode;
}): ReactElement {
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              type="button"
              size="xs"
              variant="ghost"
              aria-label={label}
              className="relative h-7 min-w-7 shrink-0 gap-1 px-1.5 text-muted-foreground hover:text-foreground"
            >
              <Icon className="size-4" aria-hidden="true" />
              {count > 0 ? (
                <span
                  aria-hidden="true"
                  className="rounded-full bg-sky-300 px-1.5 text-[10px] leading-4 font-semibold text-neutral-950 tabular-nums"
                >
                  {count}
                </span>
              ) : null}
              {activity ? (
                <span
                  aria-hidden="true"
                  className="absolute top-1 right-1 size-1.5 rounded-full bg-info-accent motion-safe:animate-pulse"
                />
              ) : null}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <ShortcutText id={shortcutId}>{label}</ShortcutText>
        </TooltipContent>
      </Tooltip>
      <PopoverContent
        align={align}
        aria-label={label}
        className={cn(
          "max-h-[min(32rem,var(--radix-popover-content-available-height))] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto p-0",
          contentClassName,
        )}
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}

function AgentBadge(): ReactElement {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex h-5 shrink-0 items-center gap-1 rounded-sm bg-info-surface px-1.5 text-[11px] font-medium text-info-surface-foreground ring-1 ring-info-border/40 ring-inset">
          <Bot className="size-3" aria-hidden="true" />
          Agent
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom">An agent opened this tab. Agents can use it.</TooltipContent>
    </Tooltip>
  );
}
