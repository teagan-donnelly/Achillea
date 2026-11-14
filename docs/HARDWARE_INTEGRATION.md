# Hardware status
All monitor and orientation data are simulated. No board, IMU, BLE, serial driver, physical device accuracy, or hardware compatibility has been validated.

`SensorAdapter` produces deterministic independent chest/pelvis changes. The persisted sample representation is:
```json
{"id":"candidate-id-chest","sensorId":"torso-sim-01","patientId":"synthetic-icu-01","bodyRegion":"UPPER_TORSO","rollDegrees":35,"capturedAt":"2026-11-14T12:00:00Z","receivedAt":"2026-11-14T12:00:01Z","quality":"SIMULATED_GOOD","mode":"SIMULATED"}
```
Angles are degrees in a relative simulated coordinate frame. The initial reference is zero degrees; no physical posture classification or pressure measurement is implied. Partial movement adds 35 degrees to chest only; coordinated movement adds 35 to each region. These are scripted prototype examples, not validated thresholds. Samples and candidate sample IDs persist alongside audit events.

Disconnect yields UNKNOWN, no pelvis sample, and a visible disconnected state. Subsequent movement remains unknown until explicit reconnect. Reconnect keeps previous angles and resumes synthetic samples. No movement preserves angles and makes the existing prescribed review task due. Missing data is never interpreted as stillness.

Future physical work: implement the adapter for verified hardware, authenticated local ingestion, per-device patient/body assignment, calibration, capture versus receipt time, duplicate source-event handling, drift and acceleration artifact detection, staleness, and integration tests. No unsecured physical sensor ingestion endpoint is currently exposed. Demonstrate external sensors only on a safe external model after verifying the actual hardware.
