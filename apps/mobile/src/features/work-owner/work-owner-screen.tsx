import { Stack } from "expo-router";
import type { ReactElement, ReactNode } from "react";
import { Screen } from "@/ui/screen";
import { EmptyState, ErrorState, LoadingState } from "@/ui/states";
import { useWorkOwnerRef } from "./use-work-owner-ref";
import { type WorkOwner, WorkOwnerProvider, useWorkOwner } from "./work-owner-context";

export type WorkOwnerScreenProps = {
  /** The header title while the owner loads. */
  title: string;
  /** True when the screen shows changes. See `WorkOwnerProvider`. */
  diffs: boolean;
  /** The screen background. Grouped screens show inset list sections. */
  background?: "plain" | "grouped" | undefined;
  /**
   * The skeleton of the screen while the owner loads, the same one that the screen shows while
   * its own content loads. Without it, the screen shows a delayed spinner.
   */
  skeleton?: ReactElement | undefined;
  children: (owner: WorkOwner) => ReactNode;
};

/**
 * A work view screen. It reads the owner from the route, shows the loading and error states of
 * the owner, and renders `children` with the ready owner. The connection banner stays on top.
 */
export function WorkOwnerScreen({
  title,
  diffs,
  background = "plain",
  skeleton,
  children,
}: WorkOwnerScreenProps): ReactElement {
  const ownerRef = useWorkOwnerRef();
  if (!ownerRef) {
    return (
      <Screen background={background}>
        <Stack.Screen options={{ title }} />
        <EmptyState
          icon="link-off"
          title="Incomplete Link"
          message="It does not name a task or chat. Open the view again from its task or chat."
        />
      </Screen>
    );
  }
  return (
    <WorkOwnerProvider ownerRef={ownerRef} diffs={diffs}>
      <WorkOwnerStates title={title} background={background} skeleton={skeleton}>
        {children}
      </WorkOwnerStates>
    </WorkOwnerProvider>
  );
}

function WorkOwnerStates({
  title,
  background,
  skeleton,
  children,
}: {
  title: string;
  background: "plain" | "grouped";
  skeleton: ReactElement | undefined;
  children: (owner: WorkOwner) => ReactNode;
}): ReactElement {
  const state = useWorkOwner();
  if (state.status === "ready")
    return <Screen background={background}>{children(state.owner)}</Screen>;
  let content: ReactElement;
  if (state.status === "loading") {
    content = skeleton ?? <LoadingState label={state.label} />;
  } else {
    content = (
      <ErrorState title={state.title} message={state.message} onRetry={state.retry ?? undefined} />
    );
  }
  return (
    <Screen background={background}>
      <Stack.Screen options={{ title }} />
      {content}
    </Screen>
  );
}
