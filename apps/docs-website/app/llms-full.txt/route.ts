import { docsLlms } from "@/lib/source";

// The build writes the text of all pages to `out/llms-full.txt`.
export const revalidate = false;

export async function GET() {
  return new Response(await docsLlms.full());
}
