-- Achillea relational H2 schema. Idempotent: runs on every startup (spring.sql.init.mode=always).
-- Column names are the camelCase model fields in snake_case, except where H2 reserves the word:
--   Vital.value -> measured_value, Task.order -> sort_order, Event.timestamp -> occurred_at.
-- list_order preserves each record's position in the in-memory aggregate.
-- The legacy STORE table (single JSON document) is left untouched; RelationalStore imports it once.

CREATE TABLE IF NOT EXISTS demo_metadata (
  id               VARCHAR(16) PRIMARY KEY,
  started_at       TIMESTAMP(9) WITH TIME ZONE,
  monitor_tick     BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS patients (
  id               VARCHAR(160) PRIMARY KEY,
  list_order       INT NOT NULL,
  name             VARCHAR(255),
  room             VARCHAR(64),
  unit             VARCHAR(32),
  summary          VARCHAR(2000),
  nurse_id         VARCHAR(160),
  reposition_plan  BOOLEAN NOT NULL,
  care_phase       VARCHAR(255),
  scenario         VARCHAR(64)
);

CREATE TABLE IF NOT EXISTS devices (
  id                      VARCHAR(160) PRIMARY KEY,
  list_order              INT NOT NULL,
  patient_id              VARCHAR(160) REFERENCES patients(id),
  body_region             VARCHAR(32),
  connection_state        VARCHAR(32),
  freshness               VARCHAR(32),
  mode                    VARCHAR(64),
  calibration_status      VARCHAR(64),
  last_seen_at            TIMESTAMP(9) WITH TIME ZONE,
  last_sampled_at         TIMESTAMP(9) WITH TIME ZONE,
  manual_override         BOOLEAN NOT NULL,
  update_interval_seconds INT NOT NULL,
  reported_freshness      VARCHAR(32)
);
CREATE INDEX IF NOT EXISTS devices_patient ON devices(patient_id);

CREATE TABLE IF NOT EXISTS care_tasks (
  id                    VARCHAR(160) PRIMARY KEY,
  list_order            INT NOT NULL,
  patient_id            VARCHAR(160) REFERENCES patients(id),
  title                 VARCHAR(500),
  type                  VARCHAR(64),
  status                VARCHAR(32),
  priority              VARCHAR(32),
  source                VARCHAR(128),
  defer_reason          VARCHAR(2000),
  verified_by           VARCHAR(160),
  completed_at          VARCHAR(64),
  due_at                TIMESTAMP(9) WITH TIME ZONE,
  verification_required BOOLEAN NOT NULL,
  sort_order            INT NOT NULL,
  schedule_state        VARCHAR(32),
  related_device_id     VARCHAR(160),
  related_movement_id   VARCHAR(160)
);
CREATE INDEX IF NOT EXISTS care_tasks_patient ON care_tasks(patient_id, status, due_at);

CREATE TABLE IF NOT EXISTS vital_observations (
  id               VARCHAR(160) PRIMARY KEY,
  list_order       INT NOT NULL,
  patient_id       VARCHAR(160) REFERENCES patients(id),
  metric           VARCHAR(64),
  measured_value   DOUBLE PRECISION NOT NULL,
  unit             VARCHAR(32),
  observed_at      TIMESTAMP(9) WITH TIME ZONE,
  received_at      TIMESTAMP(9) WITH TIME ZONE,
  source           VARCHAR(128),
  source_event_id  VARCHAR(160),
  quality          VARCHAR(64),
  source_id        VARCHAR(160)
);
CREATE INDEX IF NOT EXISTS vitals_history ON vital_observations(patient_id, metric, observed_at);
CREATE INDEX IF NOT EXISTS vitals_delta ON vital_observations(received_at);
CREATE INDEX IF NOT EXISTS vitals_source_event ON vital_observations(source_event_id);

CREATE TABLE IF NOT EXISTS orientation_samples (
  id               VARCHAR(160) PRIMARY KEY,
  list_order       INT NOT NULL,
  sensor_id        VARCHAR(160),
  patient_id       VARCHAR(160) REFERENCES patients(id),
  body_region      VARCHAR(32),
  roll_degrees     DOUBLE PRECISION NOT NULL,
  captured_at      TIMESTAMP(9) WITH TIME ZONE,
  received_at      TIMESTAMP(9) WITH TIME ZONE,
  quality          VARCHAR(64),
  mode             VARCHAR(64)
);
CREATE INDEX IF NOT EXISTS orientation_history ON orientation_samples(patient_id, body_region, captured_at);
CREATE INDEX IF NOT EXISTS orientation_delta ON orientation_samples(received_at);

CREATE TABLE IF NOT EXISTS movement_candidates (
  id                   VARCHAR(160) PRIMARY KEY,
  list_order           INT NOT NULL,
  patient_id           VARCHAR(160) REFERENCES patients(id),
  classification       VARCHAR(64),
  quality              VARCHAR(64),
  verification_status  VARCHAR(32),
  reviewer_id          VARCHAR(160),
  reviewed_at          VARCHAR(64),
  chest_sensor_id      VARCHAR(160),
  pelvis_sensor_id     VARCHAR(160),
  chest_before         DOUBLE PRECISION NOT NULL,
  pelvis_before        DOUBLE PRECISION NOT NULL,
  chest_after          DOUBLE PRECISION NOT NULL,
  pelvis_after         DOUBLE PRECISION NOT NULL,
  captured_at          TIMESTAMP(9) WITH TIME ZONE,
  received_at          TIMESTAMP(9) WITH TIME ZONE,
  confidence           DOUBLE PRECISION,
  review_required      BOOLEAN NOT NULL
);
CREATE INDEX IF NOT EXISTS movements_patient ON movement_candidates(patient_id, captured_at);

-- Movement.sampleIds (ordered orientation_samples ids)
CREATE TABLE IF NOT EXISTS movement_sample_links (
  owner_id  VARCHAR(160) NOT NULL REFERENCES movement_candidates(id) ON DELETE CASCADE,
  position  INT NOT NULL,
  sample_id VARCHAR(160) NOT NULL,
  PRIMARY KEY (owner_id, position)
);

-- Movement.reviewReasonCodes
CREATE TABLE IF NOT EXISTS movement_reason_codes (
  owner_id  VARCHAR(160) NOT NULL REFERENCES movement_candidates(id) ON DELETE CASCADE,
  position  INT NOT NULL,
  code      VARCHAR(128) NOT NULL,
  PRIMARY KEY (owner_id, position)
);

CREATE TABLE IF NOT EXISTS chart_entries (
  id                 VARCHAR(160) PRIMARY KEY,
  list_order         INT NOT NULL,
  patient_id         VARCHAR(160) REFERENCES patients(id),
  nurse_id           VARCHAR(160),
  type               VARCHAR(64),
  text               VARCHAR(10000),
  status             VARCHAR(32),
  linked_task_id     VARCHAR(160),
  linked_movement_id VARCHAR(160),
  amendment_of_id    VARCHAR(160),
  authored_at        TIMESTAMP(9) WITH TIME ZONE,
  confirmed_at       TIMESTAMP(9) WITH TIME ZONE,
  provenance         VARCHAR(64)
);
CREATE INDEX IF NOT EXISTS charts_patient ON chart_entries(patient_id, authored_at);

-- Chart.linkedVitalIds (ordered vital_observations ids)
CREATE TABLE IF NOT EXISTS chart_evidence_links (
  owner_id  VARCHAR(160) NOT NULL REFERENCES chart_entries(id) ON DELETE CASCADE,
  position  INT NOT NULL,
  vital_id  VARCHAR(160) NOT NULL,
  PRIMARY KEY (owner_id, position)
);

CREATE TABLE IF NOT EXISTS activity_events (
  id           VARCHAR(160) PRIMARY KEY,
  list_order   INT NOT NULL,
  patient_id   VARCHAR(160) REFERENCES patients(id),
  type         VARCHAR(128),
  source       VARCHAR(128),
  details      VARCHAR(4000),
  occurred_at  TIMESTAMP(9) WITH TIME ZONE
);
CREATE INDEX IF NOT EXISTS events_time ON activity_events(occurred_at);
CREATE INDEX IF NOT EXISTS events_patient ON activity_events(patient_id, occurred_at);
