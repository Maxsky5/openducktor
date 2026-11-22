import { ArrowLeft } from "lucide-react";
import type { ReactElement } from "react";
import { Link, Outlet } from "react-router";
import { Button } from "@/components/ui/button";
import { OnboardingHeader } from "@/pages/onboarding/onboarding-layout";

/** Usage before the first workspace, in the frame of the onboarding page. */
export function UsageWithoutWorkspace(): ReactElement {
  return (
    <main className="h-[100dvh] min-h-0 overflow-y-auto bg-background text-foreground">
      <div
        className="electron-native-controls-surface fixed inset-x-0 top-0 z-10 w-full"
        aria-hidden="true"
      />
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-[1320px] flex-col px-4 py-5 sm:px-6 sm:py-7 lg:px-8">
        <OnboardingHeader
          actions={
            <Button asChild variant="ghost" size="sm">
              <Link to="/onboarding">
                <ArrowLeft className="size-3.5" aria-hidden="true" />
                Setup
              </Link>
            </Button>
          }
        />
        <Outlet />
      </div>
    </main>
  );
}
