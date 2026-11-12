import type { ReactNode } from "react";
import { isDiagramName } from "./diagrams/catalog";
import { LazyDiagram } from "./diagrams/lazy";

/**
 * A diagram of `DIAGRAMS` in `components/diagrams/catalog.ts`, such as `<Diagram name="workflow" />`.
 * MDX passes the name without a type check, so an unknown name stops the build here.
 */
export function Diagram({ name }: { name: string }) {
  if (!isDiagramName(name)) {
    throw new Error(
      `No diagram has the name "${name}". Use a name of DIAGRAMS in components/diagrams/catalog.ts.`,
    );
  }
  return <LazyDiagram name={name} />;
}

/** Numbered steps, one short action in each `<Step>`, with a small number badge. */
export function Steps({ children }: { children: ReactNode }) {
  return <ol className="docs-steps">{children}</ol>;
}

export function Step({ children }: { children: ReactNode }) {
  return <li className="docs-step">{children}</li>;
}
