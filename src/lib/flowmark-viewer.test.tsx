import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { FlowmarkViewer } from "@/components/flowmark-viewer";
import type { FlowmarkModel } from "./flowmark";
import { flowmarkDocument } from "./flowmark-viewer";

test("embeds review data as escaped JSON with isolated scripts and no network access", () => {
  const title = '</script><img src=x onerror="alert(1)"><script>';
  const model: FlowmarkModel = { model_version: 1, title, diagnostics: [] };
  const html = flowmarkDocument(model);
  expect(html).not.toContain(title);
  expect(html).toContain('default-src \'none\'');
  expect(html).toContain(':root[data-theme=dark]');
  expect(html).toContain(':root[data-theme=light]');
  expect(html).not.toContain('if (global.history && global.location)');
  const json = html.match(/<script type="application\/json" id="model">(.*?)<\/script>/s)![1]!;
  expect(JSON.parse(json).title).toBe(title);
  const frame = renderToStaticMarkup(<FlowmarkViewer model={model} />);
  expect(frame).toContain('sandbox="allow-scripts"');
  expect(frame).not.toContain('allow-same-origin');
  expect(frame).toContain('title="Flowmark interactive review"');
});
