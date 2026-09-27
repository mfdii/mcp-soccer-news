import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

const toolSuccess = new Counter('mcp_tool_success');
const toolError = new Counter('mcp_tool_error');
const toolDuration = new Trend('mcp_tool_duration', true);

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';

const MCP_HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json, text/event-stream',
};

const tools = [
  { name: 'search-news', args: { query: 'Premier League transfer', limit: 5 } },
  { name: 'search-news', args: { query: 'Champions League results', limit: 3 } },
  { name: 'search-news', args: { query: 'World Cup qualifying', limit: 5 } },
  { name: 'analyze-sentiment', args: { query: 'Arsenal', limit: 5 } },
  { name: 'analyze-sentiment', args: { query: 'Manchester United', limit: 3 } },
  { name: 'list-sources', args: {} },
  { name: 'get-recent-news', args: { limit: 10 } },
  { name: 'get-recent-news', args: { limit: 5 } },
  { name: 'ask-sir-alex', args: { question: 'What makes a great team?' } },
  { name: 'ask-sir-alex', args: { question: 'How do you handle pressure?' } },
  { name: 'get-random-quote', args: {} },
  { name: 'get-random-quote', args: {} },
  { name: 'get-quotes-by-topic', args: { topic: 'leadership' } },
  { name: 'get-quotes-by-topic', args: { topic: 'winning' } },
];

function callTool(tool) {
  const payload = JSON.stringify({
    jsonrpc: '2.0',
    id: Math.floor(Math.random() * 1e6),
    method: 'tools/call',
    params: { name: tool.name, arguments: tool.args },
  });

  const res = http.post(`${BASE_URL}/mcp`, payload, {
    headers: MCP_HEADERS,
    tags: { tool: tool.name },
  });

  const ok = check(res, {
    'status 200': (r) => r.status === 200,
    'has result': (r) => r.body && r.body.includes('"result"'),
  });

  if (ok) toolSuccess.add(1, { tool: tool.name });
  else toolError.add(1, { tool: tool.name });
  toolDuration.add(res.timings.duration, { tool: tool.name });

  return ok;
}

export const options = {
  scenarios: {
    populate: {
      executor: 'shared-iterations',
      vus: 2,
      iterations: tools.length * 3,
      maxDuration: '3m',
      exec: 'populate',
    },
    stress: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '30s', target: 5 },
        { duration: '1m', target: 10 },
        { duration: '30s', target: 20 },
        { duration: '1m', target: 20 },
        { duration: '30s', target: 0 },
      ],
      startTime: '3m30s',
      exec: 'stress',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.1'],
    mcp_tool_duration: ['p(95)<5000'],
  },
};

export default function () {
  const tool = tools[Math.floor(Math.random() * tools.length)];
  callTool(tool);
  sleep(0.3);
}

export function populate() {
  const tool = tools[__ITER % tools.length];
  callTool(tool);
  sleep(0.5);
}

export function stress() {
  const tool = tools[Math.floor(Math.random() * tools.length)];
  callTool(tool);
  sleep(0.1);
}
