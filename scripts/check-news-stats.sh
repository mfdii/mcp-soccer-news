#!/bin/bash
# Check MCP Soccer News fetching statistics
# Usage: ./scripts/check-news-stats.sh

NAMESPACE="mcp-soccer-news"

echo "=== MCP Soccer News - Statistics ==="
echo ""

# CronJob Status
echo "📅 CronJob Status:"
SCHEDULE=$(oc get cronjob mcp-soccer-news-fetch -n $NAMESPACE -o jsonpath='{.spec.schedule}')
LAST_SCHEDULE=$(oc get cronjob mcp-soccer-news-fetch -n $NAMESPACE -o jsonpath='{.status.lastScheduleTime}')
LAST_SUCCESS=$(oc get cronjob mcp-soccer-news-fetch -n $NAMESPACE -o jsonpath='{.status.lastSuccessfulTime}')
echo "  Schedule: $SCHEDULE (every 3 hours)"
echo "  Last run: $LAST_SCHEDULE"
echo "  Last success: $LAST_SUCCESS"
echo ""

# Last Job Results
echo "📊 Last Fetch Job:"
LAST_JOB=$(oc get jobs -n $NAMESPACE --sort-by=.metadata.creationTimestamp | grep mcp-soccer-news-fetch | tail -1 | awk '{print $1}')
if [ -n "$LAST_JOB" ]; then
  COMPLETIONS=$(oc get job $LAST_JOB -n $NAMESPACE -o jsonpath='{.status.succeeded}')
  DURATION=$(oc get job $LAST_JOB -n $NAMESPACE -o jsonpath='{.status.completionTime}' | xargs -I {} date -u -j -f "%Y-%m-%dT%H:%M:%SZ" {} "+%s" 2>/dev/null)
  START=$(oc get job $LAST_JOB -n $NAMESPACE -o jsonpath='{.status.startTime}' | xargs -I {} date -u -j -f "%Y-%m-%dT%H:%M:%SZ" {} "+%s" 2>/dev/null)

  echo "  Job: $LAST_JOB"
  echo "  Status: Complete ($COMPLETIONS/1)"

  # Extract stats from logs
  LOGS=$(oc logs -n $NAMESPACE job/$LAST_JOB 2>/dev/null | grep "Feed fetch job completed")
  if [ -n "$LOGS" ]; then
    SOURCES=$(echo "$LOGS" | grep -o '"sources":[0-9]*' | cut -d: -f2)
    PROCESSED=$(echo "$LOGS" | grep -o '"totalProcessed":[0-9]*' | cut -d: -f2)
    SAVED=$(echo "$LOGS" | grep -o '"totalSaved":[0-9]*' | cut -d: -f2)
    echo "  Articles processed: $PROCESSED"
    echo "  Articles saved: $SAVED"
    echo "  Sources: $SOURCES"
  fi
fi
echo ""

# Database Statistics
echo "🗄️  Database Statistics:"
DB_STATS=$(oc exec -n $NAMESPACE deployment/postgres -- psql -U soccernews -d soccer_news -t -c "
SELECT
  COUNT(*) as total,
  COUNT(CASE WHEN published_date > NOW() - INTERVAL '24 hours' THEN 1 END) as last_24h,
  COUNT(CASE WHEN published_date > NOW() - INTERVAL '7 days' THEN 1 END) as last_7d,
  COUNT(CASE WHEN embedding IS NOT NULL THEN 1 END) as with_embeddings
FROM articles;
" 2>/dev/null)

if [ -n "$DB_STATS" ]; then
  TOTAL=$(echo "$DB_STATS" | awk '{print $1}')
  LAST_24H=$(echo "$DB_STATS" | awk '{print $3}')
  LAST_7D=$(echo "$DB_STATS" | awk '{print $5}')
  EMBEDDINGS=$(echo "$DB_STATS" | awk '{print $7}')

  echo "  Total articles: $TOTAL"
  echo "  Last 24 hours: $LAST_24H"
  echo "  Last 7 days: $LAST_7D"
  echo "  With embeddings: $EMBEDDINGS ($((EMBEDDINGS * 100 / TOTAL))%)"
fi
echo ""

# Source Breakdown
echo "📰 Articles by Source (Last 7 Days):"
oc exec -n $NAMESPACE deployment/postgres -- psql -U soccernews -d soccer_news -t -c "
SELECT
  s.name,
  COUNT(*) as count
FROM articles a
JOIN sources s ON a.source_id = s.id
WHERE a.published_date > NOW() - INTERVAL '7 days'
GROUP BY s.name
ORDER BY count DESC;
" 2>/dev/null | while read -r line; do
  if [ -n "$line" ]; then
    echo "  $line"
  fi
done
echo ""

# Quote Statistics
echo "💬 Quote Statistics:"
QUOTE_STATS=$(oc exec -n $NAMESPACE deployment/postgres -- psql -U soccernews -d soccer_news -t -c "
SELECT
  COUNT(*) as total,
  COUNT(DISTINCT manager_name) as managers,
  COUNT(CASE WHEN embedding IS NOT NULL THEN 1 END) as with_embeddings
FROM manager_quotes;
" 2>/dev/null)

if [ -n "$QUOTE_STATS" ]; then
  TOTAL_Q=$(echo "$QUOTE_STATS" | awk '{print $1}')
  MANAGERS=$(echo "$QUOTE_STATS" | awk '{print $3}')
  EMBED_Q=$(echo "$QUOTE_STATS" | awk '{print $5}')

  echo "  Total quotes: $TOTAL_Q"
  echo "  Unique managers: $MANAGERS"
  echo "  With embeddings: $EMBED_Q"
fi

echo ""
echo "✅ Statistics check complete"
