import { pipeline, env } from '@xenova/transformers';
import { EmbeddingResult } from '../types/embedding.js';
import { getModelConfig } from '../config/models.js';
import { logger } from '../utils/logger.js';
import { inferenceSemaphore } from './Semaphore.js';

export class EmbeddingService {
  private model: any = null;
  private modelName: string;
  private dimensions: number;
  private maxBatchSize: number;

  constructor() {
    const config = getModelConfig();
    this.modelName = config.embeddingModel;
    this.dimensions = config.embeddingDimensions;
    this.maxBatchSize = config.maxBatchSize;

    env.cacheDir = config.modelCachePath;
  }

  async initialize(): Promise<void> {
    if (this.model) {
      return;
    }

    logger.info('Loading embedding model', { model: this.modelName });
    const start = Date.now();

    try {
      this.model = await pipeline('feature-extraction', this.modelName);
      const duration = Date.now() - start;
      logger.info('Embedding model loaded', {
        model: this.modelName,
        duration,
      });
    } catch (err) {
      logger.error('Failed to load embedding model', {
        model: this.modelName,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  async generateEmbedding(text: string): Promise<EmbeddingResult> {
    if (!this.model) {
      await this.initialize();
    }

    const start = Date.now();

    try {
      const output: any = await inferenceSemaphore.run(() =>
        this.model(text, { pooling: 'mean', normalize: true })
      );

      const embedding = Array.from(output.data) as number[];
      const duration = Date.now() - start;

      logger.debug('Embedding generated', {
        textLength: text.length,
        dimensions: embedding.length,
        duration,
      });

      return {
        embedding,
        dimensions: embedding.length,
        modelName: this.modelName,
      };
    } catch (err) {
      logger.error('Embedding generation failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  async generateBatchEmbeddings(texts: string[]): Promise<EmbeddingResult[]> {
    if (!this.model) {
      await this.initialize();
    }

    if (texts.length === 0) {
      return [];
    }

    if (texts.length > this.maxBatchSize) {
      logger.warn('Batch size exceeds maximum, processing in chunks', {
        requested: texts.length,
        maxBatchSize: this.maxBatchSize,
      });

      const results: EmbeddingResult[] = [];
      for (let i = 0; i < texts.length; i += this.maxBatchSize) {
        const chunk = texts.slice(i, i + this.maxBatchSize);
        const chunkResults = await this.generateBatchEmbeddings(chunk);
        results.push(...chunkResults);
      }
      return results;
    }

    const start = Date.now();
    logger.info('Generating batch embeddings', { count: texts.length });

    try {
      const results: EmbeddingResult[] = [];

      for (const text of texts) {
        const result = await this.generateEmbedding(text);
        results.push(result);
      }

      const duration = Date.now() - start;
      logger.info('Batch embeddings generated', {
        count: texts.length,
        duration,
        avgDuration: Math.round(duration / texts.length),
      });

      return results;
    } catch (err) {
      logger.error('Batch embedding generation failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  prepareTextForEmbedding(title: string, content?: string | null): string {
    if (content) {
      const truncatedContent = content.substring(0, 500);
      return `${title}\n\n${truncatedContent}`;
    }
    return title;
  }
}
