import { Check, Cpu, FolderGit2, Route } from "lucide-react";
import {
  type CSSProperties,
  type ReactElement,
  type ReactNode,
  useLayoutEffect,
  useRef,
} from "react";
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
  const scrollContainerRef = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (scrollContainer?.dataset.stage === stage) scrollContainer.scrollTop = 0;
  }, [stage]);

  return (
    <main
      ref={scrollContainerRef}
      data-stage={stage}
      className="onboarding-shell h-[100dvh] min-h-0 overflow-y-auto bg-background text-foreground"
    >
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-[1120px] flex-col px-4 py-5 sm:px-6 sm:py-7 lg:px-8">
        <header className="flex items-center justify-between gap-4 pb-5">
          <div className="flex items-center gap-3">
            <span
              className="block size-9 shrink-0 bg-foreground"
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

        <nav
          className="rounded-xl border border-border bg-card px-3 py-3 shadow-sm sm:px-5"
          aria-label="Onboarding progress"
          data-orientation="horizontal"
        >
          <ol className="grid grid-cols-3">
            {ONBOARDING_STAGES.map((item, index) => {
              const complete = index < currentStageIndex;
              const current = index === currentStageIndex;
              const Icon = item.icon;
              return (
                <li
                  key={item.id}
                  aria-current={current ? "step" : undefined}
                  className="relative flex min-w-0 justify-center px-1 sm:px-3"
                >
                  {index > 0 ? (
                    <span
                      className={cn(
                        "absolute right-1/2 top-5 h-px w-full",
                        index <= currentStageIndex ? "bg-primary" : "bg-border",
                      )}
                      aria-hidden="true"
                    />
                  ) : null}
                  <div className="relative flex min-w-0 flex-col items-center gap-2 bg-card px-2 text-center sm:flex-row sm:px-3 sm:text-left">
                    <span
                      className={cn(
                        "flex size-10 shrink-0 items-center justify-center rounded-full border transition-colors duration-150 motion-reduce:transition-none",
                        complete && "border-foreground bg-foreground text-background",
                        current && "border-primary bg-primary text-primary-foreground",
                        !complete && !current && "border-input bg-card text-muted-foreground",
                      )}
                    >
                      {complete ? (
                        <Check className="size-4" aria-hidden="true" />
                      ) : (
                        <Icon className="size-4" aria-hidden="true" />
                      )}
                    </span>
                    <span className="min-w-0">
                      <span
                        className={cn(
                          "block text-xs font-semibold sm:text-sm",
                          current && "text-primary",
                        )}
                      >
                        {item.label}
                      </span>
                      <span className="hidden text-xs text-muted-foreground md:block">
                        {item.description}
                      </span>
                    </span>
                  </div>
                </li>
              );
            })}
          </ol>
        </nav>

        <section className="min-w-0 flex-1 pb-6 pt-5" aria-live="polite">
          <div key={stage} className="onboarding-stage-enter motion-reduce:animate-none">
            {children}
          </div>
        </section>
      </div>
    </main>
  );
}
