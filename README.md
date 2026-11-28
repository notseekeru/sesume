# resume

## What is here

| Path               | What it is                                                   |
| ------------------ | ------------------------------------------------------------ |
| `backend/`         | Hono API under `/api`, pg pool                               |
| `frontend/`        | Vite + React shell, dev server proxies `/api` to the backend |
| `compose.yml`      | backend, frontend and postgres                               |
| `compose.prod.yml` | prod image targets, `DATABASE_URL` from the environment      |
| `flake.nix`        | dev shell for the web shell and playwright MCP               |
| `.pi/`             | playwright MCP over the dev stack, plus repo-local skills    |

## Web shell

```bash
make build
make up     # postgres, backend on 4100, frontend on 5373
```

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
