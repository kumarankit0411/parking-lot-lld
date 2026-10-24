# Smart parking lot - LLD assignment

Entry and exit handling, spot allocation by vehicle size, fee calculation and
availability for a multi-floor lot.

## The design

`docs/DESIGN.pdf` is the document to read. `docs/DESIGN.md` has the same content
as markdown if you would rather read it there; the PDF exists so the diagrams
render without a plugin.

Sections 3 and 5 are the important ones: how a spot gets chosen, and what
happens when two cars arrive at once. Section 8 says what the design does not
cover.

## The database

`docs/schema.sql` is the Postgres schema the design targets. Worth checking are
the two partial unique indexes on `tickets`: they stop a spot, or a vehicle, from
having two open tickets at the same time, whatever the application code does.

## The code

`src/` follows the document. `src/service/parkingService.ts` is the entry and
exit flow, with allocation and pricing in `src/allocation/` and `src/pricing/`.
The service covers check-in, check-out, availability, best-fit allocation with a
retry when a claim loses a race, and hourly billing with a daily cap.

The tests are in `tests/`. `tests/concurrency.test.ts` sets up the races the
design talks about, including a claim that loses to another car.

## Running the tests

```bash
npm install
npm test
npm run typecheck
```

Node 20 or newer. TypeScript and Vitest are the only dependencies.

There is no application entrypoint and no server. The only way to exercise the
code is the test suite, and the repositories are in memory, so nothing survives
the process.

## Scope

No HTTP layer, no database driver, no payment gateway, no Docker setup. The
design covers those; the code stays with the parts specific to this problem.
