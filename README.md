# k6 Load Testing

[![Load Test](https://github.com/ilhamaldz/k6-load-testing/actions/workflows/k6.yml/badge.svg)](https://github.com/ilhamaldz/k6-load-testing/actions/workflows/k6.yml)

Load and stress tests for a REST API, written in k6. Measures each endpoint separately so the result says *which* call degrades, not just that something did.

Target: [dummyjson.com](https://dummyjson.com) — a public demo API.

**→ [Read the results and analysis](RESULTS.md)**

## What it measures

| Script | Profile | Question it answers |
|---|---|---|
| `load-test.js` | 20 → 50 VUs over 3m30s | Does the API hold its latency budget at expected load? |
| `stress-test.js` | 50 → 300 VUs over 2m30s | Where is the breaking point? |

Four endpoints are tracked independently: list, single record, search, and a negative auth path.

## How it is built

**Per-endpoint metrics.** k6's built-in metrics aggregate across the whole run, so one slow endpoint disappears into the average. `lib/metrics.js` registers a `Counter`, `Rate`, and `Trend` per endpoint, which is what turned the headline number in [RESULTS.md](RESULTS.md) into something actionable — single-record reads are ~9× faster than collection reads, and that gap is invisible in the overall average.

**429 is not a failure.** The API rate-limits under load. An early revision counted those as errors and reported a 2.4% failure rate, making a healthy API look unstable. Throttled responses now go to a separate counter and are excluded from both the fail rate and the latency trend — the real fail rate is 0.00%.

**Per-endpoint thresholds.** `endpointThresholds()` generates a `p(95)` and fail-rate gate for every endpoint, so a single slow call fails the run on its own rather than being averaged away.

**A negative path under load.** Most load tests exercise only the happy path. This one holds a rejected login in the mix, because an auth endpoint that turns a clean 400 into a timeout under pressure is a real failure mode — and it is where this run found its one anomaly.

## Running it

```bash
# Install k6: https://grafana.com/docs/k6/latest/set-up/install-k6/
k6 run scripts/load-test.js
k6 run scripts/stress-test.js

# Point at another API
BASE_URL=https://your-api.example k6 run scripts/load-test.js

# Export the summary
k6 run --summary-export=results/summary.json scripts/load-test.js
```

## Structure

```
├── lib/
│   └── metrics.js         # per-endpoint Counter/Rate/Trend, 429 handling
├── scripts/
│   ├── load-test.js       # staged ramp, threshold-gated
│   └── stress-test.js     # ramps to 300 VUs to find the limit
├── results/
│   └── summary.json       # raw k6 export
└── RESULTS.md             # analysis and findings
```

## Reading the output

| Metric | Meaning |
|---|---|
| `req_<name>_duration` | Response time for that endpoint, 429s excluded |
| `req_<name>_fail_rate` | Share of real failures — not throttling |
| `req_<name>_throttled` | Count of 429s, tracked separately on purpose |
| `req_<name>_total` | Requests issued to that endpoint |

---

Built by **Muhammad Ilham Alidiaz Rachmawan** — QA Engineer
[LinkedIn](https://linkedin.com/in/ilhamalidiaz)
