#!/bin/bash
# Test search-news enhancements: sortBy parameter and deduplication
# Usage: ./scripts/test-search-enhancements.sh

NAMESPACE="mcp-soccer-news"
MCP_URL="http://localhost:3000/mcp"

echo "=== Testing search-news Enhancements ==="
echo ""

# Initialize session
echo "📡 Initializing MCP session..."
RESPONSE=$(curl -s -X POST "$MCP_URL" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -D /tmp/mcp_headers.txt \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2024-11-05",
      "capabilities": {},
      "clientInfo": {"name": "test", "version": "1.0"}
    }
  }')

SESSION_ID=$(grep -i "mcp-session-id:" /tmp/mcp_headers.txt | cut -d' ' -f2 | tr -d '\r\n')

if [ -z "$SESSION_ID" ]; then
  echo "❌ Failed to get session ID"
  exit 1
fi

echo "✅ Session ID: $SESSION_ID"
echo ""

# Test 1: Sort by similarity (default)
echo "🔍 Test 1: Sort by similarity (default)"
echo "Query: 'Premier League standings'"
curl -s -X POST "$MCP_URL" \
  -H "Content-Type: application/json" \
  -H "mcp-session-id: $SESSION_ID" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": {
      "name": "search-news",
      "arguments": {
        "query": "Premier League standings",
        "limit": 3,
        "sortBy": "similarity"
      }
    }
  }' | jq -r '.result.content[0].text' | jq '.results[] | "\(.title) | Score: \(.similarity) | Date: \(.publishedDate)"'

echo ""

# Test 2: Sort by date (newest first)
echo "📅 Test 2: Sort by date (newest first)"
echo "Query: 'Premier League standings'"
curl -s -X POST "$MCP_URL" \
  -H "Content-Type: application/json" \
  -H "mcp-session-id: $SESSION_ID" \
  -d '{
    "jsonrpc": "2.0",
    "id": 3,
    "method": "tools/call",
    "params": {
      "name": "search-news",
      "arguments": {
        "query": "Premier League standings",
        "limit": 3,
        "sortBy": "date"
      }
    }
  }' | jq -r '.result.content[0].text' | jq '.results[] | "\(.title) | Score: \(.similarity) | Date: \(.publishedDate)"'

echo ""

# Test 3: Default behavior (backward compatibility)
echo "🔄 Test 3: Default behavior (no sortBy specified)"
echo "Query: 'Manchester United'"
curl -s -X POST "$MCP_URL" \
  -H "Content-Type: application/json" \
  -H "mcp-session-id: $SESSION_ID" \
  -d '{
    "jsonrpc": "2.0",
    "id": 4,
    "method": "tools/call",
    "params": {
      "name": "search-news",
      "arguments": {
        "query": "Manchester United",
        "limit": 5
      }
    }
  }' | jq -r '.result.content[0].text' | jq '{resultsCount, uniqueTitles: [.results[].title]}'

echo ""

# Test 4: Deduplication test
echo "🔎 Test 4: Deduplication verification"
echo "Query: 'Champions League final' (common topic, likely duplicates)"
curl -s -X POST "$MCP_URL" \
  -H "Content-Type: application/json" \
  -H "mcp-session-id: $SESSION_ID" \
  -d '{
    "jsonrpc": "2.0",
    "id": 5,
    "method": "tools/call",
    "params": {
      "name": "search-news",
      "arguments": {
        "query": "Champions League final",
        "limit": 10,
        "sortBy": "date"
      }
    }
  }' | jq -r '.result.content[0].text' | jq -r '.results[] | "- \(.title)"'

echo ""
echo "✅ Tests complete"
echo ""
echo "Note: Run this script with the MCP server running locally on port 3000"
echo "Or update MCP_URL to point to your deployed instance"
