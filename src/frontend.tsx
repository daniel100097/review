/**
 * Entry point for the React app, included in `src/index.html`.
 */

import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { applyTheme } from "./lib/theme";
import { queryClient } from "./lib/trpc";

applyTheme();

// Radix focuses a clicked tab from code, which Chrome can count as keyboard focus on the page's first click.
// Remember how the user last interacted so such controls only show focus rings for keyboard use.
document.documentElement.dataset.input = "keyboard";
addEventListener("keydown", () => (document.documentElement.dataset.input = "keyboard"), true);
addEventListener("pointerdown", () => (document.documentElement.dataset.input = "pointer"), true);

const elem = document.getElementById("root")!;
const app = (
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>
);

// https://bun.com/docs/bundler/hot-reloading#import-meta-hot-data
(import.meta.hot.data.root ??= createRoot(elem)).render(app);
