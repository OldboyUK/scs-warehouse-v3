-- Separate blending bookings and week settings from the production schedule.
-- Existing rows stay production through the column default.

ALTER TABLE schedule_bookings
  ADD COLUMN schedule_kind text NOT NULL DEFAULT 'production',
  ADD COLUMN free_text text NOT NULL DEFAULT '';

ALTER TABLE schedule_bookings DROP CONSTRAINT schedule_bookings_category_check;

ALTER TABLE schedule_bookings
  ADD CONSTRAINT schedule_bookings_kind_check
  CHECK (schedule_kind IN ('production', 'blending'));

ALTER TABLE schedule_bookings
  ADD CONSTRAINT schedule_bookings_kind_category_check
  CHECK (
    (schedule_kind = 'production' AND category IN ('bottles', 'keg', 'owk', 'bibs', 'bulk'))
    OR
    (schedule_kind = 'blending' AND category IN ('base_in', 'filtering', 'blending', 'bulk_out'))
  );

CREATE INDEX schedule_bookings_kind_week_idx
  ON schedule_bookings (schedule_kind, week_commencing);

ALTER TABLE schedule_weeks
  ADD COLUMN schedule_kind text NOT NULL DEFAULT 'production';

ALTER TABLE schedule_weeks DROP CONSTRAINT schedule_weeks_pkey;

ALTER TABLE schedule_weeks
  ADD PRIMARY KEY (week_commencing, schedule_kind);

ALTER TABLE schedule_weeks
  ADD CONSTRAINT schedule_weeks_kind_check
  CHECK (schedule_kind IN ('production', 'blending'));
