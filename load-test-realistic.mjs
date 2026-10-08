// Realistic load test - respects rate limits
import { performance } from 'perf_hooks';

const BASE_URL = 'http://15.206.56.34/branch-visit/api/v1';
const CONCURRENCY = parseInt(process.argv[2]) || 20;
const DURATION_MS = (parseInt(process.argv[3]) || 60) * 1000;

let running = true;
let totalRequests = 0, successCount = 0, errorCount = 0, latencies = [], errors = [];
let authToken = null;

async function login() {
  try {
    const res = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@company.com', password: 'change-this-password' }),
    });
    if (res.ok) {
      const data = await res.json();
      authToken = data.access_token;
      console.log('✅ Login successful');
      return true;
    } else {
      console.error('❌ Login failed:', res.status, await res.text());
    }
  } catch (e) {
    console.error('❌ Login failed:', e.message);
  }
  return false;
}

async function makeRequest(endpoint) {
  const start = performance.now();
  try {
    const headers = { 'Accept': 'application/json' };
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
    
    const response = await fetch(`${BASE_URL}${endpoint}`, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(15000),
    });
    const latency = performance.now() - start;
    latencies.push(latency);
    if (response.ok) {
      successCount++;
    } else {
      errorCount++;
      if (errors.length < 5) errors.push(`${response.status} ${endpoint}`);
    }
  } catch (e) {
    const latency = performance.now() - start;
    latencies.push(latency);
    errorCount++;
    if (errors.length < 5) errors.push(`${e.message} ${endpoint}`);
  }
  totalRequests++;
}

async function worker(endpoint) {
  while (running) {
    await makeRequest(endpoint);
    await new Promise(r => setTimeout(r, 100)); // ~10 req/s per worker = 600/min total with 1 worker
  }
}

async function run() {
  console.log(`\n🚀 Load test: ${CONCURRENCY} concurrent, ${DURATION_MS/1000}s`);
  if (!(await login())) return;

  const startTime = Date.now();
  const workers = [];
  const endpoints = ['/health', '/visits?per_page=10', '/branches?limit=20', '/users/me'];
  
  for (let i = 0; i < CONCURRENCY; i++) {
    workers.push(worker(endpoints[i % endpoints.length]));
  }

  await new Promise(r => setTimeout(r, DURATION_MS));
  running = false;
  await Promise.allSettled(workers);

  const elapsed = (Date.now() - startTime) / 1000;
  const rps = totalRequests / elapsed;
  latencies.sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.5)] || 0;
  const p95 = latencies[Math.floor(latencies.length * 0.95)] || 0;
  const p99 = latencies[Math.floor(latencies.length * 0.99)] || 0;
  const avg = latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0;

  console.log('\n📊 Results:');
  console.log(`  Total: ${totalRequests} | Success: ${successCount} (${((successCount/totalRequests)*100).toFixed(1)}%) | Errors: ${errorCount}`);
  console.log(`  Duration: ${elapsed.toFixed(1)}s | Throughput: ${rps.toFixed(1)} req/s`);
  console.log(`  Latency: Avg ${avg.toFixed(1)}ms | P50 ${p50.toFixed(1)}ms | P95 ${p95.toFixed(1)}ms | P99 ${p99.toFixed(1)}ms`);
  if (errors.length) {
    console.log(`  Sample errors: ${errors.join('; ')}`);
  }
}

run().catch(console.error);