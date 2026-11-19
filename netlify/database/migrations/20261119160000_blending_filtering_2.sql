-- Add the second blending filter lane. Existing filtering bookings stay on filtering.

ALTER TABLE schedule_bookings DROP CONSTRAINT schedule_bookings_kind_category_check;

ALTER TABLE schedule_bookings
  ADD CONSTRAINT schedule_bookings_kind_category_check
  CHECK (
    (schedule_kind = 'production' AND category IN ('bottles', 'keg', 'owk', 'bibs', 'bulk'))
    OR
    (schedule_kind = 'blending' AND category IN ('base_in', 'filtering', 'filtering_2', 'blending', 'bulk_out'))
    OR
    (schedule_kind = 'appointments' AND category IN ('scs', 'management', 'qc_blending', 'warehouse_logistics', 'engineering'))
  );
