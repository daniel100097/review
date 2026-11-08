import { expect, test } from "bun:test";
import { type FilterRules } from "./filter-rules";
import { captureReviewFilters, readReviewFilters, reviewFilterActions, updateReviewFilters } from "./review-filters";

const base = "https://review.example/sources/1/repo/pull/2";
const exactRules: FilterRules = {
  version: 1,
  summary: "機械的な変更 💡 + & # %",
  rules: [{
    name: "包装変更",
    reason: "Keep the exact path and patch hash",
    changes: [{ path: " src/日本 語/+%&#/file.ts ", patchHash: "aB09/+%=&#💡", oldLine: 12, newLine: null }],
  }],
};

test("fresh URLs have no active or saved filters", () => {
  expect(readReviewFilters(new URL(`${base}?view=split#diff-42`))).toEqual({
    hideTests: false,
    hideCommentChanges: false,
    hideReviewComments: false,
    hiddenFolders: [],
    by: undefined,
    rules: undefined,
    rulesEnabled: false,
    error: "",
    hasFilters: false,
  });
});

test("only explicit 1 flags activate, while malformed and empty filters remain resettable", () => {
  for (const key of ["hideTests", "hideCommentChanges", "hideReviewComments"] as const) {
    for (const value of ["", "0", "false", "true", "yes", "2"]) {
      const state = readReviewFilters(new URL(`${base}?${key}=${value}`));
      expect(state[key]).toBe(false);
      expect(state.hasFilters).toBe(true);
    }
    expect(readReviewFilters(new URL(`${base}?${key}=1`))[key]).toBe(true);
  }
  for (const suffix of ["?hideFolder=", "?by=", "#rules=", "#rulesPaused=bad"]) {
    expect(readReviewFilters(new URL(base + suffix)).hasFilters).toBe(true);
  }
});

test("raw URLs round trip Unicode folders and JSON without changing paths or exact patch hashes", () => {
  const folders = [" src/日本 語/💡/ ", "src//a/", "/src", "   ", "src/+%&#"];
  const url = updateReviewFilters(new URL(base), (query, fragment) => {
    for (const folder of [...folders, "", folders[0]!]) query.append("hideFolder", folder);
    query.set("by", "Zoë + 李");
    fragment.set("rules", JSON.stringify(exactRules));
  });
  const state = readReviewFilters(new URL(url.href));
  expect(state.hiddenFolders).toEqual(folders);
  expect(state.by).toBe("Zoë + 李");
  expect(state.rules).toEqual(exactRules);
  expect(state.rulesEnabled).toBe(true);
  expect(state.error).toBe("");
  expect(url.searchParams.has("rules")).toBe(false);
  expect(new URLSearchParams(url.hash.slice(1)).get("rules")).toBe(JSON.stringify(exactRules));
});

test("paused rules retain their data and only rulesPaused=1 pauses them", () => {
  for (const paused of [undefined, "", "0", "true", "1"]) {
    const url = updateReviewFilters(new URL(base), (_, fragment) => {
      fragment.set("rules", JSON.stringify(exactRules));
      if (paused !== undefined) fragment.set("rulesPaused", paused);
    });
    const state = readReviewFilters(url);
    expect(state.rules).toEqual(exactRules);
    expect(state.rulesEnabled).toBe(paused !== "1");
    expect(state.hasFilters).toBe(true);
  }
});

test("malformed rules fail open and empty rules stay disabled", () => {
  for (const text of ["{", "null", '{"version":2,"rules":[]}', '{"version":1,"rules":[{"name":"bad"}]}']) {
    const url = updateReviewFilters(new URL(`${base}?hideTests=1`), (_, fragment) => fragment.set("rules", text));
    const state = readReviewFilters(url);
    expect(state.rules).toBeUndefined();
    expect(state.rulesEnabled).toBe(false);
    expect(state.error).toContain("Invalid filter rules");
    expect(state.hasFilters).toBe(true);
    expect(state.hideTests).toBe(true);
  }
  for (const text of ["", "  ", '{"version":1,"rules":[]}']) {
    const state = readReviewFilters(updateReviewFilters(new URL(base), (_, fragment) => fragment.set("rules", text)));
    expect(state.rules).toBeUndefined();
    expect(state.rulesEnabled).toBe(false);
    expect(state.error).toBe("");
    expect(state.hasFilters).toBe(true);
  }
});

test("updates clone the URL and preserve raw untouched query and hash encodings", () => {
  const original = new URL(`${base}?view=hello%20world&literal=~#diff/%e6%97%a5+%20`);
  const next = updateReviewFilters(original, query => query.set("hideTests", "1"));
  expect(next).not.toBe(original);
  expect(original.search).toBe("?view=hello%20world&literal=~");
  expect(next.hash).toBe(original.hash);
  expect(next.searchParams.get("view")).toBe("hello world");
  const fragmentOnly = updateReviewFilters(original, (_, fragment) => fragment.set("rulesPaused", "1"));
  expect(fragmentOnly.search).toBe(original.search);
  expect(updateReviewFilters(original, () => {}).href).toBe(original.href);
});

// Exercise the same actions the hook returns without a DOM or a React test renderer.
function withBrowser(run: (location: { href: string }, pushes: { state: unknown; href: string }[]) => void) {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousHistory = Object.getOwnPropertyDescriptor(globalThis, "history");
  const location = { href: `${base}?view=split#anchor=diff%2F42` };
  const pushes: { state: unknown; href: string }[] = [];
  const history = {
    state: { scroll: 42 },
    pushState(state: unknown, _: string, url: string | URL) {
      location.href = new URL(url, location.href).href;
      pushes.push({ state, href: location.href });
    },
  };
  Object.defineProperty(globalThis, "window", { configurable: true, value: { location } });
  Object.defineProperty(globalThis, "history", { configurable: true, value: history });
  try {
    run(location, pushes);
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (previousHistory) Object.defineProperty(globalThis, "history", previousHistory);
    else Reflect.deleteProperty(globalThis, "history");
  }
}

test("consecutive setters preserve all filters and history state, with full large rules only in the fragment", () => {
  withBrowser((location, pushes) => {
    const rules: FilterRules = {
      version: 1,
      rules: [{ name: "Exact selections", changes: Array.from({ length: 60 }, (_, i) => ({
        path: `src/日本 語/${"long-path/".repeat(8)}file-${i}.ts`,
        patchHash: "abcdef0123456789".repeat(4), oldLine: i + 1, newLine: i + 2,
      })) }],
    };
    const search = new URL(location.href).search;
    reviewFilterActions.setRules(rules, true);
    const fragment = new URL(location.href).hash;
    expect(new URL(location.href).search).toBe(search);
    expect(fragment.length).toBeGreaterThan(16000);
    expect(new URLSearchParams(fragment.slice(1)).get("rules")).toBe(JSON.stringify(rules));
    reviewFilterActions.setToggle("hideTests", true);
    reviewFilterActions.setToggle("hideCommentChanges", true);
    reviewFilterActions.setToggle("hideReviewComments", true);
    reviewFilterActions.setFolderHidden(" src/日本 語/ ", true);
    reviewFilterActions.setFolderHidden("src//other", true);
    reviewFilterActions.setFolderHidden(" src/日本 語/ ", true);
    reviewFilterActions.setFolderHidden("", true);
    reviewFilterActions.setContributor("Zoë");
    expect(readReviewFilters(new URL(location.href))).toEqual({
      hideTests: true, hideCommentChanges: true, hideReviewComments: true,
      hiddenFolders: [" src/日本 語/ ", "src//other"], by: "Zoë",
      rules, rulesEnabled: true, error: "", hasFilters: true,
    });
    expect(new URL(location.href).hash).toBe(fragment);
    expect(new URL(location.href).search.length).toBeLessThan(300);
    expect(pushes).toHaveLength(9);
    expect(pushes.every(push => push.state === pushes[0]!.state)).toBe(true);
    expect(pushes[0]!.state).toEqual({ scroll: 42 });
    reviewFilterActions.setRules(rules, false);
    expect(readReviewFilters(new URL(location.href))).toMatchObject({ rules, rulesEnabled: false });
    reviewFilterActions.setRules(rules, true);
    expect(new URL(location.href).hash).toBe(fragment);
    reviewFilterActions.setFolderHidden(" src/日本 語/ ", false);
    reviewFilterActions.setToggle("hideTests", false);
    reviewFilterActions.setContributor();
    expect(readReviewFilters(new URL(location.href))).toMatchObject({
      hiddenFolders: ["src//other"], hideTests: false, hideCommentChanges: true, by: undefined, rules,
    });
    // Simulate back/forward and an unrelated navigation before the next setter.
    location.href = pushes[0]!.href;
    expect(readReviewFilters(new URL(location.href))).toMatchObject({ hideTests: false, hiddenFolders: [], rules });
    location.href = `${base}?other=fresh#diff-99`;
    reviewFilterActions.setContributor("new");
    expect(location.href).toBe(`${base}?other=fresh&by=new#diff-99`);
    expect(readReviewFilters(new URL(location.href)).rules).toBeUndefined();
  });
});

test("clearing folders unhides all of them in one history entry and keeps other filters", () => {
  withBrowser((location, pushes) => {
    location.href = `${base}?view=split&hideFolder=a&hideTests=1&hideFolder=b%2Fc&by=x#anchor=diff42`;
    reviewFilterActions.clearFolders();
    expect(pushes).toHaveLength(1);
    expect(location.href).toBe(`${base}?view=split&hideTests=1&by=x#anchor=diff42`);
    expect(readReviewFilters(new URL(location.href))).toMatchObject({ hiddenFolders: [], hideTests: true, by: "x" });
  });
});

test("setRules validates before navigating, clears empty rules, and reset removes only owned parameters", () => {
  withBrowser((location, pushes) => {
    const original = location.href;
    expect(() => reviewFilterActions.setRules({ version: 2, rules: [] } as unknown as FilterRules, true)).toThrow();
    expect(location.href).toBe(original);
    expect(pushes).toHaveLength(0);
    for (const empty of [undefined, { version: 1, rules: [] } as FilterRules]) {
      reviewFilterActions.setRules(exactRules, false);
      reviewFilterActions.setRules(empty, true);
      expect(location.href).toBe(original);
      expect(readReviewFilters(new URL(location.href)).rulesEnabled).toBe(false);
    }
    location.href = `${base}?view=a&view=b&rules=query-owned-elsewhere&hideTests=bad&hideTests=1&hideCommentChanges=0&hideReviewComments=&hideFolder=&hideFolder=src&by=#anchor=diff%2F42&anchor=second&hideTests=fragment-owned-elsewhere&rules=%7B&rulesPaused=bad`;
    reviewFilterActions.reset();
    expect(location.href).toBe(`${base}?view=a&view=b&rules=query-owned-elsewhere#anchor=diff%2F42&anchor=second&hideTests=fragment-owned-elsewhere`);
    expect(readReviewFilters(new URL(location.href)).hasFilters).toBe(false);
    location.href = `${base}?view=split&hideTests=1#diff/%e6%97%a5+%20`;
    reviewFilterActions.reset();
    expect(location.href).toBe(`${base}?view=split#diff/%e6%97%a5+%20`);
  });
});

test("a saved profile replaces every owned filter in one history entry and preserves unrelated URL data", () => {
  withBrowser((location, pushes) => {
    location.href = `${base}?view=split&hideTests=1&hideFolder=old&by=old#anchor=diff42&rulesPaused=1`;
    const before = location.href;
    const saved = captureReviewFilters(readReviewFilters(new URL(`${base}?hideCommentChanges=1&hideReviewComments=1&hideFolder=src%2F%E6%97%A5&by=Zo%C3%AB`)), "Hide mechanical wrapping");
    saved.rules = exactRules;
    saved.rulesEnabled = false;
    reviewFilterActions.replace(saved);
    expect(pushes).toHaveLength(1);
    expect(pushes[0]!.state).toEqual({ scroll: 42 });
    const applied = new URL(location.href);
    expect(applied.searchParams.get("view")).toBe("split");
    expect(new URLSearchParams(applied.hash.slice(1)).get("anchor")).toBe("diff42");
    expect(applied.searchParams.has("rules")).toBe(false);
    expect(location.href).not.toContain("mechanical");
    expect(readReviewFilters(applied)).toMatchObject({
      hideTests: false, hideCommentChanges: true, hideReviewComments: true,
      hiddenFolders: ["src/日"], by: "Zoë", rules: exactRules, rulesEnabled: false,
    });
    // Back restores the entire previous view; applying empty settings also clears stale rules.
    location.href = before;
    expect(readReviewFilters(new URL(location.href))).toMatchObject({ hideTests: true, hiddenFolders: ["old"], by: "old" });
    location.href = applied.href;
    reviewFilterActions.replace(captureReviewFilters(readReviewFilters(new URL(base)), ""));
    expect(location.href).toBe(`${base}?view=split#anchor=diff42`);
    expect(readReviewFilters(new URL(location.href)).hasFilters).toBe(false);
  });
});

test("profile capture includes only applied settings and validates before saving or navigating", () => {
  withBrowser((location, pushes) => {
    const initial = location.href;
    const filters = readReviewFilters(new URL(`${base}?hideTests=1`));
    const saved = captureReviewFilters(filters, "  Only behavior changes  ");
    expect(saved).toMatchObject({ hideTests: true, request: "  Only behavior changes  " });
    expect(saved).not.toHaveProperty("hasFilters");
    expect(saved).not.toHaveProperty("error");
    filters.hiddenFolders.push("later");
    expect(saved.hiddenFolders).toEqual([]);
    expect(() => captureReviewFilters(readReviewFilters(new URL(`${base}#rules=%7B`)), "")).toThrow("invalid custom rules");
    expect(() => captureReviewFilters(filters, "x".repeat(4001))).toThrow();
    expect(() => reviewFilterActions.replace({ ...saved, rules: { version: 2, rules: [] } as unknown as FilterRules })).toThrow();
    expect(location.href).toBe(initial);
    expect(pushes).toHaveLength(0);
  });
});
