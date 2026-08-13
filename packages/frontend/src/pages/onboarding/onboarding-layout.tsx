import { Check, Cpu, FolderGit2, Route } from "lucide-react";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import openducktorMarkUrl from "@/assets/openducktor-mark.svg";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type OnboardingStage = "welcome" | "runtimes" | "workspace";

const ONBOARDING_STAGES = [
  {
    id: "welcome",
    label: "Welcome",
    description: "How work moves",
    icon: Route,
  },
  {
    id: "runtimes",
    label: "Runtimes",
    description: "What runs agents",
    icon: Cpu,
  },
  {
    id: "workspace",
    label: "Workspace",
    description: "Where work lives",
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

  return (
    <main
      key={stage}
      className="onboarding-shell h-screen min-h-0 overflow-y-auto bg-background text-foreground"
    >
      <div className="mx-auto flex min-h-screen w-full max-w-[1180px] flex-col px-4 py-5 sm:px-6 sm:py-7 lg:px-8">
        <header className="flex items-center justify-between gap-4 pb-5 sm:pb-7">
          <div className="flex items-center gap-3">
            <span
              className="block size-10 shrink-0 bg-foreground"
              style={OPENDUCKTOR_MARK_MASK_STYLE}
              aria-hidden="true"
            />
            <div className="flex flex-col">
              <span className="text-base font-semibold tracking-tight">OpenDucktor</span>
              <span className="text-xs text-muted-foreground">Local delivery workspace</span>
            </div>
          </div>
          <Badge variant="outline">First-time setup</Badge>
        </header>

        <div className="grid flex-1 items-start gap-5 lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-7">
          <aside className="rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5 lg:sticky lg:top-7">
            <div className="mb-5 hidden lg:block">
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                Setup route
              </p>
              <p className="mt-2 text-lg font-semibold leading-snug tracking-tight">
                Prepare the tools that will work on your code.
              </p>
            </div>

            <nav aria-label="Onboarding progress">
              <p className="mb-3 text-xs font-medium text-muted-foreground">
                Step {currentStageIndex + 1} of {ONBOARDING_STAGES.length}
              </p>
              <ol className="relative grid grid-cols-3 gap-2 before:absolute before:bottom-6 before:left-[1.15rem] before:top-6 before:hidden before:w-px before:bg-border lg:flex lg:flex-col lg:gap-2 lg:before:block">
                {ONBOARDING_STAGES.map((item, index) => {
                  const complete = index < currentStageIndex;
                  const current = index === currentStageIndex;
                  const Icon = item.icon;
                  return (
                    <li
                      key={item.id}
                      aria-current={current ? "step" : undefined}
                      className={cn(
                        "relative flex min-w-0 flex-col items-center gap-2 rounded-lg border px-1.5 py-3 text-center transition-colors duration-150 motion-reduce:transition-none sm:flex-row sm:gap-3 sm:px-3 sm:text-left",
                        current
                          ? "border-primary bg-primary/5"
                          : "border-transparent bg-transparent",
                      )}
                    >
                      <span
                        className={cn(
                          "relative flex size-7 shrink-0 items-center justify-center rounded-full border",
                          complete && "border-foreground bg-foreground text-background",
                          current && "border-primary bg-primary text-primary-foreground",
                          !complete && !current && "border-input bg-card text-muted-foreground",
                        )}
                      >
                        {complete ? (
                          <Check className="size-3.5" aria-hidden="true" />
                        ) : (
                          <Icon className="size-3.5" aria-hidden="true" />
                        )}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-xs font-medium sm:text-sm">{item.label}</span>
                        <span className="hidden text-xs text-muted-foreground lg:block">
                          {item.description}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ol>
            </nav>

            <div className="mt-5 hidden rounded-lg bg-muted p-3 text-xs leading-relaxed text-muted-foreground lg:block">
              Repository data and runtime paths stay on this machine.
            </div>
          </aside>

          <section className="min-w-0 pb-6" aria-live="polite">
            <div className="onboarding-stage-enter motion-reduce:animate-none">{children}</div>
          </section>
        </div>
      </div>
    </main>
  );
}
