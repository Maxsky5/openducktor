"use client";

import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { createContext, use, useState } from "react";
import type * as React from "react";

import { cn } from "@/lib/utils";

/** The settings of the nearest provider, so a nested provider with the same settings is skipped. */
const ProviderSettingsContext = createContext<string | null>(null);

/**
 * Shares the open delay of its tooltips. The app root has one; a nested provider with the same
 * settings renders only its children, so each tooltip group does not add its own provider.
 */
function TooltipProvider({
  delayDuration = 80,
  skipDelayDuration,
  disableHoverableContent,
  children,
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  const settings = `${delayDuration}|${skipDelayDuration ?? ""}|${disableHoverableContent ?? false}`;
  const inherited = use(ProviderSettingsContext);
  if (inherited === settings) return children;
  return (
    <ProviderSettingsContext value={settings}>
      <TooltipPrimitive.Provider
        delayDuration={delayDuration}
        skipDelayDuration={skipDelayDuration}
        disableHoverableContent={disableHoverableContent}
      >
        {children}
      </TooltipPrimitive.Provider>
    </ProviderSettingsContext>
  );
}

/** False until the tooltip first opens; its content and portal mount only then. */
const ContentMountedContext = createContext(true);

/**
 * A tooltip whose content mounts at its first open. A page has dozens of tooltips, and a closed
 * Radix content still mounts a portal and a presence for each one, which every hidden view then
 * renders again when it is shown. After the first open the content stays, so Radix keeps the
 * close animation.
 */
function Tooltip({
  open,
  defaultOpen,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  const [opened, setOpened] = useState(Boolean(defaultOpen));
  if (open && !opened) setOpened(true);
  return (
    <ContentMountedContext value={opened || Boolean(open)}>
      <TooltipPrimitive.Root
        data-slot="tooltip"
        open={open}
        defaultOpen={defaultOpen}
        onOpenChange={(next) => {
          if (next) setOpened(true);
          onOpenChange?.(next);
        }}
        {...props}
      />
    </ContentMountedContext>
  );
}

function TooltipTrigger({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

function TooltipContent({
  className,
  arrowClassName,
  sideOffset = 0,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content> & { arrowClassName?: string }) {
  if (!use(ContentMountedContext)) return null;
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        data-page-occluder=""
        sideOffset={sideOffset}
        className={cn(
          "bg-foreground text-background z-[80] w-fit origin-(--radix-tooltip-content-transform-origin) rounded-md px-3 py-1.5 text-xs text-balance",
          className,
        )}
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow
          className={cn(
            "bg-foreground fill-foreground size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px]",
            arrowClassName,
          )}
        />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
