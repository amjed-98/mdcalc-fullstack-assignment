# Architecture

## Overview

```
[ Browser ]
     │
     ▼
[ Next.js web @ :3000 ]  ──HTTP──▶  [ Express api @ :4000 ]  ──▶  [ Postgres @ :5432 ]
                                         │
                                         └──▶ @mdcalc/shared (calc + schemas)
```

- **`apps/web`** — Next.js App Router UI. Renders calculator pages and calls
  the Express API via `lib/api/*`. Imports domain types, schemas, and the
  pure calculation function from `@mdcalc/shared` to drive the live preview.
- **`apps/api`** — Express server with a `controller → service → repository`
  layering inside each domain module. Validates payloads with zod schemas
  imported from `@mdcalc/shared`.
- **`packages/shared`** — the single source of truth for types, zod schemas,
  and pure calculation functions. Importable from both apps.
- **`packages/ui`** — tiny presentational kit (Button, Card, RadioGroup).
- **`infra`** — Dockerfiles for local compose; Terraform stub.

## Conventions

- Every domain module in the API is a folder with `router`, `controller`,
  `service`, `repository`. Controllers are thin; services own orchestration;
  repositories own SQL.
- Everything that flows over the wire must be described by a zod schema in
  `@mdcalc/shared`. The same schema is reused in the UI for client-side
  validation before submit.
- Errors leave the API in the shape `{ error: { code, message, details? } }`.

## Candidate: add your feature notes here

<!-- TODO(candidate): describe how your HEART Score feature is wired. -->
