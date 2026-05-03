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

## HEART Score Data Flow

The HEART Score implementation is centered on `@mdcalc/shared`. That package
defines the five scored inputs with zod, exports the shared TypeScript types,
and owns the pure `calculateHeartScore` function that maps validated inputs to
score, risk band, interpretation, and echoed inputs. The web app imports that
same calculator for the live preview, while the API imports the same schema and
calculator so browser-provided results are never trusted.

```
[ HeartScoreCalculator client component ]
       |
       |-- live preview via @mdcalc/shared/calculateHeartScore
       |
       `-- POST/GET through apps/web/src/lib/api/heart-score.ts
                         |
                         v
[ Express router ] --validateBody(heartScoreInputSchema)--> [ controller ]
                         |                                      |
                         v                                      v
                [ heart-score.service ] -------------> calculateHeartScore
                         |
                         v
              [ heart-score.repository ]
                         |
                         v
        [ heart_score_calculations Postgres table ]
```

`POST /api/v1/calculators/heart-score/calculate` validates the request body at
the router boundary and returns the shared calculation result without touching
the database. `POST /api/v1/calculators/heart-score/calculations` follows the
same validation path, then the service recomputes score, band, and
interpretation before persistence. The repository inserts only server-computed
results and maps database `created_at` rows back to the camelCase DTO used by
the web app.

Recent calculations are intentionally bounded at the HTTP layer:
`GET /api/v1/calculators/heart-score/calculations` defaults to 20 rows and
rejects non-integer, less-than-one, or greater-than-100 limits before repository
access. The Next.js route keeps page metadata server-rendered, and the
interactive form, save state, and recent-list refresh token live in the client
HEART Score component.
