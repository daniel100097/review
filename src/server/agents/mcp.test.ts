import { afterEach, expect, test } from "bun:test";
import { serveRunTools, setMcpBaseUrl } from "./mcp";

afterEach(() => setMcpBaseUrl(new URL("http://127.0.0.1:3000")));

test.each([
  ["http://0.0.0.0:3000", "http://127.0.0.1:3000"],
  ["http://[::]:3000", "http://[::1]:3000"],
  ["http://[::1]:3000", "http://[::1]:3000"],
  ["http://192.0.2.1:3000", "http://192.0.2.1:3000"],
  ["http://127.0.0.1:80", "http://127.0.0.1"],
])("agents can reach a server bound to %s", (binding, expected) => {
  setMcpBaseUrl(new URL(binding!));
  const tools = serveRunTools(() => {});
  try {
    expect(new URL(tools.server.url).origin).toBe(expected!);
  } finally {
    tools.dispose();
  }
});
