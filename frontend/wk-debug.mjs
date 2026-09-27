import { webkit, devices } from '@playwright/test';
const b = await webkit.launch();
const ctx = await b.newContext({ ...devices['Desktop Safari'] });
const p = await ctx.newPage();
p.on('console', (m) => console.log('console', m.type(), m.text().slice(0, 200)));
p.on('pageerror', (e) => console.log('pageerror', e.message));
p.on('requestfailed', (r) => console.log('failed', r.url().slice(0, 100), r.failure()?.errorText));
const t = Date.now();
try {
  await p.goto('http://127.0.0.1:3200/', { timeout: 20000 });
  console.log('loaded in', Date.now() - t);
} catch (e) { console.log('goto error', e.message.split('\n')[0]); }
await p.waitForTimeout(3000);
console.log('h1:', await p.locator('h1').count(), 'title:', await p.title());
await b.close();
