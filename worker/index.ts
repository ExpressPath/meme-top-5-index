/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  CRON_SECRET?: string;
  WRITE_RATE_LIMITER?: {
    limit(options: { key: string }): Promise<{ success: boolean }>;
  };
  IMAGES?: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

interface ScheduledController {
  scheduledTime: number;
  cron: string;
  noRetry(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (
      request.method === "POST" &&
      url.pathname.startsWith("/api/ingest/") &&
      env.WRITE_RATE_LIMITER
    ) {
      const signer = request.headers.get("x-mt5-signer") ?? "anonymous";
      const address = request.headers.get("cf-connecting-ip") ?? "unknown";
      const rateLimit = await env.WRITE_RATE_LIMITER.limit({
        key: `${address}:${signer}`.slice(0, 128),
      });
      if (!rateLimit.success) {
        return withSecurityHeaders(
          Response.json({ error: "Rate limit exceeded" }, { status: 429 }),
        );
      }
    }

    if (url.pathname === "/_vinext/image") {
      const images = env.IMAGES;
      if (!images) {
        return withSecurityHeaders(await env.ASSETS.fetch(request));
      }
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      const response = await handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await images.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
      return withSecurityHeaders(response);
    }

    return withSecurityHeaders(await handler.fetch(request, env, ctx));
  },
  async scheduled(
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    if (!env.CRON_SECRET || env.CRON_SECRET.length < 32) {
      controller.noRetry();
      throw new Error("CRON_SECRET is not configured");
    }
    ctx.waitUntil(
      runScheduledCycle(controller, env, ctx),
    );
  },
};

export default worker;

function withSecurityHeaders(response: Response) {
  const secured = new Response(response.body, response);
  secured.headers.set(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  );
  secured.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  );
  secured.headers.set("Referrer-Policy", "no-referrer");
  secured.headers.set("X-Content-Type-Options", "nosniff");
  secured.headers.set("X-Frame-Options", "DENY");
  secured.headers.set(
    "Strict-Transport-Security",
    "max-age=31536000; includeSubDomains",
  );
  return secured;
}

async function runScheduledCycle(
  controller: ScheduledController,
  env: Env,
  ctx: ExecutionContext,
) {
  await captureShadowObservation(controller.scheduledTime, env, ctx).catch(
    async () => {
      await recordShadowObservation(env.DB, controller.scheduledTime, {
        indexReady: false,
        backingReady: false,
        oracleReady: false,
        failed: true,
      });
    },
  );

  const request = new Request(
    `https://mt5-scheduled.internal/api/index?scheduled=${controller.scheduledTime}`,
    {
      headers: {
        Accept: "application/json",
        "X-MT5-Cron-Token": env.CRON_SECRET!,
      },
    },
  );
  const response = await handler.fetch(request, env, ctx);
  await response.arrayBuffer();
  if (!response.ok) {
    throw new Error(`Scheduled index refresh failed: HTTP ${response.status}`);
  }
}

async function captureShadowObservation(
  scheduledTime: number,
  env: Env,
  ctx: ExecutionContext,
) {
  const indexResponse = await handler.fetch(
    new Request("https://mt5-scheduled.internal/api/index", {
      headers: { Accept: "application/json" },
    }),
    env,
    ctx,
  );
  if (!indexResponse.ok) {
    throw new Error(`Shadow index read failed: HTTP ${indexResponse.status}`);
  }
  const digest = indexResponse.headers.get("content-digest");
  const index = (await indexResponse.json()) as {
    publication?: { state?: string; tokenNavEligible?: boolean };
  };

  const [backingResponse, oracleResponse] = await Promise.all([
    handler.fetch(
      new Request("https://mt5-scheduled.internal/api/backing", {
        headers: { Accept: "application/json" },
      }),
      env,
      ctx,
    ),
    digest
      ? handler.fetch(
          new Request(
            `https://mt5-scheduled.internal/api/oracle-attestations?digest=${encodeURIComponent(digest)}`,
            { headers: { Accept: "application/json" } },
          ),
          env,
          ctx,
        )
      : Promise.resolve(
          Response.json({ ready: false }, { status: 400 }),
        ),
  ]);
  if (!backingResponse.ok || !oracleResponse.ok) {
    throw new Error(
      `Shadow dependency read failed: backing=${backingResponse.status}, oracle=${oracleResponse.status}`,
    );
  }
  const backing = (await backingResponse.json()) as {
    releaseEligible?: boolean;
  };
  const oracle = (await oracleResponse.json()) as { ready?: boolean };

  await recordShadowObservation(env.DB, scheduledTime, {
    indexReady:
      index.publication?.state === "publishable" &&
      index.publication.tokenNavEligible === true,
    backingReady: backing.releaseEligible === true,
    oracleReady: oracle.ready === true,
    failed: false,
  });
}

async function recordShadowObservation(
  database: D1Database,
  scheduledTime: number,
  status: {
    indexReady: boolean;
    backingReady: boolean;
    oracleReady: boolean;
    failed: boolean;
  },
) {
  const day = new Date(scheduledTime).toISOString().slice(0, 10);
  const fullyReady =
    status.indexReady &&
    status.backingReady &&
    status.oracleReady &&
    !status.failed;
  await database
    .prepare(
      `INSERT INTO shadow_daily_status (
         day,
         samples,
         index_ready_samples,
         backing_ready_samples,
         oracle_ready_samples,
         fully_ready_samples,
         failed_samples,
         last_seen_at
       ) VALUES (?, 1, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(day) DO UPDATE SET
         samples = samples + 1,
         index_ready_samples = index_ready_samples + excluded.index_ready_samples,
         backing_ready_samples = backing_ready_samples + excluded.backing_ready_samples,
         oracle_ready_samples = oracle_ready_samples + excluded.oracle_ready_samples,
         fully_ready_samples = fully_ready_samples + excluded.fully_ready_samples,
         failed_samples = failed_samples + excluded.failed_samples,
         last_seen_at = excluded.last_seen_at`,
    )
    .bind(
      day,
      Number(status.indexReady),
      Number(status.backingReady),
      Number(status.oracleReady),
      Number(fullyReady),
      Number(status.failed),
      Math.floor(scheduledTime / 1000),
    )
    .run();
}
