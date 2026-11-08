import { createFromSource } from "fumadocs-core/search/server";
import { source } from "@/lib/source";

// The build writes the index to `out/search-index.json`. No search handler runs after deployment.
export const revalidate = false;

// `useStaticSearch` loads the index with the English tokenizer of ZBSearch, so the index uses it
// too. The search dialog orders the results by relevance only, so the index stores no sort data.
export const { staticGET: GET } = createFromSource(source, {
  language: "english",
  sort: { enabled: false },
});
