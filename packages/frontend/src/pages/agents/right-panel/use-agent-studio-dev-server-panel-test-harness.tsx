import { type QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { QueryProvider } from "@/lib/query-provider";

type DevServerPanelHookHarnessOptions = {
  queryClient?: QueryClient;
};

export const renderDevServerPanelHook = <HookArgs, HookResult>(
  useHook: (args: HookArgs) => HookResult,
  initialArgs: HookArgs,
  options: DevServerPanelHookHarnessOptions = {},
) => {
  let latest: HookResult | null = null;

  const getLatest = (): HookResult => {
    if (latest === null) {
      throw new Error("Hook result not ready");
    }
    return latest;
  };

  const Harness = ({ args }: { args: HookArgs }) => {
    latest = useHook(args);
    return null;
  };

  const renderProviders = (children: ReactNode): ReactElement => {
    if (options.queryClient) {
      return <QueryClientProvider client={options.queryClient}>{children}</QueryClientProvider>;
    }

    return <QueryProvider useIsolatedClient>{children}</QueryProvider>;
  };

  const view = render(renderProviders(<Harness args={initialArgs} />));

  return {
    getLatest,
    unmount: view.unmount,
    update: (nextArgs: HookArgs): void => {
      view.rerender(renderProviders(<Harness args={nextArgs} />));
    },
  };
};
