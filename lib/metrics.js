import { Counter, Rate, Trend } from 'k6/metrics';

/**
 * Per-endpoint metrics.
 *
 * k6's built-in metrics are aggregated across the whole run, so a single slow
 * endpoint disappears into the average. Tracking each endpoint separately is
 * what makes the result actionable: it says *which* call degrades, not just
 * that something did.
 */
export function createEndpointMetrics(names) {
  const metrics = {};

  for (const name of names) {
    metrics[name] = {
      total: new Counter(`req_${name}_total`),
      failed: new Counter(`req_${name}_failed`),
      throttled: new Counter(`req_${name}_throttled`),
      failRate: new Rate(`req_${name}_fail_rate`),
      duration: new Trend(`req_${name}_duration`, true), // true = report in ms
    };
  }

  return metrics;
}

/**
 * Records one response against its endpoint's metrics.
 *
 * A 429 is counted separately from a failure. Rate limiting is the API
 * defending itself — correct behaviour, not a defect — and folding it into
 * the error rate would hide the real question: whether the requests that
 * *were* served stayed fast.
 *
 * Returns the outcome so callers can branch on it.
 */
export function track(metrics, name, res, expectedStatus = 200) {
  const group = metrics[name];
  if (!group) {
    throw new Error(`No metrics registered for endpoint "${name}"`);
  }

  group.total.add(1);

  if (res.status === 429) {
    group.throttled.add(1);
    group.failRate.add(false);
    return 'throttled';
  }

  const failed = res.status !== expectedStatus;

  group.duration.add(res.timings.duration);
  group.failRate.add(failed);
  if (failed) {
    group.failed.add(1);
  }

  return failed ? 'failed' : 'ok';
}

/** Per-endpoint thresholds, so one slow endpoint fails the run on its own. */
export function endpointThresholds(names, { p95 = 800, maxFailRate = 0.01 } = {}) {
  const thresholds = {};

  for (const name of names) {
    thresholds[`req_${name}_duration`] = [`p(95)<${p95}`];
    thresholds[`req_${name}_fail_rate`] = [`rate<${maxFailRate}`];
  }

  return thresholds;
}
