import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';

const register = new Registry();

collectDefaultMetrics({ register });

new Gauge({
  name: 'mcp_server_info',
  help: 'MCP server identification',
  labelNames: ['name', 'version'] as const,
  registers: [register],
}).set({ name: 'soccer-news-mcp', version: '2.0.0' }, 1);

const toolCallsTotal = new Counter({
  name: 'mcp_tool_calls_total',
  help: 'Total number of MCP tool invocations',
  labelNames: ['tool', 'status'] as const,
  registers: [register],
});

const toolDurationSeconds = new Histogram({
  name: 'mcp_tool_duration_seconds',
  help: 'Duration of MCP tool execution in seconds',
  labelNames: ['tool'] as const,
  registers: [register],
});

const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'path', 'status_code'] as const,
  registers: [register],
});

const httpRequestDurationSeconds = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'path'] as const,
  registers: [register],
});

export function withMetrics<TArgs, TResult>(
  toolName: string,
  handler: (args: TArgs) => Promise<TResult>,
): (args: TArgs) => Promise<TResult> {
  return async (args: TArgs): Promise<TResult> => {
    const end = toolDurationSeconds.startTimer({ tool: toolName });
    try {
      const result = await handler(args);
      const status = (result as any)?.isError ? 'error' : 'success';
      toolCallsTotal.inc({ tool: toolName, status });
      return result;
    } catch (error) {
      toolCallsTotal.inc({ tool: toolName, status: 'error' });
      throw error;
    } finally {
      end();
    }
  };
}

export function httpMetrics(req: any, res: any, next: any): void {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const durationSec = Number(process.hrtime.bigint() - start) / 1e9;
    const path = req.path;
    httpRequestsTotal.inc({ method: req.method, path, status_code: String(res.statusCode) });
    httpRequestDurationSeconds.observe({ method: req.method, path }, durationSec);
  });
  next();
}

const articlesTotal = new Gauge({
  name: 'soccer_news_articles_total',
  help: 'Total number of articles in the database',
  registers: [register],
});

const articlesWithEmbeddings = new Gauge({
  name: 'soccer_news_articles_with_embeddings',
  help: 'Number of articles with embeddings',
  registers: [register],
});

const articlesWithSentiment = new Gauge({
  name: 'soccer_news_articles_with_sentiment',
  help: 'Number of articles with sentiment analysis',
  registers: [register],
});

const sourcesActive = new Gauge({
  name: 'soccer_news_sources_active',
  help: 'Number of active RSS feed sources',
  registers: [register],
});

const lastFetchTimestamp = new Gauge({
  name: 'soccer_news_last_fetch_timestamp_seconds',
  help: 'Unix timestamp of the most recently fetched article',
  registers: [register],
});

const quotesTotal = new Gauge({
  name: 'soccer_news_quotes_total',
  help: 'Total number of manager quotes',
  registers: [register],
});

async function refreshDomainMetrics(pool: any): Promise<void> {
  try {
    const result = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM articles) AS articles,
        (SELECT COUNT(*) FROM articles WHERE embedding IS NOT NULL) AS with_embeddings,
        (SELECT COUNT(DISTINCT article_id) FROM sentiment_cache) AS with_sentiment,
        (SELECT COUNT(*) FROM sources WHERE active = true) AS active_sources,
        (SELECT EXTRACT(EPOCH FROM MAX(fetched_at)) FROM articles) AS last_fetch,
        (SELECT COUNT(*) FROM manager_quotes) AS quotes
    `);
    const row = result.rows[0];
    articlesTotal.set(Number(row.articles));
    articlesWithEmbeddings.set(Number(row.with_embeddings));
    articlesWithSentiment.set(Number(row.with_sentiment));
    sourcesActive.set(Number(row.active_sources));
    if (row.last_fetch) lastFetchTimestamp.set(Number(row.last_fetch));
    quotesTotal.set(Number(row.quotes));
  } catch {
    // DB unavailable — gauges keep their last value
  }
}

let domainInterval: ReturnType<typeof setInterval> | null = null;

export function startDomainMetrics(pool: any): void {
  refreshDomainMetrics(pool);
  domainInterval = setInterval(() => refreshDomainMetrics(pool), 60_000);
  domainInterval.unref();
}

export async function getMetrics(): Promise<{ contentType: string; metrics: string }> {
  return {
    contentType: register.contentType,
    metrics: await register.metrics(),
  };
}
