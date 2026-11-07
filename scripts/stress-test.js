import http from 'k6/http';
import { check, sleep } from 'k6';
import { createEndpointMetrics, track } from '../lib/metrics.js';

const ENDPOINTS = ['list_products'];
const metrics = createEndpointMetrics(ENDPOINTS);

const BASE_URL = __ENV.BASE_URL || 'https://dummyjson.com';

/**
 * Stress test — pushes past the expected peak to find the breaking point.
 *
 * Unlike the load test, this one is EXPECTED to degrade. No pass/fail
 * threshold on duration: the output is the shape of the curve, i.e. at which
 * VU count latency starts climbing and errors appear.
 */
export const options = {
  stages: [
    { duration: '30s', target: 50 },
    { duration: '30s', target: 100 },
    { duration: '30s', target: 200 },
    { duration: '30s', target: 300 },
    { duration: '30s', target: 0 },
  ],

  thresholds: {
    // Only a sanity gate — the run should still be recoverable.
    http_req_failed: ['rate<0.25'],
  },
};

export default function () {
  const res = http.get(`${BASE_URL}/products?limit=20`);

  check(res, { 'status is 200': (r) => r.status === 200 });
  track(metrics, 'list_products', res);

  sleep(0.5);
}
