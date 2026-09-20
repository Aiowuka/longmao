function fail(code) {
  throw Object.assign(new Error(code), {code});
}

function finite(value, min, max, code) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) fail(code);
  return number;
}

function haversineMeters(a, b) {
  const radius = 6371008.8;
  const toRad = degrees => degrees * Math.PI / 180;
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const dLat = lat2 - lat1;
  const dLon = toRad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function validateRunPlan(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) fail('INVALID_RUN_PLAN');
  const taskId = typeof input.taskId === 'string' ? input.taskId.trim() : '';
  if (!taskId || taskId.length > 128) fail('INVALID_TASK_ID');
  return Object.freeze({
    taskId,
    distanceMeters: finite(input.distanceMeters, 100, 50000, 'INVALID_DISTANCE'),
    durationSeconds: finite(input.durationSeconds, 30, 24 * 3600, 'INVALID_DURATION'),
    centerLat: finite(input.centerLat, -85, 85, 'INVALID_LATITUDE'),
    centerLon: finite(input.centerLon, -180, 180, 'INVALID_LONGITUDE'),
  });
}

export function generateSyntheticRun(input, {startedAt = new Date()} = {}) {
  const plan = validateRunPlan(input);
  const start = startedAt instanceof Date ? startedAt : new Date(startedAt);
  if (Number.isNaN(start.getTime())) fail('INVALID_START_TIME');

  const laps = Math.max(1, Math.round(plan.distanceMeters / 1200));
  const radiusMeters = plan.distanceMeters / (2 * Math.PI * laps);
  const sampleCount = Math.min(2000, Math.max(24, Math.ceil(plan.distanceMeters / 10) + 1));
  const metersPerDegreeLat = 111320;
  const metersPerDegreeLon = 111320 * Math.max(0.1, Math.cos(plan.centerLat * Math.PI / 180));

  const points = [];
  for (let index = 0; index < sampleCount; index += 1) {
    const progress = index / (sampleCount - 1);
    const angle = progress * Math.PI * 2 * laps;
    const latitude = plan.centerLat + (radiusMeters * Math.sin(angle)) / metersPerDegreeLat;
    const longitude = plan.centerLon + (radiusMeters * Math.cos(angle)) / metersPerDegreeLon;
    const elapsedSeconds = Math.round(progress * plan.durationSeconds * 1000) / 1000;
    points.push({
      seq: index,
      timestamp: new Date(start.getTime() + elapsedSeconds * 1000).toISOString(),
      elapsedSeconds,
      latitude: Number(latitude.toFixed(7)),
      longitude: Number(longitude.toFixed(7)),
    });
  }

  let generatedDistanceMeters = 0;
  for (let index = 1; index < points.length; index += 1) {
    generatedDistanceMeters += haversineMeters(points[index - 1], points[index]);
  }

  const averageSpeedMps = generatedDistanceMeters / plan.durationSeconds;
  const paceSecondsPerKm = generatedDistanceMeters > 0
    ? plan.durationSeconds / (generatedDistanceMeters / 1000)
    : null;

  return {
    synthetic: true,
    generatedBy: 'longmao-test-generator',
    taskId: plan.taskId,
    startedAt: start.toISOString(),
    endedAt: new Date(start.getTime() + plan.durationSeconds * 1000).toISOString(),
    summary: {
      requestedDistanceMeters: plan.distanceMeters,
      generatedDistanceMeters: Math.round(generatedDistanceMeters * 10) / 10,
      durationSeconds: plan.durationSeconds,
      averageSpeedMps: Math.round(averageSpeedMps * 1000) / 1000,
      paceSecondsPerKm: paceSecondsPerKm == null ? null : Math.round(paceSecondsPerKm * 10) / 10,
      pointCount: points.length,
      center: {latitude: plan.centerLat, longitude: plan.centerLon},
      laps,
    },
    points,
  };
}
