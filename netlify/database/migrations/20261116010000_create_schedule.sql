CREATE TABLE schedule_bookings (
  id text PRIMARY KEY,
  week_commencing date NOT NULL,
  day text NOT NULL CHECK (day IN ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday')),
  category text NOT NULL CHECK (category IN ('bottles', 'keg', 'owk', 'bibs', 'bulk')),
  start_time text NOT NULL,
  end_time text NOT NULL,
  customer text NOT NULL DEFAULT '',
  product text NOT NULL DEFAULT '',
  liquid_code text NOT NULL DEFAULT '',
  packing_format text NOT NULL DEFAULT '',
  volume numeric NULL,
  legacy_text text NOT NULL DEFAULT '',
  background_colour text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL DEFAULT ''
);

CREATE INDEX schedule_bookings_week_idx ON schedule_bookings (week_commencing);

CREATE TABLE schedule_weeks (
  week_commencing date PRIMARY KEY,
  night_shift boolean NOT NULL DEFAULT false,
  saturday_running boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL DEFAULT ''
);

CREATE TABLE schedule_day_notes (
  note_date date PRIMARY KEY,
  week_commencing date NOT NULL,
  important text NOT NULL DEFAULT '',
  absence text NOT NULL DEFAULT '',
  version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL DEFAULT ''
);

CREATE INDEX schedule_day_notes_week_idx ON schedule_day_notes (week_commencing);

CREATE TABLE schedule_revision (
  id integer PRIMARY KEY CHECK (id = 1),
  revision bigint NOT NULL DEFAULT 0
);

INSERT INTO schedule_revision (id, revision) VALUES (1, 0);

CREATE TABLE schedule_backup_jobs (
  id bigserial PRIMARY KEY,
  scope text NOT NULL CHECK (scope IN ('week', 'full')),
  week_commencing date NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'failed', 'done')),
  attempts integer NOT NULL DEFAULT 0,
  last_error text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX schedule_backup_jobs_status_idx ON schedule_backup_jobs (status, id);

CREATE TABLE schedule_backup_state (
  scope_key text PRIMARY KEY,
  revision bigint NOT NULL,
  backed_up_at timestamptz NOT NULL DEFAULT now()
);
