import { SearchResult } from '../types/embedding.js';
import { ArticleRepository } from '../database/repositories/ArticleRepository.js';
import { SentimentRepository } from '../database/repositories/SentimentRepository.js';
import { EmbeddingService } from './EmbeddingService.js';
import { logger } from '../utils/logger.js';

export type Recency = 'last-24h' | 'last-week' | 'last-month' | 'last-3-months' | 'last-year' | 'all-time';

const RECENCY_DAYS: Record<Recency, number | null> = {
  'last-24h': 1,
  'last-week': 7,
  'last-month': 30,
  'last-3-months': 90,
  'last-year': 365,
  'all-time': null,
};

export interface SearchOptions {
  limit?: number;
  minSimilarity?: number;
  sourceIds?: number[];
  dateFrom?: Date;
  dateTo?: Date;
  recency?: Recency;
  sentimentFilter?: string;
  includeSentiment?: boolean;
  sortBy?: 'similarity' | 'date';
}

export class SearchService {
  private articleRepo: ArticleRepository;
  private sentimentRepo: SentimentRepository;
  private embeddingService: EmbeddingService;

  constructor(
    articleRepo: ArticleRepository,
    sentimentRepo: SentimentRepository,
    embeddingService: EmbeddingService
  ) {
    this.articleRepo = articleRepo;
    this.sentimentRepo = sentimentRepo;
    this.embeddingService = embeddingService;
  }

  async search(
    query: string,
    options: SearchOptions = {}
  ): Promise<SearchResult[]> {
    const {
      limit = 10,
      minSimilarity = 0.3,
      sourceIds,
      dateTo,
      recency,
      sentimentFilter,
      includeSentiment = false,
      sortBy = 'date',
    } = options;

    let { dateFrom } = options;

    if (!dateFrom && !dateTo) {
      const days = recency ? RECENCY_DAYS[recency] : 30;
      if (days !== null) {
        dateFrom = new Date(Date.now() - days * 86_400_000);
      }
    }

    logger.info('Searching articles', { query, limit, minSimilarity, sortBy, dateFrom: dateFrom?.toISOString() });
    const start = Date.now();

    const embeddingResult = await this.embeddingService.generateEmbedding(query);

    let results = await this.articleRepo.searchByVector(
      embeddingResult.embedding,
      sentimentFilter ? limit * 3 : limit,
      minSimilarity,
      sourceIds,
      dateFrom,
      dateTo,
      sortBy
    );

    if (sentimentFilter || includeSentiment) {
      const articleIds = results.map((r) => r.id);
      const sentimentMap = await this.sentimentRepo.findByArticleIds(
        articleIds,
        'Xenova/distilbert-base-uncased-finetuned-sst-2-english'
      );

      results = results.map((result) => {
        const sentiment = sentimentMap.get(result.id);
        if (sentiment) {
          return {
            ...result,
            sentiment: {
              label: sentiment.sentimentLabel,
              score: sentiment.sentimentScore,
            },
          };
        }
        return result;
      });

      if (sentimentFilter) {
        results = results.filter(
          (r) => r.sentiment?.label.toLowerCase() === sentimentFilter.toLowerCase()
        );
        results = results.slice(0, limit);
      }
    }

    const duration = Date.now() - start;
    logger.info('Search completed', {
      query,
      results: results.length,
      duration,
    });

    return results;
  }
}
