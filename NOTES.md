# Submission Notes

## Running the Project

The README instructions remain valid for this change:

```bash
npm install
docker compose up -d db
npm run migrate --workspace @mdcalc/api
npm run dev
```

The HEART Score page is available at
`http://localhost:3000/calculators/heart-score`, and the API endpoints live
under `http://localhost:4000/api/v1/calculators/heart-score`.

## Architecture

The main architectural choice was to keep the HEART Score contract in
`@mdcalc/shared`: zod validates the five scored inputs, TypeScript types are
shared by web and API, and the pure calculator owns score, band, and
interpretation logic. The web uses that package for immediate preview, but the
API still validates and recomputes everything before returning or saving a
calculation.

The API follows the existing router, controller, service, repository shape.
Controllers stay thin, services own calculation and persistence orchestration,
and the repository owns SQL plus snake_case to camelCase DTO mapping.

## Tradeoffs and Skipped Improvements

I did not add authentication, clinician identity, audit logging, rate limiting,
or patient-level clinical data modeling. Those would matter for a production
medical workflow, but they are outside the assignment scope and would add
contracts that the current exercise does not need.

I also kept the recent calculations refresh path local to the calculator
component instead of adding React Query, SWR, or another data-fetching
dependency. A small refresh token is enough for this page; a broader app with
more cache invalidation needs would justify a shared client data layer.

## Decision I Am Proud Of

The strongest decision is making persistence server-authoritative. The browser
can only submit the five input scores; the API recomputes the HEART Score result
with the shared calculator immediately before insert, so a client cannot tamper
with score, band, or interpretation.

## Area of Uncertainty

The current UI stores only scored categories, not richer clinical context such
as the exact troponin value, named risk factors, clinician, patient, or encounter.
That matches the assignment and keeps the calculator focused, but a real product
would need input from clinical and compliance stakeholders before deciding what
context should be captured and retained.

## Verification

Commands run during the implementation:

- `npm run test`
- `npm run test --workspace @mdcalc/api`
- `npm run test --workspace @mdcalc/shared`
- `npm run test --workspace @mdcalc/web`
- `npm run typecheck --workspace @mdcalc/shared`
- `npm run typecheck --workspace @mdcalc/web`
- `npm run typecheck --workspace @mdcalc/ui`
- `git diff --check`

Known verification limits:

- Root `npm run typecheck` was not green because the API workspace still has
  pre-existing TypeScript configuration issues around files outside `rootDir`
  and `pino-http` types.
- Root `npm run lint` was not used as a final gate because the repo does not
  currently include an ESLint config.
- I did not run a browser E2E flow or connect to a live Postgres instance for
  manual persistence verification in this final documentation iteration.
