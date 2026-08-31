import { Bell, Check, Cpu, FolderGit2, Route } from "lucide-react";
import {
  type CSSProperties,
  type ReactElement,
  type ReactNode,
  useLayoutEffect,
  useRef,
} from "react";
import openducktorMarkUrl from "@/assets/openducktor-mark.svg";
import { ThemeToggle } from "@/components/layout/sidebar/theme-toggle";
import { getAppVersion } from "@/lib/app-version";
import { cn } from "@/lib/utils";

const APP_VERSION = getAppVersion();

export type OnboardingStage = "welcome" | "runtimes" | "notifications" | "workspace";

const ONBOARDING_STAGES = [
  {
    id: "welcome",
    label: "Welcome",
    icon: Route,
  },
  {
    id: "runtimes",
    label: "Coding agents",
    icon: Cpu,
  },
  {
    id: "notifications",
    label: "Notifications",
    icon: Bell,
  },
  {
    id: "workspace",
    label: "Workspace",
    icon: FolderGit2,
  },
] as const;

const OPENDUCKTOR_MARK_MASK_STYLE: CSSProperties = {
  WebkitMaskImage: `url(${openducktorMarkUrl})`,
  maskImage: `url(${openducktorMarkUrl})`,
  WebkitMaskPosition: "center",
  maskPosition: "center",
  WebkitMaskRepeat: "no-repeat",
  maskRepeat: "no-repeat",
  WebkitMaskSize: "contain",
  maskSize: "contain",
};

type OnboardingLayoutProps = {
  stage: OnboardingStage;
  children: ReactNode;
};

export function OnboardingLayout({ stage, children }: OnboardingLayoutProps): ReactElement {
  const currentStageIndex = ONBOARDING_STAGES.findIndex((item) => item.id === stage);
  const scrollContainerRef = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (scrollContainer?.dataset.stage === stage) {
      scrollContainer.scrollTop = 0;
    }
  }, [stage]);

  return (
    <main
      ref={scrollContainerRef}
      data-stage={stage}
      className="onboarding-shell h-[100dvh] min-h-0 overflow-y-auto bg-background text-foreground"
    >
      <div
        className="electron-native-controls-surface fixed inset-x-0 top-0 z-10 w-full"
        data-onboarding-native-titlebar=""
        aria-hidden="true"
      />
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-[1120px] flex-col px-4 py-5 sm:px-6 sm:py-7 lg:px-8">
        <header className="electron-titlebar-safe-area -mt-5 flex items-center justify-between gap-4 pt-5 pb-5 sm:-mt-7 sm:pt-7">
          <div className="flex items-center gap-3">
            <span
              className="block size-9 shrink-0 bg-foreground"
              style={OPENDUCKTOR_MARK_MASK_STYLE}
              aria-hidden="true"
            />
            <div className="flex flex-col">
              <span className="text-base font-semibold tracking-tight">OpenDucktor</span>
              {APP_VERSION ? (
                <span className="text-xs text-muted-foreground">{APP_VERSION}</span>
              ) : null}
            </div>
          </div>
          <ThemeToggle />
        </header>

        <nav
          className="rounded-2xl border border-border bg-card px-4 py-4 shadow-sm sm:px-10 sm:py-5"
          aria-label="Onboarding progress"
          data-orientation="horizontal"
        >
          <ol className="grid grid-cols-4">
            {ONBOARDING_STAGES.map((item, index) => {
              const complete = index < currentStageIndex;
              const current = index === currentStageIndex;
              const Icon = item.icon;
              return (
                <li
                  key={item.id}
                  aria-current={current ? "step" : undefined}
                  className="relative min-w-0 text-center"
                >
                  {index < ONBOARDING_STAGES.length - 1 ? (
                    <span
                      data-progress-connector=""
                      className={cn(
                        "absolute top-5 left-1/2 h-px w-full",
                        index < currentStageIndex ? "bg-primary" : "bg-border",
                      )}
                      aria-hidden="true"
                    />
                  ) : null}
                  <div className="relative flex min-w-0 flex-col items-center">
                    <span
                      className={cn(
                        "z-10 flex size-10 shrink-0 items-center justify-center rounded-full border bg-card ring-4 ring-card",
                        complete && "border-primary bg-primary text-primary-foreground",
                        current && "border-primary bg-primary text-primary-foreground shadow-sm",
                        !complete && !current && "border-input bg-card text-muted-foreground",
                      )}
                    >
                      {complete ? (
                        <Check className="size-4" aria-hidden="true" />
                      ) : (
                        <Icon className="size-4" aria-hidden="true" />
                      )}
                    </span>
                    <span
                      className={cn(
                        "mt-2.5 block max-w-full truncate px-1 text-xs font-semibold sm:text-sm",
                        current ? "text-foreground" : "text-muted-foreground",
                        complete && "text-foreground",
                      )}
                    >
                      {item.label}
                    </span>
                  </div>
                </li>
              );
            })}
          </ol>
        </nav>

        <section className="min-w-0 flex-1 pb-6 pt-5" aria-live="polite">
          <div className="onboarding-stage-content">{children}</div>
        </section>
      </div>
    </main>
  );
}
