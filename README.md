# Smart parking lot - LLD assignment

Entry/exit handling, spot allocation and fee calculation for a multi-floor lot.
The design writeup lives here: **[docs/DESIGN.md](docs/DESIGN.md)**.
The schema it targets is in [docs/schema.sql](docs/schema.sql).

## Running it

```bash
npm install
npm test          # unit + concurrency suite
npm run typecheck # strict TS, no emit
```

Node 20 or newer. No runtime dependencies - only TypeScript and Vitest.

There is no application entrypoint and no server. The only way to exercise the
code is the test suite, and the repositories are in memory, so nothing survives
the process.

## What is actually implemented

- `checkIn` / `checkOut` / `availability` in `src/service/parkingService.ts`
- Best-fit allocation with a ranked candidate list and claim retries
- Hourly billing with rounding, minimum hour, daily cap, grace period
- Spot, ticket and payment state transitions inside the entities
- In-memory repositories that enforce the same uniqueness rules as the SQL
  partial indexes, so the service cannot rely on single-threaded behaviour
- Tests that force the races on purpose: lost claims, duplicate entry,
  double checkout, and a failed ticket write that would otherwise leak a spot

## What is not here

There is no HTTP layer, no database driver, no payment gateway and no Docker
setup. Each of those is a translation of something that is already designed, and
adding them would have meant less time on the parts that are actually graded:
the model, the allocation rule, the fee rule, and the failure cases.

## Layout

```
src/domain/       entities, value objects, errors
src/allocation/   ranking strategies
src/pricing/      rate table, fee calculator
src/ports/        interfaces the service depends on
src/infra/        in-memory implementations
src/service/      orchestration
tests/            unit and concurrency tests
docs/             design document, SQL schema
docs/diagrams/    diagram sources (.mmd) and exported PNGs
```

## Diagrams and PDF

The design doc uses PNGs, so the diagrams render on GitHub, in VS Code preview
and in a PDF export without any extra tooling. The Mermaid sources are next to
them in `docs/diagrams/`.

`docs/DESIGN.pdf` is a pre-built export (13 pages) using `docs/pdf.css`. To
rebuild it after editing the doc:

```bash
npx -y md-to-pdf --css docs/pdf.css docs/DESIGN.md
```

To change a diagram and regenerate it:

```bash
npx -y @mermaid-js/mermaid-cli \
  -i docs/diagrams/class-diagram.mmd \
  -o docs/diagrams/class-diagram.png \
  -b white -s 2
```

## Rates

INR, stored as integer paise. Motorcycle ₹10/h (₹100 cap), car ₹30/h (₹300),
bus ₹60/h (₹600). They live in `DEFAULT_PRICING` and in the seed data at the
bottom of `schema.sql`; a test keeps the two honest.
