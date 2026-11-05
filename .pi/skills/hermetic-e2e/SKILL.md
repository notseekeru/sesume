---
name: hermetic-e2e
description: >-
  Drive a real headless browser against the running frontend through the `playwright` MCP server,
  called from a codemode script. Load when a UI change must be seen in a real browser or a rendering
  bug needs repro-ing with no human at the keyboard.
---

# Hermetic E2E

One path: the `playwright` MCP server, called from codemode. No node runner, host script, or CJS.
Target is the real frontend at `localhost:5373` and the real backend at `localhost:4100`.

## Call shape

`.pi/mcp.json` leaves `exposure` unset, so playwright takes pi's default, `codemode`: its tools are
neither declared to the model nor listed in the codemode description. Reach them as
`tools.mcp__playwright__browser_*(...)` inside a codemode script.

```js
await tools.mcp__playwright__browser_navigate({ url: "http://localhost:5373/" });
const res = await tools.mcp__playwright__browser_evaluate({
  function: "() => document.querySelector('main h1').textContent", // a STRING, page scope
  filename: "probe.json", // optional: saves the result to a cwd-relative file
});
```

- `function` is a string expression evaluated in the page. It cannot import and cannot close over
  codemode state; build multi-line JS by concatenation.
- A call returns `### Result\n"..."\n### Ran Playwright code ...`. Slice between `### Result` and
  `### Ran` before parsing, or `JSON.parse` chokes on the escaped echo.
- `filename` writes relative to pi's cwd (the repo root), not `.playwright-mcp/`. Delete the file
  before committing.
- Loop and branch inside one codemode script rather than making N calls.

## Browsing rules

- Snapshot once and gate the next read on `browser_wait_for`; `browser_snapshot` dumps the whole accessibility tree into context.
- `target` takes a snapshot ref (`e8`) or a unique CSS selector.
- Tool names carry the server prefix: a bare `browser_navigate` is "Tool not found".
- `browser_run_code_unsafe` runs arbitrary JS in the server process (RCE-equivalent). Reach for it
  only when the typed verbs cannot do the job.
- A locator timeout on the landing page usually means the SPA never mounted, not a stale selector:
  count the `#root` children with `browser_evaluate` before blaming the selector.

## Routes

1. `/`: wait for `.studio`. With no saved resume the page shows `main.welcome`, otherwise the three panes.
2. Empty state: click **Paste resume instead**, type into `input.name` and `textarea.input`, click `.bar button.primary`, then assert `.state` reads `Saved` and a `.chip` exists.
3. Click **Convert to LaTeX** and wait for a `.pdf-page` canvas. The PDF panel renders through pdfjs, so there is no browser viewer chrome.
4. Review panel: the panel needs a provider. Fill the three `.provider input` fields and press `.review-head button.primary`; assert `.badge` and `.rungs`/`.rung` render.
5. Layout: press a `.toggle` to hide a panel, drag a `.splitter` and assert the pane widths change, then reload and assert they survived.
6. `/missing`: assert `main h1` reads `Not found`.

## Preconditions

- Dev stack up: `make up`. `/` on 5373 and `/api/healthz` on 4100 must answer 200.
- No auth: nothing in this app gates a route.
- The entry runs `direnv exec . playwright-mcp`, so the cached flake shell supplies the binary from
  any host shell. `.envrc` must be allowed once (`direnv allow`); otherwise the server fails at
  session start and `pi mcp list` says so.
- Adding or changing a server mid-session needs `/reload`.

## After a run

```sh
make lint   # biome write in both containers
make exec   # biome, tsc and audit in both containers
```

## Guardrails

- `.playwright-mcp/` and any `filename` result file are throwaway and gitignored: never commit them.
  Artifacts land relative to pi's cwd, so a run from another repo litters that tree.
- No host `npm install`.
