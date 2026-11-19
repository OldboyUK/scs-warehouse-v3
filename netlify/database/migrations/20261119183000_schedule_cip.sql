-- CIP blocks are a production-only block type. Existing rows stay ordinary bookings.

ALTER TABLE schedule_bookings
  ADD COLUMN block_type text NOT NULL DEFAULT 'booking';

ALTER TABLE schedule_bookings
  ADD CONSTRAINT schedule_bookings_block_type_check
  CHECK (
    block_type = 'booking'
    OR (block_type = 'cip' AND schedule_kind = 'production')
  );
