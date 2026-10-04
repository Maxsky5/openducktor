import { request as httpRequest, type IncomingHttpHeaders } from "node:http";

export const request = (
  port: number,
  path: string,
  headers: Record<string, string> = {},
  method = "GET",
): Promise<{ status: number; headers: IncomingHttpHeaders; body: Buffer }> =>
  new Promise((resolve, reject) => {
    const outgoing = httpRequest(
      { hostname: "127.0.0.1", port, path, headers, method },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks),
          }),
        );
        response.on("error", reject);
      },
    );
    outgoing.on("error", reject);
    outgoing.end();
  });
