# codereview-ui

Code review UI for GitLab MRs and Forgejo PRs. See README.md for layout.

- Forge data is fetched by shelling out to `glab api` / `fj api` (`src/server/providers/`); never call forge HTTP APIs directly or store tokens. Providers normalize into the types in `providers/types.ts`; the frontend only sees those.
- `glab` 1.36 exits 0 on HTTP errors and reports them on stderr; `gitlab.ts` checks for that.
- Drizzle + `bun:sqlite`; migrations are generated with `bun db:generate` and applied on server start.
- The diff (`components/diff-list.tsx`) is one flat list of rows virtualized with TanStack Virtual against the window: off-screen rows aren't in the DOM, so scroll with `virtualizer.scrollToIndex`, not anchors or `scrollIntoView`. Syntax highlighting (`lib/highlight.ts`) runs per hunk side and is cached per file.
- Agents (`src/server/agents/`) run through ACP adapters with the user's installed CLIs and existing authentication. `CLAUDE_CODE_EXECUTABLE` and `CODEX_PATH` can override CLI discovery, which excludes dependency binaries from `node_modules`. Permission requests are checked by `read-only-command.ts`.
- `bun run build` embeds the SPA, ACP adapters, and `drizzle/` into a standalone executable. Keep dynamic adapter dispatch in `src/cli.ts` and run `bun scripts/smoke-binary.ts` after packaging changes.
- `bun dev` (`--hot`) doesn't pick up newly created files imported via the `@/` alias ("Could not resolve"); restart it after adding files.
- The client imports server code only as types (`import type`) so nothing server-side gets bundled.
- shadcn components go in `src/components/ui/` and import `cn` from `@/lib/utils`. `shadcn add` may rewrite this to the `cn` npm package; change it back.

Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun check` instead of `tsc --noEmit`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads .env, so don't use dotenv.

## APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

## Testing

Use `bun test` to run tests.

```ts#index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

## Type checking

Use `bun check` to type check the project. It reads `tsconfig.json` and reports the same errors as `tsc`.

- `bun check src/index.ts` checks one file and what it imports
- `bun --check src/index.ts`, `bun test --check` and `bun build --check` type check first, and do nothing else if there is an error

## Frontend

Use HTML imports with `Bun.serve()`. Don't use `vite`. HTML imports fully support React, CSS, Tailwind.

Server:

```ts#index.ts
import index from "./index.html"

Bun.serve({
  routes: {
    "/": index,
    "/api/users/:id": {
      GET: (req) => {
        return new Response(JSON.stringify({ id: req.params.id }));
      },
    },
  },
  // optional websocket support
  websocket: {
    open: (ws) => {
      ws.send("Hello, world!");
    },
    message: (ws, message) => {
      ws.send(message);
    },
    close: (ws) => {
      // handle close
    }
  },
  development: {
    hmr: true,
    console: true,
  }
})
```

HTML files can import .tsx, .jsx or .js files directly and Bun's bundler will transpile & bundle automatically. `<link>` tags can point to stylesheets and Bun's CSS bundler will bundle.

```html#index.html
<html>
  <body>
    <h1>Hello, world!</h1>
    <script type="module" src="./frontend.tsx"></script>
  </body>
</html>
```

With the following `frontend.tsx`:

```tsx#frontend.tsx
import React from "react";
import { createRoot } from "react-dom/client";

// import .css files directly and it works
import './index.css';

const root = createRoot(document.body);

export default function Frontend() {
  return <h1>Hello, world!</h1>;
}

root.render(<Frontend />);
```

Then, run index.ts

```sh
bun --hot ./index.ts
```

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.mdx`.
