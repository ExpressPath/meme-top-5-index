import type {
  DataSourceHealth,
  MarketCandidate,
} from "./index-engine";

const DEX_SCREENER_API = "https://api.dexscreener.com";
const GECKO_TERMINAL_API = "https://api.geckoterminal.com/api/v2";
const JUPITER_PRICE_API = "https://api.jup.ag/price/v3";
const HELIUS_RPC_API = "https://mainnet.helius-rpc.com";
const MAX_CANDIDATES = 30;
const REQUEST_TIMEOUT_MS = 5_000;
const PRICE_DIVERGENCE_LIMIT_BPS = 500;

const NON_MEME_SYMBOLS = new Set([
  "SOL",
  "WSOL",
  "USDC",
  "USDT",
  "JUP",
  "JITOSOL",
  "JITO",
  "MSOL",
  "RAY",
  "PYTH",
]);

type SourceName = "dexscreener" | "geckoterminal" | "jupiter-price";

type SourceQuote = {
  source: SourceName;
  tokenAddress: string;
  symbol: string;
  name: string;
  priceUsd: number;
  marketCap: number;
  liquidityUsd: number;
  volumeUsd: number;
  buys: number;
  sells: number;
  buyerWallets30m?: number;
  buyVolumeUsd30m?: number;
  demandCoverage?: "aggregate" | "none";
  primaryPoolAddress?: string;
  changePercent: number;
  imageUrl?: string;
};

type DexPair = {
  chainId?: string;
  pairAddress?: string;
  baseToken?: { address?: string; symbol?: string; name?: string };
  priceUsd?: string;
  txns?: { h1?: { buys?: number; sells?: number } };
  volume?: { h1?: number };
  priceChange?: { h1?: number };
  liquidity?: { usd?: number };
  marketCap?: number;
  info?: { imageUrl?: string };
};

type TokenReference = {
  chainId?: string;
  tokenAddress?: string;
};

type GeckoResource = {
  id?: string;
  attributes?: Record<string, unknown>;
  relationships?: Record<
    string,
    { data?: { id?: string } | Array<{ id?: string }> }
  >;
};

type GeckoResponse = {
  data?: GeckoResource | GeckoResource[];
  included?: GeckoResource[];
};

type JupiterPriceResponse = Record<
  string,
  {
    usdPrice?: number;
    liquidity?: number;
    priceChange24h?: number;
  }
>;

type SolanaRpcResponse<T> = {
  result?: T;
  error?: { message?: string };
};

export type MarketDataBundle = {
  candidates: MarketCandidate[];
  sources: DataSourceHealth[];
  observedAt: string;
};

export async function fetchMarketData(
  seedAddresses: string[],
  credentials: {
    jupiterApiKey?: string;
    heliusApiKey?: string;
  } = {},
): Promise<MarketDataBundle> {
  const observedAt = new Date().toISOString();
  const [dexDiscovery, geckoDiscovery] = await Promise.allSettled([
    discoverDexScreener(),
    discoverGeckoTerminal(),
  ]);

  const dexAddresses =
    dexDiscovery.status === "fulfilled" ? dexDiscovery.value : [];
  const geckoAddresses =
    geckoDiscovery.status === "fulfilled" ? geckoDiscovery.value : [];
  const dexAddressSet = new Set(dexAddresses);
  const independentlyDiscovered = geckoAddresses.filter((address) =>
    dexAddressSet.has(address),
  );
  const addresses = unique([
    ...seedAddresses,
    ...independentlyDiscovered,
  ]).slice(0, MAX_CANDIDATES);

  const [dexResult, geckoResult, jupiterResult] = await Promise.all([
    timedSource("dexscreener", () => fetchDexScreenerQuotes(addresses)),
    timedSource("geckoterminal", () => fetchGeckoTerminalQuotes(addresses)),
    timedSource("jupiter-price", () =>
      fetchJupiterQuotes(seedAddresses, credentials),
    ),
  ]);

  const sourceHealth: DataSourceHealth[] = [
    {
      ...dexResult.health,
      discoveryOk: dexDiscovery.status === "fulfilled",
    },
    {
      ...geckoResult.health,
      discoveryOk: geckoDiscovery.status === "fulfilled",
    },
    jupiterResult.health,
  ];
  const quotes = [
    ...(dexResult.quotes ?? []),
    ...(geckoResult.quotes ?? []),
    ...(jupiterResult.quotes ?? []),
  ];

  return {
    candidates: mergeQuotes(quotes),
    sources: sourceHealth,
    observedAt,
  };
}

async function fetchJupiterQuotes(
  addresses: string[],
  credentials: {
    jupiterApiKey?: string;
    heliusApiKey?: string;
  },
) {
  const jupiterApiKey =
    credentials.jupiterApiKey ?? process.env.JUPITER_API_KEY;
  const heliusApiKey =
    credentials.heliusApiKey ?? process.env.HELIUS_API_KEY;
  if (!jupiterApiKey || !heliusApiKey) {
    throw new Error("JUPITER_API_KEY or HELIUS_API_KEY is not configured");
  }

  const checkedAddresses = unique(addresses).slice(0, 10);
  const [prices, supplies] = await Promise.all([
    fetchJson<JupiterPriceResponse>(
      `${JUPITER_PRICE_API}?ids=${checkedAddresses.join(",")}`,
      { "x-api-key": jupiterApiKey },
    ),
    fetchTokenSupplies(checkedAddresses, heliusApiKey),
  ]);

  return checkedAddresses.flatMap((tokenAddress): SourceQuote[] => {
    const price = prices[tokenAddress];
    const supply = supplies.get(tokenAddress);
    const priceUsd = finite(price?.usdPrice);
    if (!price || !supply || priceUsd <= 0) return [];

    return [
      {
        source: "jupiter-price",
        tokenAddress,
        symbol: "UNKNOWN",
        name: "Unknown token",
        priceUsd,
        marketCap: priceUsd * supply,
        liquidityUsd: finite(price.liquidity),
        volumeUsd: 0,
        buys: 0,
        sells: 0,
        changePercent: finite(price.priceChange24h),
      },
    ];
  });
}

async function fetchTokenSupplies(
  addresses: string[],
  heliusApiKey: string,
) {
  const endpoint = `${HELIUS_RPC_API}/?api-key=${encodeURIComponent(heliusApiKey)}`;
  const results = await Promise.all(
    addresses.map(async (address) => {
      const response = await fetchJson<
        SolanaRpcResponse<{ value?: { uiAmountString?: string } }>
      >(
        endpoint,
        { "Content-Type": "application/json" },
        {
          jsonrpc: "2.0",
          id: address,
          method: "getTokenSupply",
          params: [address, { commitment: "confirmed" }],
        },
      );
      if (response.error) {
        throw new Error(response.error.message || "getTokenSupply failed");
      }
      return [
        address,
        finite(response.result?.value?.uiAmountString),
      ] as const;
    }),
  );

  return new Map(results.filter(([, supply]) => supply > 0));
}

async function discoverDexScreener() {
  const [profiles, boosts] = await Promise.all([
    fetchJson<TokenReference[]>(
      `${DEX_SCREENER_API}/token-profiles/latest/v1`,
    ),
    fetchJson<TokenReference[]>(`${DEX_SCREENER_API}/token-boosts/top/v1`),
  ]);

  return unique(
    [...profiles, ...boosts]
      .filter((item) => item.chainId === "solana" && item.tokenAddress)
      .map((item) => item.tokenAddress as string),
  );
}

async function discoverGeckoTerminal() {
  const responses = [
    await fetchJson<GeckoResponse>(
      `${GECKO_TERMINAL_API}/networks/solana/trending_pools?include=base_token&page=1&duration=1h`,
    ),
  ];

  return unique(
    responses.flatMap((response) =>
      resources(response.data)
        .map((pool) => relatedAddress(pool, "base_token"))
        .filter((address): address is string => Boolean(address)),
    ),
  );
}

async function fetchDexScreenerQuotes(addresses: string[]) {
  const responses = await Promise.all(
    chunks(addresses, 30).map((batch) =>
      fetchJson<DexPair[]>(
        `${DEX_SCREENER_API}/tokens/v1/solana/${batch.join(",")}`,
      ),
    ),
  );

  const bestByToken = new Map<string, DexPair>();
  for (const pair of responses.flat()) {
    const address = pair.baseToken?.address;
    if (!address || pair.chainId !== "solana") continue;
    const current = bestByToken.get(address);
    if (
      !current ||
      finite(pair.liquidity?.usd) > finite(current.liquidity?.usd)
    ) {
      bestByToken.set(address, pair);
    }
  }

  return [...bestByToken.entries()].map(
    ([tokenAddress, pair]): SourceQuote => ({
      source: "dexscreener",
      tokenAddress,
      symbol: cleanSymbol(pair.baseToken?.symbol),
      name: cleanName(pair.baseToken?.name),
      priceUsd: finite(pair.priceUsd),
      marketCap: finite(pair.marketCap),
      liquidityUsd: finite(pair.liquidity?.usd),
      volumeUsd: finite(pair.volume?.h1),
      buys: finite(pair.txns?.h1?.buys),
      sells: finite(pair.txns?.h1?.sells),
      primaryPoolAddress: pair.pairAddress?.trim() || undefined,
      changePercent: finite(pair.priceChange?.h1),
      imageUrl: safeImageUrl(pair.info?.imageUrl),
    }),
  );
}

async function fetchGeckoTerminalQuotes(addresses: string[]) {
  const tokenResponses = await Promise.all(
    chunks(addresses, 30).map((batch) =>
      fetchJson<GeckoResponse>(
        `${GECKO_TERMINAL_API}/networks/solana/tokens/multi/${batch.join(",")}`,
      ),
    ),
  );
  const tokenByAddress = new Map<string, GeckoResource>();
  const poolAddresses: string[] = [];

  for (const token of tokenResponses.flatMap((response) =>
    resources(response.data),
  )) {
    const address = stringValue(token.attributes?.address);
    if (!address) continue;
    tokenByAddress.set(address, token);
    const pools = token.relationships?.top_pools?.data;
    if (Array.isArray(pools)) {
      for (const pool of pools) {
        const poolAddress = stripNetworkPrefix(pool.id);
        if (poolAddress) poolAddresses.push(poolAddress);
      }
    }
  }

  const poolResponses = await Promise.all(
    chunks(unique(poolAddresses), 30).map((batch) =>
      fetchJson<GeckoResponse>(
        `${GECKO_TERMINAL_API}/networks/solana/pools/multi/${batch.join(",")}?include=base_token`,
      ),
    ),
  );
  const bestPoolByToken = new Map<string, GeckoResource>();

  for (const pool of poolResponses.flatMap((response) =>
    resources(response.data),
  )) {
    const tokenAddress = relatedAddress(pool, "base_token");
    if (!tokenAddress) continue;
    const current = bestPoolByToken.get(tokenAddress);
    if (
      !current ||
      finite(pool.attributes?.reserve_in_usd) >
        finite(current.attributes?.reserve_in_usd)
    ) {
      bestPoolByToken.set(tokenAddress, pool);
    }
  }

  return [...tokenByAddress.entries()].map(
    ([tokenAddress, token]): SourceQuote => {
      const tokenAttributes = token.attributes ?? {};
      const pool = bestPoolByToken.get(tokenAddress);
      const poolAttributes = pool?.attributes ?? {};
      const transactions = recordValue(poolAttributes.transactions);
      const h1 = recordValue(transactions.h1);
      const m30 = recordValue(transactions.m30);
      const volume = recordValue(poolAttributes.volume_usd);
      const priceChange = recordValue(
        poolAttributes.price_change_percentage,
      );

      return {
        source: "geckoterminal",
        tokenAddress,
        symbol: cleanSymbol(stringValue(tokenAttributes.symbol)),
        name: cleanName(stringValue(tokenAttributes.name)),
        priceUsd: finite(
          tokenAttributes.price_usd ?? poolAttributes.base_token_price_usd,
        ),
        marketCap: finite(
          tokenAttributes.market_cap_usd ?? poolAttributes.market_cap_usd,
        ),
        liquidityUsd: finite(
          tokenAttributes.total_reserve_in_usd ??
            poolAttributes.reserve_in_usd,
        ),
        volumeUsd: finite(
          volume.h1 ?? recordValue(tokenAttributes.volume_usd).h24,
        ),
        buys: finite(h1.buys),
        sells: finite(h1.sells),
        buyerWallets30m: finite(m30.buyers),
        buyVolumeUsd30m: estimateBuyVolume(
          finite(volume.m30),
          finite(m30.buys),
          finite(m30.sells),
        ),
        demandCoverage: "aggregate",
        primaryPoolAddress: stripNetworkPrefix(pool?.id) ?? undefined,
        changePercent: finite(priceChange.h1),
        imageUrl:
          safeImageUrl(stringValue(tokenAttributes.image_url)) ?? undefined,
      };
    },
  );
}

function mergeQuotes(quotes: SourceQuote[]): MarketCandidate[] {
  const byToken = new Map<string, SourceQuote[]>();
  for (const quote of quotes) {
    if (!quote.tokenAddress || quote.priceUsd <= 0) continue;
    const current = byToken.get(quote.tokenAddress) ?? [];
    current.push(quote);
    byToken.set(quote.tokenAddress, current);
  }

  const candidates: MarketCandidate[] = [];
  for (const [tokenAddress, tokenQuotes] of byToken) {
    const preferred =
      tokenQuotes.find((quote) => quote.source === "geckoterminal") ??
      tokenQuotes[0];
    if (NON_MEME_SYMBOLS.has(preferred.symbol.replace(/^\$/, ""))) continue;

    const prices = tokenQuotes.map((quote) => quote.priceUsd).filter(positive);
    const marketCaps = tokenQuotes
      .map((quote) => quote.marketCap)
      .filter(positive);
    const liquidities = tokenQuotes
      .map((quote) => quote.liquidityUsd)
      .filter(positive);
    const sourceNames = unique(tokenQuotes.map((quote) => quote.source));
    const price = median(prices);
    const divergenceBps =
      prices.length >= 2
        ? minimumRelativeSpread(prices) * 10_000
        : null;
    const marketCapDivergenceBps =
      marketCaps.length >= 2
        ? minimumRelativeSpread(marketCaps) * 10_000
        : null;
    const hasPriceConsensus =
      sourceNames.length >= 2 &&
      divergenceBps !== null &&
      divergenceBps <= PRICE_DIVERGENCE_LIMIT_BPS;
    const marketCapAgreement =
      marketCaps.length >= 2
        ? minimumRelativeSpread(marketCaps) <= 0.2
        : marketCaps.length === 1;
    const marketConfidence = clamp(
      (sourceNames.length >= 2 ? 0.4 : 0.15) +
        (hasPriceConsensus ? 0.3 : 0) +
        (marketCapAgreement ? 0.2 : 0) +
        (liquidities.length >= 2 ? 0.1 : 0.05),
      0,
      1,
    );

    candidates.push({
      tokenAddress,
      symbol: preferred.symbol,
      name: preferred.name,
      priceUsd: price,
      marketCap: median(marketCaps),
      liquidityUsd:
        liquidities.length >= 2
          ? Math.min(...liquidities)
          : median(liquidities),
      volumeUsd: maxFinite(tokenQuotes.map((quote) => quote.volumeUsd)),
      buys: Math.round(maxFinite(tokenQuotes.map((quote) => quote.buys))),
      sells: Math.round(maxFinite(tokenQuotes.map((quote) => quote.sells))),
      buyerWallets30m:
        tokenQuotes.find((quote) => quote.buyerWallets30m !== undefined)
          ?.buyerWallets30m ?? null,
      buyVolumeUsd30m:
        tokenQuotes.find((quote) => quote.buyVolumeUsd30m !== undefined)
          ?.buyVolumeUsd30m ?? null,
      primaryPoolAddress:
        tokenQuotes.find((quote) => quote.primaryPoolAddress)
          ?.primaryPoolAddress,
      demand:
        demandFromAggregate(
          tokenAddress,
          tokenQuotes.find(
            (quote) =>
              quote.buyerWallets30m !== undefined &&
              quote.buyVolumeUsd30m !== undefined,
          ),
        ),
      changePercent: median(
        tokenQuotes.map((quote) => quote.changePercent),
      ),
      imageUrl:
        tokenQuotes.find((quote) => quote.imageUrl)?.imageUrl ??
        preferred.imageUrl,
      marketSources: sourceNames,
      priceDivergenceBps: divergenceBps,
      marketCapDivergenceBps,
      marketConfidence,
    });
  }

  return candidates;
}

async function timedSource(
  name: SourceName,
  operation: () => Promise<SourceQuote[]>,
) {
  const startedAt = Date.now();
  try {
    const quotes = await operation();
    return {
      quotes,
      health: {
        name,
        role: "market",
        ok: quotes.length > 0,
        discoveryOk: true,
        records: quotes.length,
        latencyMs: Date.now() - startedAt,
        observedAt: new Date().toISOString(),
      } satisfies DataSourceHealth,
    };
  } catch (error) {
    return {
      quotes: null,
      health: {
        name,
        role: "market",
        ok: false,
        discoveryOk: false,
        records: 0,
        latencyMs: Date.now() - startedAt,
        observedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message.slice(0, 160) : "unknown",
      } satisfies DataSourceHealth,
    };
  }
}

async function fetchJson<T>(
  url: string,
  headers: Record<string, string> = {},
  body?: unknown,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: body === undefined ? "GET" : "POST",
        headers: { Accept: "application/json", ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return (await response.json()) as T;
    } catch (error) {
      lastError = error;
      if (attempt === 0) await delay(250);
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("request failed");
}

function resources(value: GeckoResponse["data"]) {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

function relatedAddress(resource: GeckoResource, relationship: string) {
  const related = resource.relationships?.[relationship]?.data;
  if (!related || Array.isArray(related)) return null;
  return stripNetworkPrefix(related.id);
}

function stripNetworkPrefix(value: unknown) {
  const id = stringValue(value);
  if (!id) return null;
  return id.startsWith("solana_") ? id.slice("solana_".length) : id;
}

function chunks<T>(values: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function median(values: number[]) {
  const valid = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (valid.length === 0) return 0;
  const middle = Math.floor(valid.length / 2);
  return valid.length % 2 === 0
    ? (valid[middle - 1] + valid[middle]) / 2
    : valid[middle];
}

function maxFinite(values: number[]) {
  const valid = values.filter(Number.isFinite);
  return valid.length > 0 ? Math.max(...valid) : 0;
}

function minimumRelativeSpread(values: number[]) {
  const valid = values.filter(positive);
  if (valid.length < 2) return 1;
  let minimum = Number.POSITIVE_INFINITY;
  for (let left = 0; left < valid.length - 1; left += 1) {
    for (let right = left + 1; right < valid.length; right += 1) {
      const center = (valid[left] + valid[right]) / 2;
      const spread = Math.abs(valid[left] - valid[right]) / center;
      minimum = Math.min(minimum, spread);
    }
  }
  return minimum;
}

function estimateBuyVolume(volumeUsd: number, buys: number, sells: number) {
  const trades = buys + sells;
  return trades > 0 ? volumeUsd * (buys / trades) : 0;
}

function demandFromAggregate(
  tokenAddress: string,
  quote: SourceQuote | undefined,
) {
  if (!quote || quote.buyerWallets30m === undefined) return undefined;
  return {
    tokenAddress,
    grossBuyUsd: quote.buyVolumeUsd30m ?? 0,
    qualifiedBuyUsd: quote.buyVolumeUsd30m ?? 0,
    observedBuyerWallets: quote.buyerWallets30m,
    estimatedUsers: 0,
    identityConfidence: 0,
    coverageComplete: false,
    observedTrades: quote.buys,
    filteredWallets: 0,
    source: "geckoterminal-pool-aggregate",
  };
}

function finite(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function positive(value: number) {
  return Number.isFinite(value) && value > 0;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function cleanSymbol(value: unknown) {
  return (stringValue(value) || "UNKNOWN").trim().slice(0, 16).toUpperCase();
}

function cleanName(value: unknown) {
  return (stringValue(value) || "Unknown token").trim().slice(0, 48);
}

function safeImageUrl(value: unknown) {
  const url = stringValue(value);
  return /^https:\/\//i.test(url) ? url : undefined;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
