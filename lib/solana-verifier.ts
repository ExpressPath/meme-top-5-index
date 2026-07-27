import type {
  DataSourceHealth,
  MarketCandidate,
} from "./index-engine";

type JsonRpcResponse = {
  id?: string;
  result?: {
    value?: {
      data?: {
        parsed?: {
          info?: {
            decimals?: number;
            supply?: string;
            mintAuthority?: string | null;
            freezeAuthority?: string | null;
          };
        };
      };
    };
  };
  error?: { message?: string };
};

export async function verifySolanaMints(
  candidates: MarketCandidate[],
  apiKey?: string,
) {
  const startedAt = Date.now();
  const observedAt = new Date().toISOString();
  if (!apiKey) {
    return {
      candidates,
      health: {
        name: "helius-rpc",
        role: "chain",
        ok: false,
        discoveryOk: false,
        records: 0,
        latencyMs: 0,
        observedAt,
        error: "not configured",
      } satisfies DataSourceHealth,
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const endpoint = `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(apiKey)}`;
    const responses = await Promise.all(
      candidates.map((coin) =>
        fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: coin.tokenAddress,
            method: "getAccountInfo",
            params: [
              coin.tokenAddress,
              { encoding: "jsonParsed", commitment: "confirmed" },
            ],
          }),
          signal: controller.signal,
        }),
      ),
    );
    const failed = responses.find((response) => !response.ok);
    if (failed) throw new Error(`HTTP ${failed.status}`);
    const payload = (await Promise.all(
      responses.map((response) => response.json()),
    )) as JsonRpcResponse[];
    const byAddress = new Map(
      payload.map((item) => [String(item.id ?? ""), item]),
    );
    let verified = 0;
    const enriched = candidates.map((coin) => {
      const item = byAddress.get(coin.tokenAddress);
      const info = item?.result?.value?.data?.parsed?.info;
      const supply = info?.supply;
      const decimals = info?.decimals;
      const onchainVerified =
        typeof supply === "string" &&
        supply.length > 0 &&
        Number.isInteger(decimals);
      if (onchainVerified) verified += 1;
      return {
        ...coin,
        onchainVerified,
        onchainSupply: onchainVerified ? supply : null,
        onchainDecimals: onchainVerified ? decimals : null,
        mintAuthorityRevoked: onchainVerified
          ? info?.mintAuthority === null
          : false,
        freezeAuthorityRevoked: onchainVerified
          ? info?.freezeAuthority === null
          : false,
      };
    });

    return {
      candidates: enriched,
      health: {
        name: "helius-rpc",
        role: "chain",
        ok: verified === candidates.length && candidates.length > 0,
        discoveryOk: true,
        records: verified,
        latencyMs: Date.now() - startedAt,
        observedAt,
        error:
          verified === candidates.length
            ? undefined
            : `verified ${verified}/${candidates.length} mints`,
      } satisfies DataSourceHealth,
    };
  } catch (error) {
    return {
      candidates,
      health: {
        name: "helius-rpc",
        role: "chain",
        ok: false,
        discoveryOk: false,
        records: 0,
        latencyMs: Date.now() - startedAt,
        observedAt,
        error: error instanceof Error ? error.message.slice(0, 160) : "unknown",
      } satisfies DataSourceHealth,
    };
  } finally {
    clearTimeout(timeout);
  }
}
