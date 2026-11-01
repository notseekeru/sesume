---
name: resume
description: Keeps RESUME.latex on one page and keeps every claim auditable. Runs the compile gate, reports pages, page fill, the worst overfull box and the longest bullet, renders a page image to look at, and holds the layout and bullet rules so an edit pays for itself instead of shrinking margins.
---

# resume

One page, one column, every number traceable to a run.

## The gate

`skills/resume/scripts/check.sh` compiles, then reports pages, page fill, the worst overfull
box, bullets past two lines, and the bullets whose last line is a stub. It exits
nonzero when the resume spills, a bullet runs three lines, or a box overflows
more than 5pt.

```bash
nix develop            # for latexmk, pdftotext, pdftoppm
skills/resume/scripts/check.sh RESUME.latex
```

Then open `build/preview/page-1.png` once. The numbers catch spill; the image
catches uneven spacing between blocks, a section that hugs the one above it, or
a last line with one word on it.

## Layout budget

- One page. The PDF is the deliverable, not the tex.
- Margins stay at 0.5in or wider, body at 10pt or larger. Buying space this way
  breaks the one-page rule in spirit and reads as cramped.
- Three to four bullets per project, two to three lines each.
- Every addition is paid for by a cut, named in the same plan.
- Keep the `\vspace{2pt}` between blocks. Equal spacing is what makes a dense
  page look built instead of stuffed.

## Typography and parsing

- `[T1]{fontenc}` stays. Without it the text layer breaks on accented glyphs and
  an ATS reads garbage.
- Single column, no tabular skills grid, no icons. Those survive the eye and
  fail the parser.
- Dates sit on the title line with `\hfill`, never in a side rail.
- Check the text layer, not just the PDF. `pdftotext build/RESUME.pdf -` must
  return the name first, then sections in reading order. A word broken across a
  line comes back joined, which is why `App-of-Apps` sits in `\mbox{}`.
- `pdfauthor` and `pdftitle` stay set. `pdfpagemode=FullScreen` stays out.

## Bullet composition

- One line, two at most. A third line means two ideas or inflation. Split it or
  cut it, never shrink the font to keep it.
- The half line trick is the cheapest space on the page. When a bullet's last
  line is under half the text width, cutting three to six words pulls the stub
  up into the line above and frees a whole line. The gate lists those bullets as
  `runt`, along with the words to attack. This is how a page gains room without
  losing a claim.
- XYZ: accomplished X, as measured by Y, by doing Z. The metric lands in the
  first clause, where a six second scan will hit it.
- Readable by someone who does not know the stack. Name the metric, then say what
  it means in plain words. `Cut p95 latency from 3.44s to 1.90s` needs no
translation. `Cut p95 on the OTLP histogram via pool trimming` does.
- Keep one tool named in the bullet, the one that proves the claim. The Skills
  section already carries the rest.
- Verb first. No "Responsible for", no noun openers.
- A number beats no number: measure it from a run, a log or a doc when you
  can, and mark an estimate as one when you cannot.
- No em dashes, no semicolons, no colons inside a bullet. Two clauses and a
  number is the whole shape.
- No story. No "which turned out to be", no asides, no clause that exists to
  sound like a person talking. The bullet states the work and the result.
- No inflation. Do not upgrade a contribution into ownership, do not round a
  measurement up, and never present an estimate as measured.
- Two bullets sharing a subject get merged before a new one is added.
- Uneven clause lengths are fine and preferable. Four bullets opening the same
  way is the tell recruiters name.
- Skills: 8 to 12 terms that survive an interview, grouped, no two entries for
  one job.

## Order and honesty

- Lead with the strongest evidence for the target role, not the oldest project.
- Verify a number against the system that owns it, not a doc that summarizes it.
  A README count is a lower bound. The secret store, the log or the command
  output is the source, and the bullet quotes what that returned. A key count
  comes from the store that holds them, not the README table.
- A benchmark unit is not a user. Name the unit the tool measured, virtual users
  or requests a second, and never translate it into people. `55 virtual users`
  is true, `55 concurrent interviews` is not, and the doc that ran the test says
  so in its own words.
- A claim here must match the public copy of the same claim, the portfolio card
  or the repo docs. When they disagree, stop and ask which is true.
- No invented dates, no invented recency. Ask.

## Procedure

1. Read `RESUME.latex` and the evidence behind the bullet being touched.
2. Propose the exact before and after. Get one yes. Propose only the bullets the
   gate failed or the user named. A rewrite nobody asked for is a nitpick.
3. Edit, then run `skills/resume/scripts/check.sh`.
4. Read the preview PNG and the `pdftotext` output.
5. Report pages, fill, the worst box, the runts, and what was cut to pay for the
   change.

## Never

- Shrink margins or font to fit one page.
- Add a section or bullet without naming what it replaces.
- Reword a line that already works, or rewrite a bullet because it could read
  better. Rewrite only when asked, when the claim is wrong, or when the gate
  fails.
- Render a PDF with a browser. Headless Chromium cannot display one, so
  `pdftoppm` is the tool and Playwright only adds a worse screenshot.

## Improving this file

A failure no rule here anticipated is a missing rule. When one shows up, propose
the exact line for this file in the same reply and name the failure it prevents,
then wait for a yes. Never add a rule silently, and never propose one that
restates a rule already above. One line per rule. A rule that needs a paragraph
is two rules.
