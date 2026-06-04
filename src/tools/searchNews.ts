import { z } from 'zod';
import { SearchService } from '../services/SearchService.js';

const SearchNewsSchema = z.object({
  query: z.string(),
  limit: z.number().optional(),
  minSimilarity: z.number().optional(),
  sourceIds: z.array(z.number()).optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  sentimentFilter: z.string().optional(),
  includeSentiment: z.boolean().optional(),
  sortBy: z.enum(['similarity', 'date']).optional(),
});

export const searchNewsTool = {
  name: 'search-news',
  description: 'Semantic search across stored articles using vector similarity',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query for semantic matching',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results to return (default: 10)',
      },
      minSimilarity: {
        type: 'number',
        description: 'Minimum similarity score 0-1 (default: 0.5)',
      },
      sourceIds: {
        type: 'array',
        items: { type: 'number' },
        description: 'Filter by source IDs',
      },
      dateFrom: {
        type: 'string',
        description: 'Filter articles from this date (ISO 8601)',
      },
      dateTo: {
        type: 'string',
        description: 'Filter articles to this date (ISO 8601)',
      },
      sentimentFilter: {
        type: 'string',
        description: 'Filter by sentiment label (positive/negative)',
      },
      includeSentiment: {
        type: 'boolean',
        description: 'Include sentiment data in results',
      },
      sortBy: {
        type: 'string',
        enum: ['similarity', 'date'],
        description: 'Sort results by similarity score (default) or date (newest first)',
      },
    },
    required: ['query'],
  },
};

export async function handleSearchNews(
  args: unknown,
  searchService: SearchService
): Promise<string> {
  const params = SearchNewsSchema.parse(args);

  const results = await searchService.search(params.query, {
    limit: params.limit,
    minSimilarity: params.minSimilarity,
    sourceIds: params.sourceIds,
    dateFrom: params.dateFrom ? new Date(params.dateFrom) : undefined,
    dateTo: params.dateTo ? new Date(params.dateTo) : undefined,
    sentimentFilter: params.sentimentFilter,
    includeSentiment: params.includeSentiment,
    sortBy: params.sortBy,
  });

  const formatted = {
    query: params.query,
    resultsCount: results.length,
    results: results.map((r) => ({
      id: r.id,
      title: r.title,
      url: r.url,
      publishedDate: r.publishedDate,
      similarity: r.similarity,
      summary: r.summary?.substring(0, 200),
      sentiment: r.sentiment,
    })),
  };

  return JSON.stringify(formatted, null, 2);
}
