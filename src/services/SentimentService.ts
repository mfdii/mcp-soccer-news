import { pipeline, env } from '@xenova/transformers';
import { SentimentAnalysis } from '../types/sentiment.js';
import { getModelConfig } from '../config/models.js';
import { logger } from '../utils/logger.js';
import { inferenceSemaphore } from './Semaphore.js';

export class SentimentService {
  private model: any = null;
  private modelName: string;

  constructor() {
    const config = getModelConfig();
    this.modelName = config.sentimentModel;
    env.cacheDir = config.modelCachePath;
  }

  async initialize(): Promise<void> {
    if (this.model) {
      return;
    }

    logger.info('Loading sentiment model', { model: this.modelName });
    const start = Date.now();

    try {
      this.model = await pipeline('sentiment-analysis', this.modelName);
      const duration = Date.now() - start;
      logger.info('Sentiment model loaded', {
        model: this.modelName,
        duration,
      });
    } catch (err) {
      logger.error('Failed to load sentiment model', {
        model: this.modelName,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  async analyzeSentiment(text: string): Promise<SentimentAnalysis> {
    if (!this.model) {
      await this.initialize();
    }

    const start = Date.now();

    try {
      const truncatedText = text.substring(0, 512);
      const output: any = await inferenceSemaphore.run(() => this.model(truncatedText));

      const result = output[0];
      const duration = Date.now() - start;

      logger.debug('Sentiment analyzed', {
        textLength: text.length,
        label: result.label,
        score: result.score,
        duration,
      });

      return {
        label: result.label.toLowerCase(),
        score: result.score,
      };
    } catch (err) {
      logger.error('Sentiment analysis failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  async analyzeBatchSentiment(texts: string[]): Promise<SentimentAnalysis[]> {
    if (!this.model) {
      await this.initialize();
    }

    if (texts.length === 0) {
      return [];
    }

    const start = Date.now();
    logger.info('Analyzing batch sentiment', { count: texts.length });

    try {
      const results: SentimentAnalysis[] = [];

      for (const text of texts) {
        const result = await this.analyzeSentiment(text);
        results.push(result);
      }

      const duration = Date.now() - start;
      logger.info('Batch sentiment analysis completed', {
        count: texts.length,
        duration,
        avgDuration: Math.round(duration / texts.length),
      });

      return results;
    } catch (err) {
      logger.error('Batch sentiment analysis failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  prepareTextForSentiment(title: string, content?: string | null): string {
    if (content) {
      const truncatedContent = content.substring(0, 400);
      return `${title}\n\n${truncatedContent}`;
    }
    return title;
  }

  getModelName(): string {
    return this.modelName;
  }
}
