import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { serve } from "bun";
import index from "./index.html";
import { handleMcp, setMcpBaseUrl } from "./server/agents/mcp";
import { appRouter } from "./server/router";

const server = serve({
  hostname: process.env.HOST ?? (Bun.isStandaloneExecutable ? "127.0.0.1" : "0.0.0.0"),
  routes: {
    // Serve index.html for all unmatched routes; client-side routing takes over.
    "/*": index,

    "/trpc/*": (req, server) => {
      // Generating rules can take longer than Bun's default idle timeout; the procedure has its own deadline.
      if (new URL(req.url).pathname.slice("/trpc/".length).split(",").includes("filters.generate")) server.timeout(req, 0);
      return fetchRequestHandler({ endpoint: "/trpc", req, router: appRouter });
    },

    // Tools for running agents, e.g. submitting a walkthrough.
    "/mcp/:token": req => handleMcp(req, req.params.token),
  },

  development: process.env.NODE_ENV !== "production" && {
    hmr: true,
    console: true,
  },
});

setMcpBaseUrl(server.url);
console.log(`🚀 Server running at ${server.url}`);
