# MDCalc — Senior Full Stack Take-Home

A trimmed-down monorepo that mirrors the shape of our production stack.
Use this repo as the starting point for the take-home assignment described
in [`ASSIGNMENT.md`](./ASSIGNMENT.md).

## Stack

| Area            | Technology                                   |
| --------------- | -------------------------------------------- |
| Web             | Next.js 14 (App Router), React 18, TypeScript |
| API             | Node.js, Express 4, TypeScript               |
| Database        | PostgreSQL 15                                |
| Shared packages | TypeScript (compiled), Zod                   |
| Tooling         | npm workspaces, ESLint, Prettier, Vitest     |
| Infra           | Docker, Docker Compose, Terraform (stub)     |

## Repository layout

```
mdcalc-24/
├── apps/
│   ├── api/              Express API (port 4000)
│   └── web/              Next.js app (port 3000)
├── packages/
│   ├── shared/           Cross-cutting types, zod schemas, constants
│   └── ui/               Presentational React component kit
├── infra/
│   ├── docker/           Service Dockerfiles
│   └── terraform/        IaC stub (not required for the assignment)
├── docs/                 Architecture notes
├── docker-compose.yml    Postgres + API + Web for local dev
├── package.json          npm workspaces root
└── tsconfig.base.json    Shared compiler options
```

## Getting started

Prerequisites: Node 20+, npm 10+, Docker Desktop.

```bash
npm install
docker compose up -d db       # start Postgres on :5432
npm run migrate --workspace @mdcalc/api
npm run dev                    # runs api + web concurrently
```

- Web: <http://localhost:3000>
- API: <http://localhost:4000/health>

## Useful scripts

```bash
npm run lint          # eslint across all workspaces
npm run typecheck     # tsc --noEmit across all workspaces
npm run test          # vitest across all workspaces
npm run build         # production build for api + web + shared
```

## Where to start

Open [`ASSIGNMENT.md`](./ASSIGNMENT.md). The files you need to touch are
marked with `// TODO(candidate):` comments.
