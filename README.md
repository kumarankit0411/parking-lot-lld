# Smart parking lot - LLD assignment

Design for a multi-floor parking lot: entry and exit handling, spot allocation
by vehicle size, fee calculation, and live availability.

## Start here

| What | Where |
|---|---|
| Design document (main deliverable) | [docs/DESIGN.pdf](docs/DESIGN.pdf), or [docs/DESIGN.md](docs/DESIGN.md) for the source |
| Database design | [docs/schema.sql](docs/schema.sql) |
| Implementation | [src/service/parkingService.ts](src/service/parkingService.ts) |
| Tests | [tests/](tests/) |

The PDF and the markdown are the same document. The PDF is there so the
diagrams render without a Mermaid plugin.

## Where to look

If you only have ten minutes:

1. `docs/DESIGN.md` sections 3 and 5. Allocation and concurrency are the two
   decisions the rest of the design hangs off.
2. `docs/schema.sql`. The two partial unique indexes on `tickets` are what make
   double booking impossible, whatever the application code does.
3. `tests/concurrency.test.ts`. The races are forced on purpose rather than
   described.

## What is implemented

- Check-in, check-out and availability reporting.
- Best-fit allocation, with a retry when a claim loses a race.
- Hourly billing with rounding, a one hour minimum, a daily cap and a grace
  period.
- Spot, ticket and payment state changes enforced inside the entities.
- In-memory repositories that apply the same uniqueness rules as the SQL.
- Tests for lost claims, duplicate entry, double checkout and payment failure.

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

## What is not here

No HTTP layer, no database driver, no payment gateway, no Docker setup. The
design covers each of them; the code stops at the parts that are specific to
this problem - the model, the allocation rule, the fee rule and the failure
cases.
