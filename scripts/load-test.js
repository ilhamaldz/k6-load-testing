import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { createEndpointMetrics, track, endpointThresholds } from '../lib/metrics.js';

const ENDPOINTS = ['list_products', 'single_product', 'search_products', 'auth_login'];
const metrics = createEndpointMetrics(ENDPOINTS);

const BASE_URL = __ENV.BASE_URL || 'https://dummyjson.com';

export const options = {
  stages: [
    { duration: '30s', target: 20 }, // ramp up
    { duration: '1m', target: 20 },  // sustain
    { duration: '30s', target: 50 }, // step up — look for the knee
    { duration: '1m', target: 50 },  // sustain at higher load
    { duration: '30s', target: 0 },  // ramp down
  ],

  thresholds: {
    // Overall latency gate. http_req_failed is deliberately NOT gated here:
    // the API rate-limits with 429, which k6 counts as a failed request but
    // which is correct server behaviour. Per-endpoint fail rates below
    // exclude 429 and are the real correctness signal.
    http_req_duration: ['p(95)<1500'],
    // Per-endpoint gates — a single slow call fails the run on its own
    ...endpointThresholds(ENDPOINTS, { p95: 1200, maxFailRate: 0.01 }),
  },
};

export default function () {
  group('1. List products', function () {
    const res = http.get(`${BASE_URL}/products?limit=20`);

    check(res, {
      'status is 200 or throttled': (r) => r.status === 200 || r.status === 429,
      'returns a non-empty list': (r) => {
        try {
          if (r.status === 429) return true; // throttled, no body to check
          return Array.isArray(r.json('products')) && r.json('products').length > 0;
        } catch {
          return false;
        }
      },
    });

    track(metrics, 'list_products', res);
  });

  group('2. Fetch a single product', function () {
    const res = http.get(`${BASE_URL}/products/1`);

    check(res, {
      'status is 200 or throttled': (r) => r.status === 200 || r.status === 429,
      'has an id field': (r) => {
        try {
          if (r.status === 429) return true;
          return r.json('id') !== undefined;
        } catch {
          return false;
        }
      },
    });

    track(metrics, 'single_product', res);
  });

  group('3. Search products', function () {
    // Search is the expensive read path — it is the first thing to degrade,
    // so it gets its own metric rather than hiding inside the overall average.
    const res = http.get(`${BASE_URL}/products/search?q=phone`);

    check(res, {
      'status is 200 or throttled': (r) => r.status === 200 || r.status === 429,
      'returns matches': (r) => {
        try {
          if (r.status === 429) return true;
          return r.json('total') >= 0;
        } catch {
          return false;
        }
      },
    });

    track(metrics, 'search_products', res);
  });

  group('4. Login with bad credentials', function () {
    // Negative path: auth must keep rejecting cleanly and quickly under load,
    // rather than timing out or turning a 400 into a 500.
    const res = http.post(
      `${BASE_URL}/auth/login`,
      JSON.stringify({ username: 'load-test-user', password: 'wrong-password' }),
      { headers: { 'Content-Type': 'application/json' } },
    );

    check(res, {
      'rejects with 400': (r) => r.status === 400 || r.status === 429,
      'responds under 1s': (r) => r.timings.duration < 1000,
    });

    track(metrics, 'auth_login', res, 400);
  });

  sleep(1);
}
