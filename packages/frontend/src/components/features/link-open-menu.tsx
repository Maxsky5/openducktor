import { Check, Copy, ExternalLink, Globe, type LucideIcon } from "lucide-react";
import { type ReactElement, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import {
  closeLinkMenu,
  inAppLinkTarget,
  type LinkMenuAnchor,
  type LinkOpenChoice,
  linkMenuRequest,
  linkModifierLabel,
  openLink,
  subscribeLinkOpen,
} from "@/lib/link-open";

/**
 * The menu that a plain click on a chat or terminal link opens: the system browser, or a browser
 * tab of the page. Mod+Click and Shift+Mod+Click choose without the menu. Mounted once in the shell.
 */
export function LinkOpenMenu(): ReactElement | null {
  const request = useSyncExternalStore(subscribeLinkOpen, linkMenuRequest);
  const target = useSyncExternalStore(subscribeLinkOpen, inAppLinkTarget);
  const choicesRef = useRef<HTMLDivElement>(null);
  if (request === null) return null;
  return (
    <Popover
      open
      onOpenChange={(open) => {
        if (!open) closeLinkMenu();
      }}
    >
      <MenuAnchor anchor={request.anchor} />
      <PopoverContent
        key={request.url}
        align="start"
        aria-label="Open link"
        className="w-80 p-0"
        onCloseAutoFocus={(event) => event.preventDefault()}
        // The first choice takes the focus, so Enter opens the system browser.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          choicesRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
        }}
      >
        <LinkHeader url={request.url} />
        <div ref={choicesRef} className="flex flex-col p-1" role="group" aria-label="Open in">
          <ChoiceButton
            url={request.url}
            choice="system"
            icon={ExternalLink}
            label="System browser"
            keys={[linkModifierLabel()]}
            disabledReason={null}
          />
          <ChoiceButton
            url={request.url}
            choice="app"
            icon={Globe}
            label="OpenDucktor browser"
            keys={["⇧", linkModifierLabel()]}
            disabledReason={target?.blockedReason ?? null}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** A zero-size anchor at the clicked point or element, which the menu follows. */
function MenuAnchor({ anchor }: { anchor: LinkMenuAnchor }): ReactElement {
  const virtualRef = useMemo(
    () => ({
      current: {
        getBoundingClientRect: () =>
          DOMRect.fromRect({
            x: anchor.x,
            y: anchor.y,
            width: anchor.width,
            height: anchor.height,
          }),
      },
    }),
    [anchor],
  );
  return <PopoverAnchor virtualRef={virtualRef} />;
}

function LinkHeader({ url }: { url: string }): ReactElement {
  const [copied, setCopied] = useState(false);
  const copy = () =>
    void navigator.clipboard.writeText(url).then(
      () => setCopied(true),
      (cause: unknown) =>
        toast.error("Could not copy the link", { description: errorMessage(cause) }),
    );
  return (
    <div className="flex items-start gap-2 border-b border-border px-3 py-2">
      <p className="min-w-0 flex-1 font-mono text-xs leading-relaxed break-all text-muted-foreground">
        {url}
      </p>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        aria-label={copied ? "Link copied" : "Copy link"}
        className="size-6 shrink-0 text-muted-foreground hover:text-foreground"
        onClick={copy}
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </Button>
    </div>
  );
}

function ChoiceButton({
  url,
  choice,
  icon: Icon,
  label,
  keys,
  disabledReason,
}: {
  url: string;
  choice: LinkOpenChoice;
  icon: LucideIcon;
  label: string;
  keys: string[];
  disabledReason: string | null;
}): ReactElement {
  return (
    <button
      type="button"
      disabled={disabledReason !== null}
      className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm text-foreground outline-none hover:bg-accent focus-visible:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
      onClick={() =>
        void openLink(url, choice).catch((cause: unknown) =>
          toast.error("Could not open the link", { description: errorMessage(cause) }),
        )
      }
    >
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{label}</span>
        {disabledReason !== null ? (
          <span className="text-xs text-muted-foreground">{disabledReason}</span>
        ) : null}
      </span>
      <KbdGroup aria-label={`Shortcut: ${keys.join(" ")} click`}>
        {keys.map((key) => (
          <Kbd key={key}>{key}</Kbd>
        ))}
        <Kbd>Click</Kbd>
      </KbdGroup>
    </button>
  );
}
