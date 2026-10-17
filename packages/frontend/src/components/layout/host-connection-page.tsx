import type { PropsWithChildren } from "react";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { getAppVersion } from "@/lib/app-version";
import { ClientThemePicker } from "./client-theme-picker";
import { OpenDucktorMark } from "./openducktor-mark";

const APP_VERSION = getAppVersion();

export function HostConnectionPage({
  title,
  description,
  children,
}: PropsWithChildren<{
  title: string;
  description: string;
}>) {
  return (
    <main className="onboarding-shell flex min-h-dvh items-center justify-center bg-background px-5 py-10 text-foreground sm:px-8">
      <div
        className="electron-native-controls-surface fixed inset-x-0 top-0 w-full"
        aria-hidden="true"
      />
      <div className="flex w-full max-w-md flex-col gap-7">
        <header className="flex items-center justify-between gap-4 px-1">
          <div className="flex items-center gap-2.5">
            <OpenDucktorMark className="size-8" />
            <span className="text-base font-semibold tracking-tight">OpenDucktor</span>
          </div>
          <ClientThemePicker />
        </header>
        <Card className="bg-card supports-[backdrop-filter]:bg-card">
          <CardHeader className="gap-3 px-6 pt-7 sm:px-8 sm:pt-8">
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            <CardDescription className="break-words text-sm leading-relaxed text-foreground/70">
              {description}
            </CardDescription>
          </CardHeader>
          <CardContent className="px-6 pb-7 pt-6 sm:px-8 sm:pb-8">{children}</CardContent>
        </Card>
        {APP_VERSION ? (
          <p className="text-center text-xs text-foreground/70">OpenDucktor {APP_VERSION}</p>
        ) : null}
      </div>
    </main>
  );
}
