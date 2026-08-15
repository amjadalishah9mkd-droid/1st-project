import { readFile } from "node:fs/promises";
import { createServer } from "node:http";

const port = Number.parseInt(process.env.PORT ?? "3000", 10);

createServer(async (request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ status: "ok" }));
    return;
  }

  if (new URL(request.url ?? "/", "http://localhost").pathname !== "/") {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  try {
    response.writeHead(200, {
      "cache-control": "no-store",
      "content-type": "text/html; charset=utf-8",
    });
    response.end(await readFile("index.html"));
  } catch {
    response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    response.end("Unable to load the frontend");
  }
}).listen(port, "0.0.0.0", () => {
  console.log(`Frontend listening on http://0.0.0.0:${port}`);
});
