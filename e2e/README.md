# End-to-end tests

Drives the real compiled `null-notes.exe` with WebdriverIO — see
`docs/specs/e2e-testing-design.md` for why, and
`.claude/skills/e2e-verify/SKILL.md` for how to add a new spec.

## Running

    npm run test:e2e                                     # whole suite
    npm run test:e2e -- --spec e2e/specs/<name>.e2e.ts    # one spec

The first run installs `tauri-driver` (via `cargo install`) and downloads
the `msedgedriver` build matching your installed Edge version — both are
one-time, cached by `@wdio/tauri-service`'s `autoInstallTauriDriver` and
`autoDownloadEdgeDriver` options in `wdio.conf.ts`. `npm run test:e2e`
always rebuilds the app first via the `pretest:e2e` script (`npm run tauri
build -- --debug`, not plain `cargo build` — a plain debug build loads the
Vite dev server URL instead of the bundled frontend, and nothing is serving
that URL during a test run).

Every spec shares one fixture workspace directory — see the comment in
`fixtureWorkspace.ts` for why it's a fixed path rather than a fresh
`mkdtemp`'d one per run — so a spec should clean up whatever files it
expects to assert on at the start of its own test, not assume a blank slate.

Specs covering anything with a visible surface should also call
`screenshot()` (`screenshot.ts`) so a person can actually look at the
result — DOM assertions can't catch a clipped label or a broken layout.
Screenshots land in `e2e/.artifacts/` (gitignored); `start e2e\.artifacts`
opens the folder after a run. See `.claude/skills/e2e-verify/SKILL.md`'s
"Visual verification" section.

`@wdio/tauri-service`'s official driver has occasional per-command timing
flakiness in this environment unrelated to app behavior (see
`mochaOpts.retries` in `wdio.conf.ts`). A test failing once and passing on
retry is that; a test failing consistently is a real bug.
