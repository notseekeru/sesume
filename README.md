# resume

One page, one column, every number traceable to a run. A LaTeX resume and the
gate that keeps it to one page instead of shrinking margins until it fits.

## What is here

| Path                             | What it is                                                   |
| -------------------------------- | ------------------------------------------------------------ |
| `RESUME.template.latex`          | starter file: placeholder identity and example projects      |
| `skills/resume/SKILL.md`         | layout, typography and bullet rules                          |
| `skills/resume/scripts/check.sh` | compile and measure gate                                     |
| `scripts/pi-history.sh`          | pi session transcript, projected down to prose               |
| `scripts/port-claimer.sh`        | frees a port from another compose project before `make up`   |
| `backend/`                       | Hono API under `/api`, pg pool                               |
| `frontend/`                      | Vite + React shell, dev server proxies `/api` to the backend |
| `compose.yml`                    | backend, frontend and postgres                               |
| `compose.prod.yml`               | prod image targets, `DATABASE_URL` from the environment      |
| `flake.nix`                      | dev shell for the gate and the web shell                     |
| `.pi/`                           | playwright MCP over the dev stack, plus repo-local skills    |

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

## Web shell

```bash
make build
make up     # postgres, backend on 4100, frontend on 5373
```

Ports and database credentials default to 5373, 4100, 5433 and `sesume`; copy
`.env.example` to `.env` to change them. `make up` frees those ports first,
stopping whichever compose project holds them. `make psql` opens the dev
database. `make clean` deletes that database's volume. The target list is in
the `Makefile`, the services in `compose.yml`.

Anyone who reaches the app can register an account; sessions are an HttpOnly
cookie signed with `AUTH_SECRET`.

The `prod` targets build without dev dependencies and the backend runs `dist/`,
not `tsx`. They serve on 8080 (nginx) and 4100, and there is no database
container: production expects a DSN from outside. `cd-pipeline.yml` builds
these targets on `main`, scans and boots them, then pushes the two images to
GHCR tagged with the commit.

```bash
DATABASE_URL=postgresql://sesume:sesume@host.docker.internal:5433/sesume \
  docker compose -f compose.prod.yml up -d --build
docker exec sesume_backend_prod npm run migrate:up   # once the database is empty
```

To run outside Docker, `nix develop`, then `npm ci && npm run dev` in
`backend/` and `frontend/`. The backend reads `DATABASE_URL` from
`backend/.env`, which points at the port `make up` publishes.

Run `lint` through `make lint`: biome's prebuilt binary wants an FHS loader
that NixOS does not provide.

## License

AGPL-3.0, see `LICENSE`.
