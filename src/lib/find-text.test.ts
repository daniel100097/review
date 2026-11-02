import { expect, test } from "bun:test";
import { findText } from "./find-text";

test("treats regex metacharacters as literal text", () => {
  const text = ".*+?^${}()|[]\\/-";
  for (const query of text) {
    const start = text.indexOf(query);
    expect(findText(text, query)).toEqual([{ start, end: start + query.length }]);
  }
  expect(findText(`x${text}y`, text)).toEqual([{ start: 1, end: 1 + text.length }]);
});

test("finds every occurrence regardless of case", () => {
  expect(findText("foo FOO food", "fOo")).toEqual([
    { start: 0, end: 3 },
    { start: 4, end: 7 },
    { start: 8, end: 11 },
  ]);
});

test("returns nonoverlapping matches", () => {
  expect(findText("aaaaa", "aa")).toEqual([
    { start: 0, end: 2 },
    { start: 2, end: 4 },
  ]);
});

test("returns no matches for empty queries, empty text, or absent text", () => {
  expect(findText("abc", "")).toEqual([]);
  expect(findText("", "")).toEqual([]);
  expect(findText("", "a")).toEqual([]);
  expect(findText("abc", "z")).toEqual([]);
});

test("preserves original UTF-16 indices when lowercasing would change length", () => {
  expect(findText("😀İxX", "x")).toEqual([
    { start: 3, end: 4 },
    { start: 4, end: 5 },
  ]);
});

test("matches Unicode case pairs and preserves astral character widths", () => {
  expect(findText("éÉ", "é")).toEqual([{ start: 0, end: 1 }, { start: 1, end: 2 }]);
  expect(findText("Kk", "k")).toEqual([{ start: 0, end: 1 }, { start: 1, end: 2 }]);
  expect(findText("ſS", "s")).toEqual([{ start: 0, end: 1 }, { start: 1, end: 2 }]);
  expect(findText("𐐀𐐨", "𐐨")).toEqual([{ start: 0, end: 2 }, { start: 2, end: 4 }]);
});

test("finds literal multiline queries", () => {
  expect(findText("one\nTWO\none\ntwo", "oNe\ntWo")).toEqual([
    { start: 0, end: 7 },
    { start: 8, end: 15 },
  ]);
});
