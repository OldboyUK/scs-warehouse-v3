-- How many production lanes a CIP block covers, starting at its category.
-- Ordinary bookings stay on one lane.

ALTER TABLE schedule_bookings
  ADD COLUMN lane_span integer NOT NULL DEFAULT 1;

ALTER TABLE schedule_bookings
  ADD CONSTRAINT schedule_bookings_lane_span_check
  CHECK (
    lane_span >= 1
    AND lane_span <= 5
    AND (block_type = 'cip' OR lane_span = 1)
  );
