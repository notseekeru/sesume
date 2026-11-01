# resume

One page, one column, every number traceable to a run. A LaTeX resume and the
gate that keeps it to one page instead of shrinking margins until it fits.

## What is here

| Path | What it is |
| --- | --- |
| `RESUME.template.latex` | starter file: placeholder identity and example projects |
| `skills/resume/SKILL.md` | layout, typography and bullet rules |
| `skills/resume/scripts/check.sh` | compile and measure gate |
| `scripts/pi-history.sh` | pi session transcript, projected down to prose |
| `flake.nix` | texlive and poppler for the gate |

`RESUME.latex` is in `.gitignore`: your real one stays on your machine.

## Run the gate

```bash
cp RESUME.template.latex RESUME.latex   # once
nix develop
skills/resume/scripts/check.sh RESUME.latex
```

Without nix you need `latexmk`, `pdftotext` and `pdftoppm` on `PATH`.

The gate compiles into `build/` and reports pages, column fill, the worst
overfull box, bullets past two lines, and bullets whose last line is under half
the text width (a `runt`, the cheapest line to win back). It writes
`build/preview/page-1.png` to look at. It exits nonzero when the resume spills
past one page, a bullet runs three lines, or a box overflows more than 5pt.

Thresholds are environment overridable: `MAX_PAGES`, `MAX_BULLET_LINES`,
`MAX_OVERFULL_PT`, `MARGIN_IN`, `RUNT_FRACTION`, `DPI`.

The numbers cannot see everything. Typography, bullet shape and honesty rules
live in `skills/resume/SKILL.md`, and they are the part that makes an edit pay
for itself.

## pi session history

`scripts/pi-history.sh` reads `~/.pi/agent/sessions` and prints one line per
message, stripping tool results, tool arguments and scaffolding:

- `U|` user turns, including typed questionnaire answers
- `A|` assistant prose with no tool calls
- `T|` errored tool results, only with `--with-tools`

It needs `jq`. No LLM, deterministic. Sessions are read from
`$PI_SESSION_DIR`, defaulting to `~/.pi/agent/sessions`.

```bash
scripts/pi-history.sh --for "$PWD"            # newest session for a project
scripts/pi-history.sh --session <path|id>     # explicit session
scripts/pi-history.sh --grep <regex>          # newest session matching text
scripts/pi-history.sh --list                  # 25 most recent sessions
scripts/pi-history.sh --limit 4000            # per-message char cap
```

## Use the skill from pi

```bash
mkdir -p ~/.pi/agent/skills/resume
ln -sf "$PWD/skills/resume/SKILL.md" ~/.pi/agent/skills/resume/SKILL.md
ln -sfn "$PWD/skills/resume/scripts" ~/.pi/agent/skills/resume/scripts
```

## License

AGPL-3.0, see `LICENSE`.
