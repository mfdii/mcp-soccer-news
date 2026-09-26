#!/usr/bin/env node
import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import express from 'express';
import { z } from 'zod';
import { logger } from './utils/logger.js';
import { getPool, closePool } from './database/client.js';
import { SourceRepository } from './database/repositories/SourceRepository.js';
import { ArticleRepository } from './database/repositories/ArticleRepository.js';
import { SentimentRepository } from './database/repositories/SentimentRepository.js';
import { QuoteRepository } from './database/repositories/QuoteRepository.js';
import { RSSFetcherService } from './services/RSSFetcherService.js';
import { EmbeddingService } from './services/EmbeddingService.js';
import { SentimentService } from './services/SentimentService.js';
import { SearchService } from './services/SearchService.js';
import { QuoteSearchService } from './services/QuoteSearchService.js';
import {
  handleFetchFeeds,
  handleSearchNews,
  handleAnalyzeSentiment,
  handleListSources,
  handleGetRecentNews,
  handleManageSources,
  handleAskSirAlex,
  handleGetRandomQuote,
  handleGetQuotesByTopic,
} from './tools/index.js';

const sourceRepo = new SourceRepository();
const articleRepo = new ArticleRepository();
const sentimentRepo = new SentimentRepository();
const quoteRepo = new QuoteRepository();

const rssFetcher = new RSSFetcherService(sourceRepo, articleRepo);
const embeddingService = new EmbeddingService();
const sentimentService = new SentimentService();
const searchService = new SearchService(
  articleRepo,
  sentimentRepo,
  embeddingService
);
const quoteSearchService = new QuoteSearchService(quoteRepo, embeddingService);

const handler = createMcpHandler(() => {
  const server = new McpServer(
    { name: 'soccer-news-mcp', version: '2.0.0' },
    { capabilities: { tools: {} } },
  );

  server.registerTool('fetch-feeds', {
    description: 'Fetch and process RSS feeds, store articles with embeddings',
    inputSchema: {
      sourceIds: z.array(z.number()).optional().describe('Specific source IDs to fetch (fetches all if omitted)'),
      maxArticlesPerSource: z.number().optional().describe('Maximum articles per source (default: 20)'),
      skipEmbeddings: z.boolean().optional().describe('Skip generating embeddings (faster but no semantic search)'),
    } as any,
  }, async (args: any) => {
    const text = await handleFetchFeeds(args, rssFetcher, embeddingService, articleRepo);
    return { content: [{ type: 'text' as const, text }] };
  });

  server.registerTool('search-news', {
    description: 'Semantic search across stored articles using vector similarity',
    inputSchema: {
      query: z.string().describe('Search query (natural language)'),
      limit: z.number().optional().describe('Maximum results to return (default: 10)'),
      minSimilarity: z.number().optional().describe('Minimum similarity score 0-1 (default: 0.3)'),
      sourceIds: z.array(z.number()).optional().describe('Filter by specific source IDs'),
      dateFrom: z.string().optional().describe('Filter articles from this date (ISO format)'),
      dateTo: z.string().optional().describe('Filter articles until this date (ISO format)'),
      sentimentFilter: z.string().optional().describe('Filter by sentiment (positive, negative, neutral)'),
      includeSentiment: z.boolean().optional().describe('Include sentiment analysis in results'),
      sortBy: z.enum(['similarity', 'date']).optional().describe('Sort results by similarity or date'),
    } as any,
  }, async (args: any) => {
    const text = await handleSearchNews(args, searchService);
    return { content: [{ type: 'text' as const, text }] };
  });

  server.registerTool('analyze-sentiment', {
    description: 'Analyze sentiment for specific articles',
    inputSchema: {
      articleIds: z.array(z.number()).optional().describe('Specific article IDs to analyze'),
      limit: z.number().optional().describe('Number of unanalyzed articles to process (default: 10)'),
      reanalyze: z.boolean().optional().describe('Re-analyze articles that already have sentiment'),
    } as any,
  }, async (args: any) => {
    const text = await handleAnalyzeSentiment(args, sentimentService, articleRepo, sentimentRepo);
    return { content: [{ type: 'text' as const, text }] };
  });

  server.registerTool('list-sources', {
    description: 'List configured RSS feed sources with statistics',
    inputSchema: {
      activeOnly: z.boolean().optional().describe('Only show active sources (default: false)'),
    } as any,
  }, async (args: any) => {
    const text = await handleListSources(args, sourceRepo);
    return { content: [{ type: 'text' as const, text }] };
  });

  server.registerTool('get-recent-news', {
    description: 'Get most recent articles without semantic search (simple time-based)',
    inputSchema: {
      limit: z.number().optional().describe('Number of articles to return (default: 10)'),
      sourceIds: z.array(z.number()).optional().describe('Filter by specific source IDs'),
      hoursBack: z.number().optional().describe('Only articles from the last N hours'),
      includeSentiment: z.boolean().optional().describe('Include sentiment analysis in results'),
    } as any,
  }, async (args: any) => {
    const text = await handleGetRecentNews(args, articleRepo, sentimentRepo);
    return { content: [{ type: 'text' as const, text }] };
  });

  server.registerTool('manage-sources', {
    description: 'Add, update, or remove RSS feed sources',
    inputSchema: {
      action: z.enum(['add', 'update', 'delete', 'toggle']).describe('Action to perform'),
      sourceId: z.number().optional().describe('Source ID (required for update/delete/toggle)'),
      name: z.string().optional().describe('Source name (required for add)'),
      rssUrl: z.string().optional().describe('RSS feed URL (required for add)'),
      category: z.string().optional().describe('Source category'),
      active: z.boolean().optional().describe('Whether source is active'),
    } as any,
  }, async (args: any) => {
    const text = await handleManageSources(args, sourceRepo);
    return { content: [{ type: 'text' as const, text }] };
  });

  server.registerTool('ask-sir-alex', {
    description: 'Get wisdom from Sir Alex Ferguson and other famous football managers based on your question',
    inputSchema: {
      question: z.string().describe('Your question or topic to get manager wisdom about'),
      limit: z.number().optional().describe('Number of quotes to return (default: 3)'),
      minSimilarity: z.number().optional().describe('Minimum relevance score 0-1 (default: 0.3)'),
    } as any,
  }, async (args: any) => {
    const text = await handleAskSirAlex(args, quoteSearchService);
    return { content: [{ type: 'text' as const, text }] };
  });

  server.registerTool('get-random-quote', {
    description: 'Get a random quote from Sir Alex Ferguson or other famous managers (fast, no semantic search)',
    inputSchema: {
      manager: z.string().optional().describe('Filter by specific manager name'),
    } as any,
  }, async (args: any) => {
    const text = await handleGetRandomQuote(args, quoteRepo);
    return { content: [{ type: 'text' as const, text }] };
  });

  server.registerTool('get-quotes-by-topic', {
    description: 'Get quotes categorized by topic (faster than semantic search, contextually relevant)',
    inputSchema: {
      topic: z.enum(['rivalry', 'passion', 'leadership', 'tactics', 'winning', 'motivation', 'philosophy']).describe('Quote topic'),
      limit: z.number().optional().describe('Number of quotes to return (default: 5)'),
    } as any,
  }, async (args: any) => {
    const text = await handleGetQuotesByTopic(args, quoteRepo);
    return { content: [{ type: 'text' as const, text }] };
  });

  return server;
});

const app = express();

app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'soccer-news-mcp',
    timestamp: new Date().toISOString(),
  });
});

app.get('/ready', async (_req, res) => {
  try {
    const pool = getPool();
    await pool.query('SELECT 1');
    res.status(200).json({
      status: 'ready',
      service: 'soccer-news-mcp',
      database: 'connected',
    });
  } catch (error) {
    res.status(503).json({
      status: 'not ready',
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

const nodeHandler = toNodeHandler(handler);
app.all('/mcp', (req, res) => { void nodeHandler(req, res); });

const port = parseInt(process.env.PORT || '8080', 10);

async function initializeServices(): Promise<void> {
  logger.info('Initializing services');

  const pool = getPool();
  await pool.query('SELECT 1');
  logger.info('Database connection verified');

  await embeddingService.initialize();
  await sentimentService.initialize();

  logger.info('All services initialized');
}

(async () => {
  try {
    await initializeServices();

    app.listen(port, () => {
      logger.info('Soccer News MCP server started', { port });
    });
  } catch (error) {
    logger.error('Failed to start server', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }
})();

process.on('SIGTERM', async () => {
  logger.info('Shutting down server');
  await handler.close();
  await closePool();
  process.exit(0);
});
