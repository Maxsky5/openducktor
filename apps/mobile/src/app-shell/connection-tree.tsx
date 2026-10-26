import { ClientConnectionProvider } from "@openducktor/frontend-core/connection/client-connection-react";
import { type PropsWithChildren, type ReactElement, useEffect } from "react";
import { MobileAppStateProvider } from "@/composition/mobile-app-state-provider";
import { ActiveSessionProvider, CommandGateProvider } from "@/host-session/active-session-context";
import type { ActiveHostSession } from "@/host-session/host-session-owner";
import { ResourceFilesProvider } from "@/platform/resource-files-context";
import { clearHostContentCaches } from "@/rich-content/lru-cache";
import { StartupPresentationProvider } from "@/features/session-startup/startup-presentation";
import { StartupProgressHost } from "@/features/session-startup/startup-progress-host";

/**
 * Everything that belongs to one host connection. The owner unmounts this tree before it disposes
 * the connection, so React effects release their subscriptions first. The unmount also clears the
 * parse, highlight, and size caches of the host content.
 */
export function ConnectionTree({
  session,
  children,
}: PropsWithChildren<{ session: ActiveHostSession }>): ReactElement {
  useEffect(() => clearHostContentCaches, []);
  return (
    <ActiveSessionProvider session={session}>
      <ClientConnectionProvider connection={session.connection}>
        <CommandGateProvider>
          <ResourceFilesProvider connectionKey={session.sessionKey}>
            <MobileAppStateProvider>
              <StartupPresentationProvider>
                {children}
                <StartupProgressHost />
              </StartupPresentationProvider>
            </MobileAppStateProvider>
          </ResourceFilesProvider>
        </CommandGateProvider>
      </ClientConnectionProvider>
    </ActiveSessionProvider>
  );
}
