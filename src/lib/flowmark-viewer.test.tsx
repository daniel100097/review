import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { FlowmarkViewer } from "@/components/flowmark-viewer";
import type { FlowmarkModel } from "./flowmark";
import { flowmarkDocument, flowmarkKeys, flowmarkThemeVars, viewerColors } from "./flowmark-viewer";

test("embeds review data as escaped JSON with isolated scripts and no network access", () => {
  const title = '</script><img src=x onerror="alert(1)"><script>';
  const model: FlowmarkModel = { model_version: 1, title, diagnostics: [] };
  const html = flowmarkDocument(model);
  expect(html).not.toContain(title);
  expect(html).toContain('default-src \'none\'');
  expect(html).toContain(':root[data-theme=dark]');
  expect(html).toContain(':root[data-theme=light]');
  // Upstream's light and dark colour blocks; a reformatted viewer.css would otherwise inject "undefined".
  expect(viewerColors).toHaveLength(2);
  expect(viewerColors.every(block => block.includes("--bg:"))).toBe(true);
  expect(html).not.toContain("{undefined}");
  expect(html).toStartWith('<!doctype html><html lang="en">');
  expect(html).not.toContain('if (global.history && global.location)');
  const json = html.match(/<script type="application\/json" id="model">(.*?)<\/script>/s)![1]!;
  expect(JSON.parse(json).title).toBe(title);
  const frame = renderToStaticMarkup(<FlowmarkViewer model={model} />);
  expect(frame).toContain('sandbox="allow-scripts"');
  expect(frame).not.toContain('allow-same-origin');
  expect(frame).toContain('title="Flowmark interactive review"');
});

test("themes and fonts arrive by message without loosening the frame's policy", () => {
  const html = flowmarkDocument({ model_version: 1, title: "Review", diagnostics: [] });
  // Fonts are loaded from posted bytes, so the policy stays closed: no font-src, no data: URLs.
  const policy = html.match(/http-equiv="Content-Security-Policy" content="([^"]*)"/)![1];
  expect(policy).toBe("default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'");
  // Only whitelisted variables, with values that can't carry url() or extra declarations.
  expect(html).toContain(`const themeVars = ${JSON.stringify(Object.keys(flowmarkThemeVars))}`);
  expect(html).toContain("/^[\\w\\s.,%#()\\/+-]{1,100}$/.test(value) && !/url\\(/i.test(value)");
  expect(html).toContain("/^Geist (Mono )?Variable$/.test(font?.family)");
  expect(html).toContain("if (source !== parent || !data) return;");
  // Forwarded keys are limited to the viewer's own shortcuts.
  expect(flowmarkKeys.test("1")).toBe(true);
  expect(flowmarkKeys.test("c")).toBe(true);
  expect(flowmarkKeys.test("j")).toBe(false);
  expect(flowmarkKeys.test("11")).toBe(false);
});
