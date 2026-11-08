"use client";
import dynamic from "next/dynamic";
import { type DiagramName, loadDiagram } from "./catalog";

/**
 * The diagrams load React Flow in a separate chunk, so a page without a diagram does not fetch it.
 * The server still renders each diagram, and its page preloads the chunk.
 */
const DiagramView = dynamic(() => import("./view"));

/** A diagram of the catalog. Its spec module loads at the same time as React Flow. */
export function LazyDiagram({ name }: { name: DiagramName }) {
  void loadDiagram(name);
  return <DiagramView name={name} />;
}
