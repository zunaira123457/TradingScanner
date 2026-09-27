# Testing

| Layer | Tool | Where | Count |
|---|---|---|---|
| Unit | Vitest | `tests/unit` | 5 suites: data client, server infra, utils, indicator accuracy, notifications |
| Integration (route handlers + store + watcher + notifier, only the outside world mocked) | Vitest | `tests/integration` | 39 |
| Hooks & components | Vitest + React Testing Library + jsdom | `tests/components` | 86 |
| Live API (real Twelve Data + running scanner; opt-in) | Vitest | `tests/live` | 3 |
| End-to-end (production build, 6 browser/device profiles) | Playwright | `e2e` | 24 specs × 6 profiles |
| Soak (1 hour, opt-in) | Playwright | `e2e/soak.spec.ts` | 1 |
| Scanner backend | Jest | `../backend/tests` | 601 |

```bash
npm test                 # unit + integration + components (≈ 20 s)
npm run test:coverage    # same, with coverage (fails under 80 % lines/statements/functions)
npm run test:e2e         # production build + Playwright on Chrome, Firefox, WebKit, Pixel 7, iPhone 14, iPad
LIVE=1 npx vitest run tests/live                               # real APIs (~4 Twelve Data credits)
SOAK=1 npx playwright test e2e/soak.spec.ts --project=chromium # 1-hour soak
E2E_EDGE=1 npx playwright test --project=edge                  # needs: npx playwright install msedge (admin password)
npm run test:all         # typecheck + lint + coverage + e2e
```

## How the E2E environment works

The browsers run the real production build (`output: 'standalone'`, like the Docker image). A local mock market (`e2e/mock-market.mjs`) stands in for Finnhub, Twelve Data and the scanner, so runs are deterministic and don't use up free-tier API credits. It makes prices tick on every request, and it exposes `POST /__control` to force price moves mid-test. The special symbols `SLOW` (a response slower than the app's 8 s timeout) and `LIMIT` (the provider returns 429) exercise failure paths without affecting parallel tests. Each test runs as its own client IP, as it would behind Caddy, and fails on any console error or uncaught exception.

## Notes

- **Desktop WebKit + push:** Playwright's desktop WebKit build freezes on `pushManager.getSubscription()`, even on a one-line page. The `webkit` project therefore blocks service workers. The app only touches push APIs once the Notifications panel is opened, and push on real Safari is verified by hand (see the checklist in the release report).
- **Charts in jsdom:** `lightweight-charts` draws to `<canvas>`, so component tests use a recording double (`tests/stubs/lightweightCharts.ts`) and assert series, panes, price lines and framing. Real rendering and frame rate are measured in Playwright.
- **Indicator accuracy:** SMA, EMA, RSI (Wilder), MACD and Bollinger Bands are checked against the independent `technicalindicators` library on 500 bars, to 6 decimal places. On real AAPL data they're also checked against the scanner backend's own implementation.
