"use client";
import { use } from "react";
import { type DiagramName, loadDiagram } from "./catalog";
import { FlowDiagram } from "./flow-diagram";

/** One diagram of the catalog. `lazy.tsx` loads this module, with React Flow, on demand. */
export default function DiagramView({ name }: { name: DiagramName }) {
  return <FlowDiagram diagram={use(loadDiagram(name))} />;
}
