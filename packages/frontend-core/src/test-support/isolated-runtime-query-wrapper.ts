import { createElement, type PropsWithChildren, type ReactElement } from "react";
import { HostRuntimeStatusContext } from "../sessions/session-contexts";
import { IsolatedQueryWrapper } from "./isolated-query-wrapper";
import { createHostRuntimeStatusContextValue } from "./shared-test-fixtures";

const readyRuntimeStatus = createHostRuntimeStatusContextValue();

/** An isolated query client with every runtime kind ready, for hooks that read runtime catalogs. */
export function IsolatedRuntimeQueryWrapper({ children }: PropsWithChildren): ReactElement {
  return createElement(
    IsolatedQueryWrapper,
    null,
    createElement(HostRuntimeStatusContext, { value: readyRuntimeStatus }, children),
  );
}
