// Quick load test for deployed API
// Usage: node load-test.mjs [concurrency] [duration-seconds]
// Default: 100 concurrent, 30 seconds

import { performance } from 'perf_hooks';

const BASE_URL = 'http://15.206.56.34/branch-visit/api/v1';
const CONCURRENCY = parseInt(process.argv[2]) || 100;
const DURATION_MS = (parseInt(process.argv[3]) || 30) * 1000;
const ENDPOINTS = ['/health', '/visits?per_page=5', '/branches?limit=10'];

let running = true;
let totalRequests = 0;
let successCount = 0;
let errorCount = 0;
let latencies = [];

async function makeRequest(endpoint) {
  const start = performance.now();
  try {
    const response = await fetch(`${BASE_URL}${endpoint}`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    const latency = performance.now() - start;
    latencies.push(latency);
    if (response.ok) successCount++; else errorCount++;
  } catch (e) {
    const latency = performance.now() - start;
    latencies.push(latency);
    errorCount++;
  }
  totalRequests++;
}

async function worker(endpoint) {
  while (running) {
    await makeRequest(endpoint);
    // Small delay to avoid overwhelming
    await new Promise(r => setTimeout(r, 10));
  }
}

async function run() {
  console.log(`\n🚀 Starting load test: ${CONCURRENCY} concurrent workers for ${DURATION_MS/1000}s`);
  console.log(`Target: ${BASE_URL}`);
  console.log(`Endpoints: ${ENDPOINTS.join(', ')}\n`);

  const startTime = Date.now();
  const workers = [];

  for (let i = 0; i < CONCURRENCY; i++) {
    const endpoint = ENDPOINTS[i % ENDPOINTS.length];
    workers.push(worker(endpoint));
  }

  // Run for duration
  await new Promise(r => setTimeout(r, DURATION_MS));
  running = false;

  // Wait for in-flight requests
  await Promise.allSettled(workers);

  const elapsed = (Date.now() - startTime) / 1000;
  const rps = totalRequests / elapsed;

  latencies.sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.5)];
  const p95 = latencies[Math.floor(latencies.length * 0.95)];
  const p99 = latencies[Math.floor(latencies.length * 0.99)];
  const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;

  console.log('\n📊 Results:');
  console.log(`  Total requests: ${totalRequests}`);
  console.log(`  Success: ${successCount} (${((successCount/totalRequests)*100).toFixed(1)}%)`);
  console.log(`  Errors: ${errorCount} (${((errorCount/totalRequests)*100).toFixed(1)}%)`);
  console.log(`  Duration: ${elapsed.toFixed(1)}s`);
  console.log(`  Throughput: ${rps.toFixed(1)} req/s`);
  console.log(`\n📈 Latency (ms):`);
  console.log(`  Avg: ${avg.toFixed(1)}`);
  console.log(`  P50: ${p50.toFixed(1)}`);
  console.log(`  P95: ${p95.toFixed(1)}`);
  console.log(`  P99: ${p99.toFixed(1)}`);
}

run().catch(console.error);