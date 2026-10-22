import { ShieldAlert } from "lucide-react";
import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
import type { BrowserPromptOf } from "./browser-component-types";
import { BrowserStateView } from "./browser-state-view";
import { useBrowserAsyncAction } from "./use-browser-async-action";

export type BrowserCertificateViewProps = {
  prompt: BrowserPromptOf<"certificate">;
  /** A rejected promise keeps the view and shows the error. */
  onProceed: () => Promise<void>;
  onBack: () => Promise<void>;
};

/** Shows a certificate error in place of the page. Go back is the main action. */
export function BrowserCertificateView({
  prompt,
  onProceed,
  onBack,
}: BrowserCertificateViewProps): ReactElement {
  const answer = useBrowserAsyncAction();
  return (
    <BrowserStateView
      icon={ShieldAlert}
      tone="danger"
      title="This connection is not private"
      actions={
        <Button
          type="button"
          size="sm"
          disabled={answer.pending}
          onClick={() => void answer.run(onBack)}
        >
          Go back
        </Button>
      }
    >
      <p>
        The certificate of{" "}
        <span className="font-medium break-all text-foreground">{prompt.host}</span> is not valid.
        Someone can try to read or change the data that you send to this site.
      </p>
      <code className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[11px] break-all text-foreground">
        {prompt.error}
      </code>
      {answer.error ? (
        <p role="alert" className="text-destructive">
          {answer.error}
        </p>
      ) : null}
      <div className="mt-3 flex w-full flex-col items-center gap-2 border-t border-border pt-3">
        <p>
          Proceed only if you trust this site, such as a local dev server. The exception applies to{" "}
          {prompt.host} in this workspace until OpenDucktor restarts.
        </p>
        <Button
          type="button"
          size="xs"
          variant="destructiveGhost"
          disabled={answer.pending}
          onClick={() => void answer.run(onProceed)}
        >
          Proceed to this site
        </Button>
      </div>
    </BrowserStateView>
  );
}
