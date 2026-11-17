import type { PropsWithChildren } from "react";
import type { ClientConnection } from "@openducktor/frontend-core/connection/client-connection";
import { ClientConnectionProvider } from "@openducktor/frontend-core/connection/client-connection-react";
import { CommandPaletteRegistryProvider } from "@/features/command-palette/command-palette-registry";
import { ShortcutPreferencesProvider } from "@/features/shortcuts/shortcut-preferences-provider";

export function ShortcutTestProviders({
  connection,
  children,
}: PropsWithChildren<{ connection: ClientConnection }>) {
  return (
    <ClientConnectionProvider connection={connection}>
      <ShortcutPreferencesProvider>
        <CommandPaletteRegistryProvider>{children}</CommandPaletteRegistryProvider>
      </ShortcutPreferencesProvider>
    </ClientConnectionProvider>
  );
}
