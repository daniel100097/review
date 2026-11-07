# Flowmark upstream files

Source: https://github.com/daniel100097/flowmark
Revision: `ea687064a93ccf70d2d3234a63877032889dcdf8` (2026-11-07).

`viewer.js.txt`, `viewer.css.txt`, `spec.txt` (upstream `SPEC.md`), `prelude.txt` (upstream `prelude.d.ts`),
and `example.txt` (upstream `examples/register-user.review.ts`) are unmodified
upstream files. `flowmark.wasm` is built from that revision with its locked
dependencies and Rust toolchain using `cargo build -p flowmark_wasm --target
wasm32-unknown-unknown --profile wasm --locked`.

The generation prompt includes the upstream `skills/flowmark-review/SKILL.md`,
its `reference/levels.md` guide, prelude, and both examples. These are bundled
as `SKILL.md.txt`, `levels.txt`, `prelude.txt`, `example.txt`, and `rpc-example.txt`.
`typescript-libs.json` contains the TypeScript 5.9.3 ES2022 standard library
declarations (MIT, copyright headers preserved), taken from the pinned
`typescript-flowmark` dependency. These let the backend run the skill's strict
prelude typecheck from a closed virtual filesystem, also in the standalone app.

The backend runs the WASM parser in a disposable subprocess. The frontend
embeds the original viewer in a sandboxed iframe so its keyboard shortcuts,
CSS, and level URL fragments stay inside the review.

Run `bun scripts/update-flowmark.ts` to reproduce these assets. Updating the
pinned revision is an explicit change to that script and this document.
