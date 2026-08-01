// PWA installability + offline-shell check (PLAN.md §9/§11 Phase 6's
// acceptance line: "installable in Chrome; kill server -> reopened
// installed app shows cached shell + stale-data banner; Lighthouse PWA pass
// noted"). Runs against the production build via
// e2e/playwright.prod.config.ts's own webServer (`npm run build && npm
// start`), NOT the dev-mode server the other 10 specs use — vite-plugin-pwa
// only generates a manifest/service worker for `vite build`.
import { expect, test } from '@playwright/test';

test('manifest is present and valid, a service worker registers, zero console errors on load', async ({
  page,
  baseURL,
}) => {
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));

  await page.goto('/');

  // The app itself rendered for real, not a blank/crashed page.
  await expect(page.getByRole('button', { name: /Agents/ })).toBeVisible();

  // Manifest link is present and resolves to real, schema-shaped JSON
  // (PLAN.md §9: display 'standalone', maskable icons).
  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(manifestHref).toBeTruthy();
  const manifestUrl = new URL(manifestHref ?? '', baseURL ?? undefined).toString();
  const manifestRes = await page.request.get(manifestUrl);
  expect(manifestRes.ok()).toBe(true);
  const manifest = (await manifestRes.json()) as {
    name: string;
    display: string;
    icons: { src: string; sizes: string; purpose?: string }[];
  };
  expect(manifest.name).toBe('Agent Dashboard');
  expect(manifest.display).toBe('standalone');
  expect(manifest.icons.length).toBeGreaterThanOrEqual(2);
  for (const icon of manifest.icons) {
    const iconUrl = new URL(icon.src, baseURL ?? undefined).toString();
    const iconRes = await page.request.get(iconUrl);
    expect(iconRes.ok()).toBe(true);
    expect(icon.purpose ?? '').toContain('maskable');
  }

  // A real service worker registration exists (not just declared in source —
  // actually registered by the browser).
  await page.waitForFunction(
    async () => {
      const regs = await navigator.serviceWorker.getRegistrations();
      return regs.some((reg) => reg.active !== null);
    },
    { timeout: 15_000 },
  );

  expect(consoleErrors).toEqual([]);
});

test('service worker precaches the app shell in Cache Storage', async ({ page }) => {
  // Verifies the actual mechanism that lets a reopened installed app render
  // its shell with the server down (PLAN.md §11's "kill server -> reopened
  // installed app shows cached shell" line) deterministically, via the
  // Cache Storage API, rather than by simulating offline navigation.
  //
  // `context.setOffline(true)` was tried first and found to make Chromium
  // fail top-level navigations outright (net::ERR_INTERNET_DISCONNECTED)
  // *before* the request ever reaches the service worker's fetch handler in
  // this Playwright/Chromium combination — a real tooling limitation for
  // main-frame navigations under CDP-level offline emulation, not a defect
  // in this app's service worker (confirmed live: killing the *actual*
  // production server process — leaving the browser's own network stack
  // reporting itself online — does let the service worker serve the
  // cached shell correctly; not automatable into this committed suite
  // without reaching into the shared webServer's process, so it was
  // verified manually instead). See DECISIONS.md "Phase 6" for the full
  // writeup and the real command output from that manual run.
  await page.goto('/');
  // A page's very first load is never itself SW-controlled (no controller
  // exists yet to intercept it) — wait for install, then reload once so
  // *this* page is actually controlled, matching what a real second visit
  // (or a reopened installed app) would experience.
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

  const precachedPaths = await page.evaluate(async () => {
    const cacheNames = await caches.keys();
    const paths = new Set<string>();
    for (const name of cacheNames) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) {
        paths.add(new URL(request.url).pathname);
      }
    }
    return Array.from(paths);
  });

  expect(precachedPaths).toContain('/index.html');
  expect(precachedPaths).toContain('/manifest.webmanifest');
  expect(precachedPaths.some((p) => p.startsWith('/assets/') && p.endsWith('.js'))).toBe(true);
  expect(precachedPaths.some((p) => p.startsWith('/pwa/') && p.endsWith('.png'))).toBe(true);
});

test('service worker does not hijack /api navigations (OAuth redirect callbacks)', async ({
  page,
  context,
}) => {
  // Regression guard for #16: "Gemini/OpenRouter sign-in loops back to the
  // Agents page and never connects."
  //
  // workbox registers its SPA navigation fallback
  // (`NavigationRoute(createHandlerBoundToURL('index.html'))`) BEFORE the
  // runtimeCaching rules, and a Router matches in registration order. Without
  // `navigateFallbackDenylist`, every *navigation* to our origin — including
  // an OAuth provider redirecting the browser to
  // /api/providers/oauth/callback?code=... — was answered from the precache
  // with index.html. The server never saw the callback; the user just watched
  // the SPA boot to its default route (Agents). The NetworkOnly rules for
  // OAuth routes did not help, because navigations never reached them.
  //
  // This only ever broke redirect-based flows, which is why device-code
  // (Copilot), code-paste (Anthropic) and the separate-port listener (OpenAI)
  // all kept working while the two pkce-loopback providers failed.
  //
  // Note this is only observable in a SW-*controlled* page: curl bypasses the
  // service worker entirely, and a page's first load is never controlled — so
  // the reload below is load-bearing, not incidental.
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

  // Navigate exactly the way a provider's redirect does: a top-level
  // navigation to the callback route, in a page under the SW's scope.
  const callbackPage = await context.newPage();
  await callbackPage.goto('/api/providers/oauth/callback?flow=e2e-regression&code=e2e-regression');

  // The server owns this route, so we must get the server's response. The
  // flow id is fake, so the *correct* answer is its rendered failure page.
  const body = await callbackPage.evaluate(() => document.body.innerText);
  expect(body).toContain('Sign-in failed');
  expect(body).toContain('no pending OAuth flow');

  // And specifically NOT the SPA shell being served in its place.
  expect(body).not.toContain('Loading workspace');
  await callbackPage.close();
});
