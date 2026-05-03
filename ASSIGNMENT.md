# Take-Home Assignment — Senior Full Stack Developer

Welcome, and thanks for taking the time to work through this exercise. It is
designed to be representative of the kind of feature work that lands on our
backlog every sprint: a well-scoped clinical calculator that has to behave
correctly across the full stack.

**Expected time:** 3–4 focused hours. Please don't spend more than 6.
If you run out of time, stop and write a short note in `NOTES.md` about what
you would have done next.

---

## The scenario

A cardiologist on our clinical team has asked us to ship the **HEART Score
for Major Cardiac Events**. Emergency physicians use it to stratify chest-pain
patients into low, moderate, and high risk for a Major Adverse Cardiac Event
(MACE) within six weeks.

The score sums five inputs — **H**istory, **E**CG, **A**ge, **R**isk factors,
and **T**roponin — each 0, 1, or 2 points. The total (0–10) maps to a risk
band:

| Total | Band     | 6-week MACE risk |
| ----- | -------- | ---------------- |
| 0–3   | Low      | 0.9–1.7%         |
| 4–6   | Moderate | 12–16.6%         |
| 7–10  | High     | 50–65%           |

A full reference table of inputs and values is in
[`docs/heart-score-reference.md`](./docs/heart-score-reference.md). Treat that
document as the source of truth for the medical logic.

---

## What to build

Ship this feature end-to-end. You will touch four areas of the monorepo:

### 1. `packages/shared` — domain model

- Define the input shape, the calculation result, and a Zod schema that
  validates user input. Export them from the package entrypoint.
- Inputs and outputs must be reusable by both `apps/api` and `apps/web`
  without duplication.

### 2. `apps/api` — calculation service

- Implement `POST /api/v1/calculators/heart-score/calculate`.
  - Validates the payload against the shared Zod schema.
  - Returns `{ score, band, interpretation, inputs }` with a `200`.
  - Returns a structured `400` on invalid input.
- Implement `POST /api/v1/calculators/heart-score/calculations` that persists
  a calculation to Postgres and returns the stored row (with `id`,
  `created_at`).
- Implement `GET /api/v1/calculators/heart-score/calculations?limit=...` that
  returns the most recent N calculations (default 20, max 100).
- Add a SQL migration for the `heart_score_calculations` table.
- Unit-test the scoring function. Add at least one integration test for the
  `calculate` endpoint.

### 3. `apps/web` — clinician-facing UI

- Build a page at `/calculators/heart-score`:
  - A form with all five inputs (radio groups, labels, helper text).
  - Live score + band + interpretation, updating as inputs change.
  - A "Save calculation" button that calls the persistence endpoint and
    shows a success / error state.
  - A "Recent calculations" panel that reads from the list endpoint.
- Keep the UI accessible (labels, keyboard nav, sensible focus order).
  A clean, readable layout is enough — no need for a design system.

### 4. Docs & ops

- Update `docs/architecture.md` with a short section on how your feature is
  wired together (a paragraph and/or a sketch).
- If you change the environment contract, update `.env.example`.

---

## Ground rules

- TypeScript everywhere; no `any` unless justified with a comment.
- The scoring function must live in `packages/shared` or `apps/api` — never
  in the UI layer. The UI should call the shared function for the live preview.
- Use the existing folder conventions (controller / service / repository)
  in the API. If you disagree with them, leave a note in `NOTES.md`.
- You may add dependencies, but prefer what's already in the repo.
- Commit often with meaningful messages; we read the history.

---

## What we evaluate

1. **Correctness** — does the medical logic match the reference table?
2. **API design** — validation, status codes, error shape, idempotency thinking.
3. **Code quality** — boundaries between layers, naming, testability.
4. **Type safety** — shared contracts, no drift between client and server.
5. **UX polish** — does it feel like something a clinician could actually use?
6. **Judgment** — what you chose to cut, and why (see `NOTES.md`).

You are **not** evaluated on:

- Visual design beyond "clean and usable".
- Auth, rate limiting, or multi-tenant concerns — out of scope.
- Touching Terraform or deploying anywhere.

---

## Submitting

1. Work on a branch named `candidate/<your-name>`.
2. Push to the private repo we shared, or send a zip excluding `node_modules`.
3. Include a `NOTES.md` at the repo root covering:
   - How to run your changes (if different from the README).
   - Anything you skipped or would improve with more time.
   - One architectural decision you're proud of and one you're unsure about.

Good luck — we're looking forward to reading your code.
