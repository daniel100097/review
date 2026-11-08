import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown } from "./markdown";

const body = "![shot](https://example.com/a.png) ![plain](http://example.com/b.png) <img src=\"https://example.com/c.png\">";

test("agent Markdown links images instead of loading them", () => {
  const html = renderToStaticMarkup(<Markdown>{body}</Markdown>);
  expect(html).not.toContain("<img");
  expect(html).toMatch(/<a href="https:\/\/example.com\/a.png" target="_blank" rel="noreferrer"[^>]*>.*shot<\/a>/);
  // Only https becomes a link; raw HTML stays text.
  expect(html).not.toContain('href="http://example.com/b.png"');
  expect(html).toContain("plain");
  expect(html).toContain("&lt;img");
});

test("forge Markdown loads https images without a referrer", () => {
  const html = renderToStaticMarkup(<Markdown loadImages>{body}</Markdown>);
  expect(html).toMatch(/<img src="https:\/\/example.com\/a.png" alt="shot" loading="lazy" referrerPolicy="no-referrer"/i);
  expect(html).not.toContain('src="http://example.com/b.png"');
  expect(html).not.toContain('src="https://example.com/c.png"');
});
