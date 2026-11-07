# Load Test Results

**Target:** `https://dummyjson.com` (public demo API)
**Date:** 7 November 2026
**Tool:** k6 v1.5.0
**Script:** [`scripts/load-test.js`](scripts/load-test.js)

## Load profile

| Stage | Duration | Target VUs | Purpose |
|---|---|---|---|
| Ramp up | 30s | 0 → 20 | Warm up, avoid a cold-start spike |
| Sustain | 1m | 20 | Baseline at expected load |
| Step up | 30s | 20 → 50 | Look for the knee in the curve |
| Sustain | 1m | 50 | Hold at 2.5× baseline |
| Ramp down | 30s | 50 → 0 | Observe recovery |

Total run: **3m32s**, 3,182 iterations, 12,728 requests (~60 req/s).

## Results per endpoint

| Endpoint | Requests | avg | p(90) | p(95) | max | Fail rate | Throttled |
|---|---|---|---|---|---|---|---|
| `GET /products/1` | 3,182 | **33ms** | 37ms | 41ms | 182ms | 0.00% | 0 |
| `GET /products/search?q=` | 3,182 | 290ms | 295ms | 421ms | 827ms | 0.00% | 50 |
| `GET /products?limit=20` | 3,182 | 302ms | 412ms | **456ms** | 812ms | 0.00% | 35 |
| `POST /auth/login` (400 path) | 3,182 | 369ms | 399ms | 427ms | **29.87s** | 0.00% | 44 |

All thresholds passed: `p(95) < 1200ms` and `fail_rate < 1%` per endpoint, `http_req_duration p(95) < 1500ms` overall.

## Findings

### 1. Single-record reads are ~9× faster than collection reads

`GET /products/1` averages 33ms against 290–302ms for the list and search endpoints. The gap is consistent across the whole run, not a warm-up artifact.

That ratio points at payload size and serialization rather than at the database: a single record is a small, fixed response, while the list endpoint returns 20 records and search scans before it serializes. The run moved **224MB received against 1.6MB sent**, which is the same story — these endpoints are dominated by response size.

**Implication for a real system:** the first optimisation worth testing here is pagination limits and field selection, not query tuning.

### 2. The API rate-limits at ~50 VUs, and that is correct behaviour

129 requests returned `429 request limit exceeded, please wait a few seconds` — 1.0% of total, all during the 50-VU stage, spread across three endpoints.

An earlier revision of this script counted those as failures, which pushed the error rate to 2.4% and made the API look unstable. It was not: rate limiting is the service defending itself, and treating it as a defect hides the question that actually matters — *of the requests that were served, did any fail or slow down?* The answer is no: 0.00% fail rate on all four endpoints.

The script now counts 429 into a separate `req_*_throttled` counter and excludes it from both the fail rate and the latency trend. See [`lib/metrics.js`](lib/metrics.js).

**This is the main lesson of the run.** A load test that cannot tell "rejected on purpose" from "broken" will report the wrong thing.

### 3. One auth request hung for 29.87 seconds

`POST /auth/login` has a p(95) of 427ms but a max of **29.87s** — a single outlier, ~81× the p(95). The surrounding iteration took 31.44s against a median of 1.95s.

One occurrence in 3,182 requests is not a trend, and the endpoint's p(90) and p(95) are unaffected, so this did not degrade the service. But a 30-second wait on a login call is a real user-facing failure if it recurs, and 30s is suspiciously close to a default connection timeout.

**Not concluded from this run.** Confirming it needs a longer soak to see whether it repeats, and `http_req_connecting` / `http_req_waiting` broken out to tell a connection stall from slow server processing. Recorded here as an open question rather than a finding.

### 4. No degradation between 20 and 50 VUs

Latency stayed flat across the step up. Where the API pushed back, it did so by rejecting with 429 rather than by slowing down — which is the preferable failure mode, since a fast rejection lets a client retry while a slow response ties up its connection.

**The breaking point was not found at this load.** 50 VUs is below it. See [`scripts/stress-test.js`](scripts/stress-test.js), which ramps to 300 VUs to locate it.

## Reproducing

```bash
k6 run --summary-export=results/summary.json scripts/load-test.js
k6 run scripts/stress-test.js        # ramps to 300 VUs
BASE_URL=https://your-api.example k6 run scripts/load-test.js
```

Raw output: [`results/summary.json`](results/summary.json)

## What I would add with access to the system under test

This run measures a public API from outside, which limits what the numbers can explain. Against a system I could instrument, the next steps would be:

- Correlate the latency spike with server-side traces to separate queueing from processing
- Break out `http_req_connecting`, `http_req_tls_handshaking`, and `http_req_waiting` to attribute where time is spent
- Run a soak test (1–2 hours at steady load) to surface memory leaks and connection-pool exhaustion, which a 3-minute run cannot show
