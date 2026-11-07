import { render, type RenderOptions } from "@testing-library/react";
import { WorkflowTestProvider } from "./workflow-provider";

/** Renders a component inside the host workflow test provider. */
export const renderWithWorkflow = (ui: Parameters<typeof render>[0], options?: RenderOptions) =>
  render(ui, { wrapper: WorkflowTestProvider, ...options });
