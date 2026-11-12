import { docsLlms } from "@/lib/source";

// The build writes the list of pages to `out/llms.txt`.
export const revalidate = false;

export async function GET() {
  return new Response(await docsLlms.index());
}
