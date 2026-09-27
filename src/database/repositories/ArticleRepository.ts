import { query } from '../client.js';
import { Article, SearchResult } from '../../types/embedding.js';
import { RSSArticle } from '../../types/rss.js';
import { logger } from '../../utils/logger.js';

export class ArticleRepository {
  async findById(id: number): Promise<Article | null> {
    const result = await query<any>(
      'SELECT * FROM articles WHERE id = $1',
      [id]
    );
    return result.rows.length > 0 ? this.mapRow(result.rows[0]) : null;
  }

  async findByGuid(guid: string): Promise<Article | null> {
    const result = await query<any>(
      'SELECT * FROM articles WHERE guid = $1',
      [guid]
    );
    return result.rows.length > 0 ? this.mapRow(result.rows[0]) : null;
  }

  async findRecent(
    limit: number = 20,
    sourceIds?: number[],
    hoursBack?: number
  ): Promise<Article[]> {
    let queryText = 'SELECT * FROM articles WHERE 1=1';
    const params: unknown[] = [];
    let paramIndex = 1;

    if (sourceIds && sourceIds.length > 0) {
      queryText += ` AND source_id = ANY($${paramIndex++})`;
      params.push(sourceIds);
    }

    if (hoursBack) {
      queryText += ` AND published_date >= NOW() - INTERVAL '${hoursBack} hours'`;
    }

    queryText += ` ORDER BY published_date DESC LIMIT $${paramIndex}`;
    params.push(limit);

    const result = await query<any>(queryText, params);
    return result.rows.map((row) => this.mapRow(row));
  }

  async create(
    sourceId: number,
    article: RSSArticle,
    embedding?: number[]
  ): Promise<Article> {
    const result = await query<any>(
      `INSERT INTO articles (
        source_id, guid, url, title, content, summary, author,
        published_date, image_url, categories, embedding
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *`,
      [
        sourceId,
        article.guid,
        article.url,
        article.title,
        article.content,
        article.summary,
        article.author,
        article.publishedDate,
        article.imageUrl,
        article.categories,
        embedding ? `[${embedding.join(',')}]` : null,
      ]
    );

    logger.debug('Article created', { guid: article.guid, title: article.title });
    return this.mapRow(result.rows[0]);
  }

  async updateEmbedding(id: number, embedding: number[]): Promise<void> {
    await query(
      `UPDATE articles SET embedding = $1 WHERE id = $2`,
      [`[${embedding.join(',')}]`, id]
    );
  }

  async findWithoutEmbeddings(limit: number = 100): Promise<Article[]> {
    const result = await query<any>(
      `SELECT * FROM articles WHERE embedding IS NULL LIMIT $1`,
      [limit]
    );
    return result.rows.map((row) => this.mapRow(row));
  }

  async searchByVector(
    queryEmbedding: number[],
    limit: number = 10,
    minSimilarity: number = 0.5,
    sourceIds?: number[],
    dateFrom?: Date,
    dateTo?: Date,
    sortBy: 'similarity' | 'date' = 'date'
  ): Promise<SearchResult[]> {
    let queryText = `SELECT * FROM articles WHERE embedding IS NOT NULL`;
    const params: unknown[] = [];
    let paramIndex = 1;

    if (sourceIds && sourceIds.length > 0) {
      queryText += ` AND source_id = ANY($${paramIndex++})`;
      params.push(sourceIds);
    }

    if (dateFrom) {
      queryText += ` AND published_date >= $${paramIndex++}`;
      params.push(dateFrom);
    }

    if (dateTo) {
      queryText += ` AND published_date <= $${paramIndex++}`;
      params.push(dateTo);
    }

    queryText += ` ORDER BY published_date DESC`;

    const result = await query<any>(queryText, params);

    // Calculate cosine similarity in-memory
    const resultsWithSimilarity = result.rows
      .map((row) => {
        try {
          // PostgreSQL JSONB is already parsed by pg driver
          let embedding = row.embedding;

          // If it's a string, parse it; otherwise use it directly
          if (typeof embedding === 'string') {
            embedding = JSON.parse(embedding);
          }

          // Skip empty or invalid embeddings
          if (!Array.isArray(embedding) || embedding.length === 0) {
            return null;
          }
          const similarity = this.cosineSimilarity(queryEmbedding, embedding);
          return {
            ...this.mapRow(row),
            similarity,
          };
        } catch (err) {
          logger.warn('Failed to parse embedding', { id: row.id, error: err instanceof Error ? err.message : String(err) });
          return null;
        }
      })
      .filter((r): r is SearchResult => r !== null && r.similarity >= minSimilarity)
      .sort((a, b) => {
        if (sortBy === 'date') {
          return b.publishedDate.getTime() - a.publishedDate.getTime();
        }
        return b.similarity - a.similarity;
      });

    // Deduplicate by title similarity (avoid returning near-duplicate stories)
    const uniqueResults: SearchResult[] = [];
    const seenTitles = new Set<string>();

    for (const result of resultsWithSimilarity) {
      // Normalize title for comparison
      const normalizedTitle = result.title
        .toLowerCase()
        .replace(/[^\w\s]/g, '')
        .trim();

      // Check for similar titles (simple approach)
      let isDuplicate = false;
      for (const seen of seenTitles) {
        if (this.titleSimilarity(normalizedTitle, seen) > 0.8) {
          isDuplicate = true;
          break;
        }
      }

      if (!isDuplicate) {
        uniqueResults.push(result);
        seenTitles.add(normalizedTitle);

        if (uniqueResults.length >= limit) {
          break;
        }
      }
    }

    return uniqueResults;
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      return 0;
    }

    let dotProduct = 0;
    let magnitudeA = 0;
    let magnitudeB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      magnitudeA += a[i] * a[i];
      magnitudeB += b[i] * b[i];
    }

    const magnitude = Math.sqrt(magnitudeA) * Math.sqrt(magnitudeB);
    return magnitude === 0 ? 0 : dotProduct / magnitude;
  }

  private titleSimilarity(title1: string, title2: string): number {
    // Simple Jaccard similarity for title deduplication
    const words1 = new Set(title1.split(/\s+/));
    const words2 = new Set(title2.split(/\s+/));

    const intersection = new Set([...words1].filter(x => words2.has(x)));
    const union = new Set([...words1, ...words2]);

    return union.size === 0 ? 0 : intersection.size / union.size;
  }

  async count(): Promise<number> {
    const result = await query<{ count: string }>('SELECT COUNT(*) as count FROM articles');
    return parseInt(result.rows[0].count);
  }

  private mapRow(row: any): Article {
    return {
      id: row.id,
      sourceId: row.source_id,
      guid: row.guid,
      url: row.url,
      title: row.title,
      content: row.content,
      summary: row.summary,
      author: row.author,
      publishedDate: new Date(row.published_date),
      fetchedAt: new Date(row.fetched_at),
      embedding: row.embedding,
      imageUrl: row.image_url,
      categories: row.categories || [],
      createdAt: new Date(row.created_at),
    };
  }
}
