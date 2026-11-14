-- Ordinary PostgreSQL tables work on Tiger Data without requiring extension privileges.
-- Exact evidence IDs and references are deliberately kept in ordinary tables initially.
CREATE TABLE departments(id text PRIMARY KEY);
INSERT INTO departments VALUES ('L_AND_D'),('ICU');
CREATE TABLE nurses(id text PRIMARY KEY);
INSERT INTO nurses VALUES ('nurse-demo');
CREATE TABLE demo_metadata(id text PRIMARY KEY CHECK(id='demo'), started_at timestamptz NOT NULL, monitor_tick bigint NOT NULL DEFAULT 0);
CREATE TABLE patients (
  display_order integer NOT NULL DEFAULT 0,
  id text PRIMARY KEY,
  name text,
  room text,
  unit text,
  summary text,
  nurse_id text,
  reposition_plan boolean,
  care_phase text,
  scenario text,
  FOREIGN KEY(unit) REFERENCES departments(id),
  FOREIGN KEY(nurse_id) REFERENCES nurses(id)
);
CREATE TABLE devices (
  id text PRIMARY KEY,
  patient_id text,
  body_region text,
  connection_state text,
  freshness text,
  mode text,
  calibration_status text,
  last_seen_at timestamptz,
  last_sampled_at timestamptz,
  manual_override boolean,
  update_interval_seconds integer,
  reported_freshness text,
  encounter_id text,
  UNIQUE(id,patient_id),
  FOREIGN KEY(patient_id) REFERENCES patients(id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE care_tasks (
  id text PRIMARY KEY,
  patient_id text,
  title text,
  type text,
  status text,
  priority text,
  source text,
  defer_reason text,
  verified_by text,
  completed_at text,
  due_at timestamptz,
  verification_required boolean,
  sort_order integer,
  schedule_state text,
  related_device_id text,
  related_movement_id text,
  encounter_id text,
  UNIQUE(id,patient_id),
  FOREIGN KEY(patient_id) REFERENCES patients(id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE vital_observations (
  id text PRIMARY KEY,
  patient_id text,
  metric text,
  value float8,
  unit text,
  observed_at timestamptz,
  received_at timestamptz,
  source text,
  source_event_id text,
  quality text,
  source_id text,
  encounter_id text,
  UNIQUE(id,patient_id),
  FOREIGN KEY(patient_id) REFERENCES patients(id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE orientation_samples (
  id text PRIMARY KEY,
  sensor_id text,
  patient_id text,
  body_region text,
  roll_degrees float8,
  captured_at timestamptz,
  received_at timestamptz,
  quality text,
  mode text,
  encounter_id text,
  UNIQUE(id,patient_id),
  FOREIGN KEY(patient_id) REFERENCES patients(id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE movement_candidates (
  id text PRIMARY KEY,
  patient_id text,
  classification text,
  quality text,
  verification_status text,
  reviewer_id text,
  reviewed_at text,
  chest_sensor_id text,
  pelvis_sensor_id text,
  chest_before float8,
  pelvis_before float8,
  chest_after float8,
  pelvis_after float8,
  captured_at timestamptz,
  received_at timestamptz,
  confidence float8,
  review_required boolean,
  encounter_id text,
  UNIQUE(id,patient_id),
  FOREIGN KEY(patient_id) REFERENCES patients(id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE chart_entries (
  id text PRIMARY KEY,
  patient_id text,
  nurse_id text,
  type text,
  text text,
  status text,
  linked_task_id text,
  linked_movement_id text,
  amendment_of_id text,
  authored_at timestamptz,
  confirmed_at timestamptz,
  provenance text,
  encounter_id text,
  UNIQUE(id,patient_id),
  FOREIGN KEY(patient_id) REFERENCES patients(id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE activity_events (
  id text PRIMARY KEY,
  patient_id text,
  type text,
  source text,
  details text,
  occurred_at timestamptz,
  encounter_id text,
  UNIQUE(id,patient_id),
  FOREIGN KEY(patient_id) REFERENCES patients(id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE encounters(id text PRIMARY KEY, patient_id text NOT NULL REFERENCES patients(id), active boolean NOT NULL DEFAULT true, synthetic boolean NOT NULL DEFAULT true CHECK(synthetic), UNIQUE(id,patient_id));
CREATE UNIQUE INDEX one_active_encounter ON encounters(patient_id) WHERE active;
CREATE TABLE care_assignments(encounter_id text REFERENCES encounters(id), nurse_id text REFERENCES nurses(id), PRIMARY KEY(encounter_id,nurse_id));
ALTER TABLE devices ADD FOREIGN KEY(encounter_id,patient_id) REFERENCES encounters(id,patient_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE devices ALTER COLUMN patient_id SET NOT NULL; ALTER TABLE devices ALTER COLUMN encounter_id SET NOT NULL;
CREATE INDEX devices_patient ON devices(patient_id);
ALTER TABLE care_tasks ADD FOREIGN KEY(encounter_id,patient_id) REFERENCES encounters(id,patient_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE care_tasks ALTER COLUMN patient_id SET NOT NULL; ALTER TABLE care_tasks ALTER COLUMN encounter_id SET NOT NULL;
CREATE INDEX care_tasks_patient ON care_tasks(patient_id);
ALTER TABLE vital_observations ADD FOREIGN KEY(encounter_id,patient_id) REFERENCES encounters(id,patient_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE vital_observations ALTER COLUMN patient_id SET NOT NULL; ALTER TABLE vital_observations ALTER COLUMN encounter_id SET NOT NULL;
CREATE INDEX vital_observations_patient ON vital_observations(patient_id);
ALTER TABLE orientation_samples ADD FOREIGN KEY(encounter_id,patient_id) REFERENCES encounters(id,patient_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE orientation_samples ALTER COLUMN patient_id SET NOT NULL; ALTER TABLE orientation_samples ALTER COLUMN encounter_id SET NOT NULL;
CREATE INDEX orientation_samples_patient ON orientation_samples(patient_id);
ALTER TABLE movement_candidates ADD FOREIGN KEY(encounter_id,patient_id) REFERENCES encounters(id,patient_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE movement_candidates ALTER COLUMN patient_id SET NOT NULL; ALTER TABLE movement_candidates ALTER COLUMN encounter_id SET NOT NULL;
CREATE INDEX movement_candidates_patient ON movement_candidates(patient_id);
ALTER TABLE chart_entries ADD FOREIGN KEY(encounter_id,patient_id) REFERENCES encounters(id,patient_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE chart_entries ALTER COLUMN patient_id SET NOT NULL; ALTER TABLE chart_entries ALTER COLUMN encounter_id SET NOT NULL;
CREATE INDEX chart_entries_patient ON chart_entries(patient_id);
ALTER TABLE activity_events ADD FOREIGN KEY(encounter_id,patient_id) REFERENCES encounters(id,patient_id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX activity_events_patient ON activity_events(patient_id);
ALTER TABLE care_tasks ADD FOREIGN KEY(related_device_id,patient_id) REFERENCES devices(id,patient_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE care_tasks ADD FOREIGN KEY(related_movement_id,patient_id) REFERENCES movement_candidates(id,patient_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE chart_entries ADD FOREIGN KEY(linked_task_id,patient_id) REFERENCES care_tasks(id,patient_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE chart_entries ADD FOREIGN KEY(linked_movement_id,patient_id) REFERENCES movement_candidates(id,patient_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE chart_entries ADD FOREIGN KEY(amendment_of_id,patient_id) REFERENCES chart_entries(id,patient_id) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE device_assignments(device_id text PRIMARY KEY REFERENCES devices(id), encounter_id text NOT NULL REFERENCES encounters(id));
CREATE TABLE movement_sample_links(owner_id text REFERENCES movement_candidates(id) ON DELETE CASCADE, position integer NOT NULL, value text REFERENCES orientation_samples(id) DEFERRABLE INITIALLY DEFERRED, PRIMARY KEY(owner_id,position));
CREATE TABLE movement_reason_codes(owner_id text REFERENCES movement_candidates(id) ON DELETE CASCADE, position integer NOT NULL, value text NOT NULL, PRIMARY KEY(owner_id,position));
CREATE TABLE chart_evidence_links(owner_id text REFERENCES chart_entries(id) ON DELETE CASCADE, position integer NOT NULL, value text REFERENCES vital_observations(id) DEFERRABLE INITIALLY DEFERRED, PRIMARY KEY(owner_id,position));
CREATE TABLE movement_consumptions(movement_id text PRIMARY KEY REFERENCES movement_candidates(id), task_id text NOT NULL UNIQUE REFERENCES care_tasks(id));
CREATE TABLE movement_reviews(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, movement_id text NOT NULL REFERENCES movement_candidates(id), status text NOT NULL, reviewer_id text NOT NULL, reviewed_at timestamptz NOT NULL);
CREATE TABLE task_transitions(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, task_id text NOT NULL REFERENCES care_tasks(id), previous_status text, status text NOT NULL, changed_at timestamptz NOT NULL);
CREATE INDEX vital_history ON vital_observations(patient_id,metric,observed_at,id);
CREATE UNIQUE INDEX monitor_event_identity ON vital_observations(source_event_id) WHERE source_event_id IS NOT NULL;
CREATE INDEX vital_delta ON vital_observations(received_at,id);
CREATE INDEX orientation_delta ON orientation_samples(received_at,id);
CREATE INDEX event_delta ON activity_events(occurred_at,id);
CREATE INDEX task_schedule ON care_tasks(patient_id,status,due_at);
ALTER TABLE care_tasks ADD CHECK(status IN ('OPEN','ACKNOWLEDGED','DEFERRED','COMPLETED','CANCELLED'));
ALTER TABLE chart_entries ADD CHECK(status IN ('DRAFT','CONFIRMED','AMENDED'));
ALTER TABLE vital_observations ALTER COLUMN observed_at SET NOT NULL;
ALTER TABLE vital_observations ALTER COLUMN received_at SET NOT NULL;
ALTER TABLE orientation_samples ALTER COLUMN captured_at SET NOT NULL;
ALTER TABLE orientation_samples ALTER COLUMN received_at SET NOT NULL;
CREATE FUNCTION preserve_confirmed_chart() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF current_setting('achillea.allow_reset',true)='true' THEN RETURN OLD; END IF;
 IF OLD.status<>'DRAFT' THEN RAISE EXCEPTION 'Confirmed chart entries are immutable'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER confirmed_chart_guard BEFORE UPDATE OR DELETE ON chart_entries FOR EACH ROW EXECUTE FUNCTION preserve_confirmed_chart();

-- Evidence links must remain in the same encounter, not merely the same patient.
CREATE FUNCTION check_evidence_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_patient text; source_patient text; owner_encounter text; source_encounter text;
BEGIN
 IF TG_TABLE_NAME='chart_evidence_links' THEN
  SELECT patient_id,encounter_id INTO owner_patient,owner_encounter FROM chart_entries WHERE id=NEW.owner_id;
  SELECT patient_id,encounter_id INTO source_patient,source_encounter FROM vital_observations WHERE id=NEW.value;
 ELSE
  SELECT patient_id,encounter_id INTO owner_patient,owner_encounter FROM movement_candidates WHERE id=NEW.owner_id;
  SELECT patient_id,encounter_id INTO source_patient,source_encounter FROM orientation_samples WHERE id=NEW.value;
 END IF;
 IF owner_patient IS DISTINCT FROM source_patient OR owner_encounter IS DISTINCT FROM source_encounter THEN RAISE EXCEPTION 'Evidence belongs to a different encounter' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER chart_evidence_scope AFTER INSERT OR UPDATE ON chart_evidence_links DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_evidence_scope();
CREATE CONSTRAINT TRIGGER movement_evidence_scope AFTER INSERT OR UPDATE ON movement_sample_links DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_evidence_scope();
