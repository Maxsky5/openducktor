import { Tab, Tabs } from "fumadocs-ui/components/tabs";
import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";
import type { ReactNode } from "react";
import { Accordion, Accordions } from "./accordions";
import { AgentMessage } from "./agent-message";
import { Card, Cards } from "./cards";
import { ProductDemo } from "./demo/product-demo";
import { isDiagramName } from "./diagrams/catalog";
import { LazyDiagram } from "./diagrams/lazy";
import { IconItem, IconList } from "./icon-list";
import { Action, Status } from "./inline-badges";
import { MdxLink } from "./mdx-link";
import { AnnotatedScreenshot, ScreenRow, Screenshot } from "./media";
import { PromptAnatomy } from "./prompt-anatomy";

/**
 * A diagram of `DIAGRAMS` in `components/diagrams/catalog.ts`, such as `<Diagram name="workflow" />`.
 * MDX passes the name without a type check, so an unknown name stops the build here.
 */
function Diagram({ name }: { name: string }) {
  if (!isDiagramName(name)) {
    throw new Error(
      `No diagram has the name "${name}". Use a name of DIAGRAMS in components/diagrams/catalog.ts.`,
    );
  }
  return <LazyDiagram name={name} />;
}

/** Numbered steps, one short action in each `<Step>`, with a small number badge. */
function Steps({ children }: { children: ReactNode }) {
  return <ol className="docs-steps">{children}</ol>;
}

function Step({ children }: { children: ReactNode }) {
  return <li className="docs-step">{children}</li>;
}

/**
 * The components that the MDX pages can use. Links to other pages use the client router. The
 * Fumadocs defaults give `Callout`.
 */
export const mdxComponents = {
  ...defaultMdxComponents,
  a: MdxLink,
  Accordion,
  Accordions,
  Action,
  AgentMessage,
  AnnotatedScreenshot,
  Card,
  Cards,
  Diagram,
  IconItem,
  IconList,
  ProductDemo,
  PromptAnatomy,
  ScreenRow,
  Screenshot,
  Status,
  Step,
  Steps,
  Tab,
  Tabs,
} satisfies MDXComponents;
