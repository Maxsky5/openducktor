import { Tab, Tabs } from "fumadocs-ui/components/tabs";
import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";
import { Accordion, Accordions } from "./accordions";
import { AgentMessage } from "./agent-message";
import { Card, Cards } from "./cards";
import { ProductDemo } from "./demo/product-demo";
import { IconItem, IconList } from "./icon-list";
import { Action, Status } from "./inline-badges";
import { Diagram, Step, Steps } from "./mdx-blocks";
import { MdxLink } from "./mdx-link";
import { AnnotatedScreenshot, ScreenRow, Screenshot } from "./media";
import { PromptAnatomy } from "./prompt-anatomy";

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
