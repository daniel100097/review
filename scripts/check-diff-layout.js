// Run in browser DevTools with an unwrapped pull-request diff visible.
(async () => {
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const region = document.querySelector('[aria-label="Code diff"]');
  assert(region, "Open the Files tab first.");
  const originalScroll = region.scrollLeft;
  const maxScroll = region.scrollWidth - region.clientWidth;
  assert(maxScroll > 0, "Turn wrapping off and open a diff with a long line.");
  const offsets = [...new Set([0, Math.min(270, maxScroll), maxScroll])];
  try {
    for (const offset of offsets) {
      region.scrollLeft = offset;
      await new Promise(requestAnimationFrame);
      const viewport = region.getBoundingClientRect();
      const rows = [...region.querySelectorAll('.group.grid')];
      assert(rows.length > 0, "No diff lines rendered.");
      for (const row of rows) {
        const bounds = row.getBoundingClientRect();
        assert(bounds.left <= viewport.left + 1 && bounds.right >= viewport.right - 1,
          `Row background does not cover the viewport at scrollLeft=${offset}.`);
        assert(getComputedStyle(row.lastElementChild).backgroundColor === "rgba(0, 0, 0, 0)",
          "The code cell paints a second layer of diff highlighting.");
        assert(getComputedStyle(row.lastElementChild).whiteSpace === "pre", "Code unexpectedly wraps.");
      }
      const overlapping = rows.slice(0, -1).some((row, i) =>
        Number(rows[i + 1].parentElement.dataset.index) === Number(row.parentElement.dataset.index) + 1 &&
        rows[i + 1].getBoundingClientRect().top < row.getBoundingClientRect().bottom - 0.5);
      assert(!overlapping, "Virtualized diff rows overlap.");
      assert(document.documentElement.scrollWidth === innerWidth, "The page overflows horizontally.");
      assert(document.querySelector("header").getBoundingClientRect().height === 48, "The app header is not 48px.");
    }
    return { passed: true, viewport: innerWidth, offsets };
  } finally {
    region.scrollLeft = originalScroll;
  }
})();
