-- Smart parking lot - PostgreSQL schema
--
-- Conventions:
--   * money is integer paise, never numeric/float
--   * timestamps are timestamptz, stored in UTC
--   * enums instead of free text for anything that drives behaviour
--
-- The two things to look at first are the partial unique indexes on tickets
-- (around line 90). They are what make double-booking impossible even if the
-- application logic has a bug.

CREATE TABLE parking_lots (
  id         UUID PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE floors (
  id           UUID PRIMARY KEY,
  lot_id       UUID NOT NULL REFERENCES parking_lots (id) ON DELETE CASCADE,
  floor_number INT NOT NULL,
  UNIQUE (lot_id, floor_number)
);

CREATE TYPE spot_type AS ENUM ('MOTORCYCLE', 'COMPACT', 'LARGE');
CREATE TYPE spot_status AS ENUM ('AVAILABLE', 'OCCUPIED', 'OUT_OF_SERVICE');

CREATE TABLE parking_spots (
  id           UUID PRIMARY KEY,
  floor_id     UUID NOT NULL REFERENCES floors (id) ON DELETE CASCADE,
  floor_number INT NOT NULL,             -- denormalised: the allocator always
                                         -- orders by it, and this keeps the hot
                                         -- query on a single table
  code         TEXT NOT NULL,            -- 'F2-C07', the number painted on the floor
  spot_type    spot_type NOT NULL,

  -- Generated so it can never drift from spot_type. Mirrors SPOT_CAPACITY in
  -- src/domain/types.ts.
  capacity     SMALLINT GENERATED ALWAYS AS (
                 CASE spot_type
                   WHEN 'MOTORCYCLE' THEN 1
                   WHEN 'COMPACT'    THEN 2
                   ELSE 3
                 END) STORED,

  status       spot_status NOT NULL DEFAULT 'AVAILABLE',
  UNIQUE (floor_id, code)
);

-- Allocation and availability both read this index only.
CREATE INDEX ix_spot_allocation
  ON parking_spots (status, capacity, floor_number, code);

CREATE TYPE vehicle_type AS ENUM ('MOTORCYCLE', 'CAR', 'BUS');

-- The registry earns its place by keeping a returning plate's class and by
-- giving history an FK target. It is not a customer record.
CREATE TABLE vehicles (
  id            UUID PRIMARY KEY,
  license_plate TEXT NOT NULL UNIQUE,
  vehicle_type  vehicle_type NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TYPE ticket_status AS ENUM ('ACTIVE', 'CLOSED', 'ABANDONED');

CREATE TABLE tickets (
  id            UUID PRIMARY KEY,
  vehicle_id    UUID NOT NULL REFERENCES vehicles (id),
  spot_id       UUID NOT NULL REFERENCES parking_spots (id),
  entry_at      TIMESTAMPTZ NOT NULL,
  exit_at       TIMESTAMPTZ,

  -- frozen at checkout so a later price change cannot rewrite an old bill
  billed_hours  INT,
  amount_paise  BIGINT,
  rate_snapshot JSONB,

  status        ticket_status NOT NULL DEFAULT 'ACTIVE',

  CONSTRAINT ck_ticket_time_forward
    CHECK (exit_at IS NULL OR exit_at >= entry_at),

  -- a closed ticket must carry its money
  CONSTRAINT ck_ticket_closed_has_amount
    CHECK (status = 'ACTIVE'
           OR (exit_at IS NOT NULL AND amount_paise IS NOT NULL))
);

-- One spot can only be held by one open ticket. A car cannot be in two places.
CREATE UNIQUE INDEX ux_ticket_active_spot
  ON tickets (spot_id) WHERE status = 'ACTIVE';

-- And one car can only hold one open ticket.
CREATE UNIQUE INDEX ux_ticket_active_vehicle
  ON tickets (vehicle_id) WHERE status = 'ACTIVE';

-- "where has this car been" - cheap history lookup
CREATE INDEX ix_ticket_vehicle_history ON tickets (vehicle_id, entry_at DESC);

CREATE TYPE payment_method AS ENUM ('CASH', 'CARD', 'UPI');
CREATE TYPE payment_status AS ENUM ('PENDING', 'SUCCESS', 'FAILED');

CREATE TABLE payments (
  id              UUID PRIMARY KEY,
  ticket_id       UUID NOT NULL REFERENCES tickets (id),
  amount_paise    BIGINT NOT NULL CHECK (amount_paise >= 0),
  method          payment_method NOT NULL,
  status          payment_status NOT NULL,
  -- client-supplied retry key; the unique index makes retries harmless
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at         TIMESTAMPTZ
);

-- Failed attempts may stack up; only one of them can be money in the bank.
CREATE UNIQUE INDEX ux_payment_settled
  ON payments (ticket_id) WHERE status = 'SUCCESS';

CREATE TABLE pricing_rules (
  vehicle_type    vehicle_type PRIMARY KEY,
  hourly_paise    INT NOT NULL CHECK (hourly_paise >= 0),
  daily_cap_paise INT CHECK (daily_cap_paise IS NULL OR daily_cap_paise >= 0),
  grace_minutes   INT NOT NULL DEFAULT 0 CHECK (grace_minutes >= 0),
  currency        CHAR(3) NOT NULL DEFAULT 'INR',
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO pricing_rules (vehicle_type, hourly_paise, daily_cap_paise) VALUES
  ('MOTORCYCLE',  1000,  10000),   -- ₹10/hour, ₹100 a day
  ('CAR',         3000,  30000),   -- ₹30/hour, ₹300 a day
  ('BUS',         6000,  60000);   -- ₹60/hour, ₹600 a day

-- ---------------------------------------------------------------------------
-- The two statements the service runs. Kept here as a reference for whoever
-- replaces the in-memory repositories.
-- ---------------------------------------------------------------------------

-- 1. Find and claim a spot in one shot.
--    SKIP LOCKED is what lets 50 cars check in at the same second without
--    queueing behind each other: each transaction locks a different row.
--
--    UPDATE parking_spots
--       SET status = 'OCCUPIED'
--     WHERE id = (
--       SELECT id FROM parking_spots
--        WHERE status = 'AVAILABLE'
--          AND capacity >= $1              -- 1 / 2 / 3 for the vehicle
--        ORDER BY floor_number, capacity, code
--        FOR UPDATE SKIP LOCKED
--        LIMIT 1
--       )
--    RETURNING id;
--
-- 2. Close a ticket exactly once.
--    UPDATE tickets
--       SET status = 'CLOSED', exit_at = $2,
--           billed_hours = $3, amount_paise = $4
--     WHERE id = $1 AND status = 'ACTIVE';
--    -- affected rows = 0 means another checkout already won; return that one.
