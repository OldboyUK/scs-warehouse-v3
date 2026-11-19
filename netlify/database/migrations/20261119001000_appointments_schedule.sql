-- Allow appointment bookings and week settings beside production and blending.
-- Existing rows stay on their current schedule kind.

ALTER TABLE schedule_bookings DROP CONSTRAINT schedule_bookings_kind_check;
ALTER TABLE schedule_bookings DROP CONSTRAINT schedule_bookings_kind_category_check;
ALTER TABLE schedule_weeks DROP CONSTRAINT schedule_weeks_kind_check;

ALTER TABLE schedule_bookings
  ADD CONSTRAINT schedule_bookings_kind_check
  CHECK (schedule_kind IN ('production', 'blending', 'appointments'));

ALTER TABLE schedule_bookings
  ADD CONSTRAINT schedule_bookings_kind_category_check
  CHECK (
    (schedule_kind = 'production' AND category IN ('bottles', 'keg', 'owk', 'bibs', 'bulk'))
    OR
    (schedule_kind = 'blending' AND category IN ('base_in', 'filtering', 'blending', 'bulk_out'))
    OR
    (schedule_kind = 'appointments' AND category IN ('scs', 'management', 'qc_blending', 'warehouse_logistics', 'engineering'))
  );

ALTER TABLE schedule_weeks
  ADD CONSTRAINT schedule_weeks_kind_check
  CHECK (schedule_kind IN ('production', 'blending', 'appointments'));
