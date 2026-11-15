#!/usr/bin/env node
// Seeds synthetic sample data for three ICU patients through the public Achillea API.
//
//   node scripts/seed-sample-data.mjs                 # backfill the last 30 min of history
//   node scripts/seed-sample-data.mjs --live          # backfill, then keep streaming every 5 s
//   ACHILLEA_API=http://127.0.0.1:18184/api node scripts/seed-sample-data.mjs
//
// Requires Node 18+ (built-in fetch) and a running backend in demo mode. Every run uses a new
// run ID, so re-running adds more history instead of conflicting. All values are synthetic.

const API = (process.env.ACHILLEA_API ?? "http://127.0.0.1:18184/api").replace(/\/$/, "");
const LIVE = process.argv.includes("--live");
const RUN = Date.now().toString(36);
const HISTORY_MINUTES = 30;

/** Three storylines so the UI shows different situations side by side. */
const PATIENTS = [
  {
    id: "synthetic-icu-01", // Alex Linden: stable, completes a coordinated turn
    hr: 76, spo2: 98, rr: 15, temp: 36.8,
    trend: { hr: 0, spo2: 0, rr: 0 },
    posture: [[0, 0], [0, 0], [32, 28]], // [torso, pelvis] for each third of the window
    turn: { before: [0, 0], after: [32, 28] }, // coordinated turn candidate
  },
  {
    id: "synthetic-icu-02", // Robin Ash: heart rate creeping up, torso-only movement
    hr: 84, spo2: 97, rr: 17, temp: 37.2,
    trend: { hr: 14, spo2: -1, rr: 3 },
    posture: [[-10, -8], [-10, -8], [-38, -9]],
    turn: { before: [-10, -8], after: [-38, -9] }, // partial torso movement
  },
  {
    id: "synthetic-icu-03", // Sam Alder: SpO2 dips with artifact readings, small adjustment
    hr: 71, spo2: 95, rr: 14, temp: 36.6,
    trend: { hr: 2, spo2: -2, rr: 1 },
    artifactEvery: 7,
    posture: [[20, 18], [20, 18], [26, 22]],
    turn: { before: [20, 18], after: [26, 22] }, // small adjustment (no review needed)
  },
];

let seq = 0;
const id = (...parts) => [RUN, ++seq, ...parts].join("-");
const round1 = (v) => Math.round(v * 10) / 10;
const noise = (a) => (Math.random() - 0.5) * a;

async function call(path, body) {
  const res = await fetch(API + path, body === undefined ? {} : {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${body ? "POST" : "GET"} ${path} -> ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

function vitalsAt(p, progress, n) {
  const artifact = p.artifactEvery && n % p.artifactEvery === 0;
  return [
    ["HEART_RATE", Math.round(p.hr + p.trend.hr * progress + noise(4)), "bpm", "VALID"],
    ["SPO2", Math.round(Math.min(100, p.spo2 + p.trend.spo2 * progress + noise(1.5))), "%", artifact ? "SUSPECTED_ARTIFACT" : "VALID"],
    ["RESPIRATORY_RATE", Math.round(p.rr + p.trend.rr * progress + noise(2)), "breaths/min", "VALID"],
    ["TEMPERATURE", round1(p.temp + noise(0.2)), "°C", "VALID"],
  ];
}

async function sendVitals(p, at, progress, n) {
  for (const [metric, value, unit, quality] of vitalsAt(p, progress, n)) {
    await call("/integrations/monitors/observations", {
      sourceEventId: id(p.id, metric), patientId: p.id, metric, value, unit,
      observedAt: at.toISOString(), quality,
    });
  }
}

async function sendPosture(p, at, [torso, pelvis]) {
  await call("/integrations/sensors/posture", {
    sourceEventId: id(p.id, "posture"), patientId: p.id,
    upperTorsoDegrees: round1(torso + noise(1)), pelvisDegrees: round1(pelvis + noise(1)),
    capturedAt: at.toISOString(),
  });
}

async function backfill(p) {
  // The default census starts some bedside monitors disconnected/delayed; reconnect them
  // (this also stops the built-in fake monitor from toggling them).
  await call(`/demo/scenarios/monitor-reconnect?patientId=${p.id}`, {});

  const now = Date.now();
  const steps = HISTORY_MINUTES; // one reading per minute
  let turned = false;
  for (let n = 0; n <= steps; n++) {
    const at = new Date(now - (steps - n) * 60_000);
    const progress = n / steps;
    const third = Math.min(2, Math.floor(progress * 3));
    if (third === 2 && !turned) {
      turned = true;
      const m = await call("/integrations/sensors/movements", {
        sourceEventId: id(p.id, "turn"), patientId: p.id,
        upperTorsoBefore: p.turn.before[0], upperTorsoAfter: p.turn.after[0],
        pelvisBefore: p.turn.before[1], pelvisAfter: p.turn.after[1],
        capturedAt: at.toISOString(),
      });
      console.log(`  ${p.id}: movement ${m.classification}`);
    }
    await sendVitals(p, at, progress, n);
    if (n % 3 === 0 || n === steps) await sendPosture(p, at, p.posture[third]);
  }
  console.log(`  ${p.id}: ${steps + 1} vital sets + posture history sent`);
}

async function main() {
  const health = await call("/health").catch((e) => {
    throw new Error(`Backend not reachable at ${API} (${e.message}). Start it first.`);
  });
  console.log(`Achillea ${health.version} at ${API}, run ${RUN}`);
  for (const p of PATIENTS) await backfill(p);
  console.log("Backfill done. Open the Achillea UI -> ICU.");
  if (!LIVE) return;

  console.log("Streaming live data every 5 s (Ctrl+C to stop)...");
  let n = 0;
  for (;;) {
    n++;
    const at = new Date();
    for (const p of PATIENTS) {
      await sendVitals(p, at, 1, n);
      await sendPosture(p, at, p.posture[2]);
    }
    process.stdout.write(`\r  live tick ${n}`);
    await new Promise((r) => setTimeout(r, 5000));
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
