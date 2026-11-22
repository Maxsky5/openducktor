import { ArrowLeft } from "lucide-react";
import type { ReactElement } from "react";
import { Link, Outlet } from "react-router";
import { Button } from "@/components/ui/button";
import { OnboardingFrame } from "@/pages/onboarding/onboarding-layout";

/** Usage before the first workspace, in the frame of the onboarding page. */
export function UsageWithoutWorkspace(): ReactElement {
  return (
    <OnboardingFrame
      className="max-w-[1320px]"
      headerActions={
        <Button asChild variant="ghost" size="sm">
          <Link to="/onboarding">
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            Setup
          </Link>
        </Button>
      }
    >
      <Outlet />
    </OnboardingFrame>
  );
}
