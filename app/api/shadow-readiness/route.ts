const REQUIRED_CONSECUTIVE_DAYS = 30;
const MIN_DAILY_SAMPLES = 1_200;
const MIN_READY_RATIO = 0.99;
const MAX_FAILURE_RATIO = 0.01;

type ShadowDay = {
  day: string;
  samples: number;
  indexReadySamples: number;
  backingReadySamples: number;
  oracleReadySamples: number;
  fullyReadySamples: number;
  failedSamples: number;
  lastSeenAt: number;
};

export async function GET() {
  const runtimeEnv = await getRuntimeEnv();
  if (!runtimeEnv.DB) {
    return Response.json(shadowResponse([]), {
      status: 503,
      headers: publicCacheHeaders(),
    });
  }

  const result = await runtimeEnv.DB.prepare(
    `SELECT
       day,
       samples,
       index_ready_samples AS indexReadySamples,
       backing_ready_samples AS backingReadySamples,
       oracle_ready_samples AS oracleReadySamples,
       fully_ready_samples AS fullyReadySamples,
       failed_samples AS failedSamples,
       last_seen_at AS lastSeenAt
     FROM shadow_daily_status
     ORDER BY day DESC
     LIMIT 45`,
  ).all<ShadowDay>();

  return Response.json(shadowResponse(result.results), {
    headers: publicCacheHeaders(),
  });
}

function shadowResponse(rows: ShadowDay[]) {
  const currentDay = new Date().toISOString().slice(0, 10);
  const days = rows.map((row) => {
    const readyRatio =
      row.samples > 0 ? row.fullyReadySamples / row.samples : 0;
    const failureRatio =
      row.samples > 0 ? row.failedSamples / row.samples : 1;
    const complete = row.day < currentDay;
    const passed =
      complete &&
      row.samples >= MIN_DAILY_SAMPLES &&
      readyRatio >= MIN_READY_RATIO &&
      failureRatio <= MAX_FAILURE_RATIO;
    return {
      ...row,
      complete,
      passed,
      readyRatio,
      failureRatio,
      lastSeenAt: new Date(row.lastSeenAt * 1000).toISOString(),
    };
  });

  let consecutivePassingDays = 0;
  const completedDays = days.filter((day) => day.complete);
  for (const day of completedDays) {
    if (!day.passed) break;
    consecutivePassingDays += 1;
  }

  return {
    ready: consecutivePassingDays >= REQUIRED_CONSECUTIVE_DAYS,
    status:
      consecutivePassingDays >= REQUIRED_CONSECUTIVE_DAYS
        ? "passed"
        : "collecting",
    consecutivePassingDays,
    requiredConsecutiveDays: REQUIRED_CONSECUTIVE_DAYS,
    policy: {
      minimumSamplesPerCompletedDay: MIN_DAILY_SAMPLES,
      minimumFullyReadyRatio: MIN_READY_RATIO,
      maximumFailureRatio: MAX_FAILURE_RATIO,
      currentUtcDayExcluded: true,
    },
    days,
  };
}

function publicCacheHeaders() {
  return {
    "Cache-Control": "public, max-age=5, s-maxage=60",
    "Access-Control-Allow-Origin": "*",
  };
}

type RuntimeEnv = { DB?: D1Database };

async function getRuntimeEnv(): Promise<RuntimeEnv> {
  try {
    const workers = await import("cloudflare:workers");
    return workers.env as unknown as RuntimeEnv;
  } catch {
    return {};
  }
}
