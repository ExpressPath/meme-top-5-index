const PUBLIC_RPC_ENDPOINTS = [
  "https://solana-rpc.publicnode.com",
  "https://api.mainnet-beta.solana.com",
];

type RpcResponse<T> = {
  result?: T;
  error?: { message?: string };
};

export async function requestSolanaRpc<T>({
  apiKey,
  fetcher = fetch,
  id,
  method,
  params,
  timeoutMs = 6_000,
}: {
  apiKey?: string;
  fetcher?: typeof fetch;
  id: string;
  method: string;
  params: unknown[];
  timeoutMs?: number;
}): Promise<T> {
  const endpoints = apiKey
    ? [
        `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(apiKey)}`,
      ]
    : PUBLIC_RPC_ENDPOINTS;
  const failures: string[] = [];

  for (const endpoint of endpoints) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id,
          method,
          params,
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = (await response.json()) as RpcResponse<T>;
      if (payload.error) {
        throw new Error(payload.error.message ?? `${method} failed`);
      }
      return payload.result as T;
    } catch (error) {
      failures.push(
        `${new URL(endpoint).hostname}: ${
          error instanceof Error ? error.message : "request failed"
        }`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error(`RPC providers unavailable: ${failures.join("; ")}`);
}
