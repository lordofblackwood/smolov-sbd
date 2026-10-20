import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { AppState } from '../src/storage/types';
import { LOCAL_ACCOUNT_ID, createInitialState } from '../src/storage/types';
import { DEFAULT_SETTINGS, ORIGINAL_PROGRAM_DAYS, PROGRAM_DAYS, skipWorkout, startWorkout } from '../src/domain/program';
import { exportBackup } from '../src/storage/backup';
import { pairConnection, POWERLEVEL_ENDPOINT, snapshotForWorkout, type SmolovSnapshot } from '../src/integration/powerlevel';
import { authFor, decryptSnapshot, encryptSnapshot, newCode } from '../src/integration/vendor/sync.mjs';
import relayWorker from '../integrations/relay/src/worker.mjs';

// Browser plugin not available. These isolated Chromium contexts exercise the real
// production UI and IndexedDB. External origins are blocked; no live accounts are used.
const trainingDate = new Date('2026-10-19T12:00:00.000Z');

async function readState(page: Page, accountId = LOCAL_ACCOUNT_ID): Promise<AppState | undefined> {
  return page.evaluate((scope) => new Promise((resolve, reject) => {
    const open = indexedDB.open('smolov-sbd-local', 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const database = open.result;
      const transaction = database.transaction('account-state', 'readonly');
      const request = transaction.objectStore('account-state').get(scope);
      let result: AppState | undefined;
      request.onsuccess = () => { result = request.result; };
      transaction.oncomplete = () => { database.close(); resolve(result); };
      transaction.onerror = () => { database.close(); reject(transaction.error); };
    };
  }), accountId) as Promise<AppState | undefined>;
}

async function navigate(page: Page, name: 'Today' | 'Program' | 'History' | 'Settings') {
  await page.getByRole('navigation').getByRole('button', { name, exact: true }).click();
}

async function noHorizontalOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

async function openDay(page: Page, date: string) {
  await navigate(page, 'Program');
  await page.locator('.calendar-day').filter({ hasText: date }).click();
}

async function enterTrainingMaxes(page: Page, deadliftWeight = '285') {
  await navigate(page, 'Settings');
  for (const [lift, weight] of [['Squat', '285'], ['Bench', '285'], ['Deadlift', deadliftWeight]]) {
    await page.getByRole('button', { name: new RegExp(`^${lift} Confirm TM`) }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(`${lift} calibration weight`, { exact: true }).fill(weight);
    await dialog.getByLabel(`${lift} calibration RPE`, { exact: true }).fill('7');
    await dialog.getByLabel('This is my actual successful calibration single.').check();
    await expect(dialog.getByText('Future target preview', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Confirm training max', exact: true }).click();
    await expect(dialog).not.toBeVisible();
  }
  await expect.poll(async () => Object.values((await readState(page))?.settings.trainingMaxes ?? {}).filter(Boolean).length).toBe(3);
}

async function beginVolumeSession(page: Page) {
  await enterTrainingMaxes(page);
  await openDay(page, 'Oct 19');
  await expect(page.getByRole('button', { name: 'Start workout', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Start workout', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Deadlift', level: 1 })).toBeVisible();
  await expect(page.getByText('0 of 5 sets logged', { exact: true })).toBeVisible();
}

test.beforeEach(async ({ page, context, baseURL }) => {
  // The test date controls scheduled UI; legacy records use the real backup import flow.
  await page.clock.setFixedTime(trainingDate);
  await context.route('**/*', async route => {
    if (new URL(route.request().url()).origin === new URL(baseURL!).origin) await route.continue();
    else await route.abort('blockedbyclient');
  });
});

test('install assets and offline worker stay inside the app’s hosting path', async ({ page, baseURL }) => {
  const appURL = new URL(baseURL!);
  await page.goto('./');
  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
  const manifestURL = new URL(manifestHref!, page.url());
  expect(manifestURL.origin).toBe(appURL.origin);
  expect(manifestURL.pathname.startsWith(appURL.pathname)).toBe(true);
  const manifestResponse = await page.request.get(manifestURL.href);
  expect(manifestResponse.ok()).toBe(true);
  const manifest = await manifestResponse.json() as { start_url: string; scope: string; icons: { src: string }[] };
  expect(new URL(manifest.start_url, manifestURL).href).toBe(appURL.href);
  expect(new URL(manifest.scope, manifestURL).href).toBe(appURL.href);
  for (const icon of manifest.icons) {
    const iconURL = new URL(icon.src, manifestURL);
    expect(iconURL.origin).toBe(appURL.origin);
    expect(iconURL.pathname.startsWith(appURL.pathname)).toBe(true);
    const response = await page.request.get(iconURL.href);
    expect(response.ok()).toBe(true);
    expect(response.headers()['content-type']).toContain('image/png');
  }
  const appleIconHref = await page.locator('link[rel="apple-touch-icon"]').getAttribute('href');
  expect(new URL(appleIconHref!, page.url()).pathname.startsWith(appURL.pathname)).toBe(true);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toBe(`${appURL.href}sw.js`);
  const registration = await page.evaluate(async () => {
    const active = await navigator.serviceWorker.ready;
    return { scope: active.scope, scriptURL: active.active?.scriptURL };
  });
  expect(registration).toEqual({ scope: appURL.href, scriptURL: `${appURL.href}sw.js` });
  const cachedURLs = await page.evaluate(async () => {
    const names = (await caches.keys()).filter(name => name.startsWith('smolov-sbd-shell'));
    return (await Promise.all(names.map(async name => (await (await caches.open(name)).keys()).map(request => request.url)))).flat();
  });
  expect(cachedURLs.length).toBeGreaterThan(0);
  expect(cachedURLs.every(url => {
    const cachedURL = new URL(url);
    return cachedURL.origin === appURL.origin && cachedURL.pathname.startsWith(appURL.pathname);
  })).toBe(true);
});

test('production app renders an accessible phone layout and truthful empty state', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('./');
  await expect(page).toHaveTitle('Smolov SBD · Meet Prep');
  await expect(page.getByRole('heading', { name: 'Today’s training', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm training maxes', exact: true })).toBeVisible();
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  await noHorizontalOverflow(page);
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('BODY');
  await page.screenshot({ path: `/private/tmp/smolov-sbd-${info.project.name}-today.png`, fullPage: true, animations: 'disabled' });
  await navigate(page, 'History');
  await expect(page.getByText('Your first session starts here.', { exact: true })).toBeVisible();
  await expect(page.locator('.history-session')).toHaveCount(0);
  await navigate(page, 'Settings');
  expect(await page.locator('input,select,textarea').evaluateAll(elements => elements.filter(element => {
    const input = element as HTMLInputElement;
    return !input.labels?.length && !input.getAttribute('aria-label') && !input.getAttribute('aria-labelledby');
  }).length)).toBe(0);
  expect(errors).toEqual([]);
});

test('both volume weeks put bench after light deadlift and leave heaviest squat alone', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('./');
  await enterTrainingMaxes(page);
  await navigate(page, 'Program');
  const revision = page.getByRole('region', { name: 'Schedule update', exact: true });
  await expect(revision).toBeVisible();
  await revision.getByText('Preview 10 future changed days', { exact: true }).click();
  await expect(revision.locator('.schedule-changes > div')).toHaveCount(10);
  const thursdayChange = revision.locator('.schedule-changes > div').filter({ hasText: 'Thu, Oct 22' });
  await expect(thursdayChange).toContainText('Before: Squat 4 × 4');
  await expect(thursdayChange).toContainText('Now: Deadlift 3 × 6');
  await expect(thursdayChange).toContainText('Bench 5 × 3 · 85% TM · 245 lb');
  await revision.getByText('Preview 10 future changed days', { exact: true }).click();
  const expected = [
    ['Deadlift'], ['Squat', 'Bench'], ['Squat', 'Bench'],
    ['Deadlift', 'Bench'], ['Squat', 'Bench'], ['Squat'],
  ];
  for (const [week, dates, heavyBench] of [
    ['volume-1', ['Oct 19', 'Oct 20', 'Oct 21', 'Oct 22', 'Oct 23', 'Oct 24'], '245 lb'],
    ['volume-2', ['Oct 26', 'Oct 27', 'Oct 28', 'Oct 29', 'Oct 30', 'Oct 31'], '245 lb'],
  ] as const) {
    await page.getByRole('combobox', { name: 'Phase', exact: true }).selectOption(week);
    for (const [index, date] of dates.entries()) {
      const row = page.locator('.calendar-day').filter({ hasText: date });
      await expect(row.locator('.day-prescriptions strong')).toHaveText(expected[index]);
    }
    const lightDeadliftDay = page.locator('.calendar-day').filter({ hasText: dates[3] });
    const prescriptions = lightDeadliftDay.locator('.day-prescriptions > div');
    await expect(prescriptions.nth(0)).toContainText('3 × 6 · 205 lb');
    await expect(prescriptions.nth(0)).toContainText('70% TM');
    await expect(prescriptions.nth(1)).toContainText(`5 × 3 · ${heavyBench}`);
    await expect(prescriptions.nth(1)).toContainText('85% TM');
    const heavySquatDay = page.locator('.calendar-day').filter({ hasText: dates[5] });
    await expect(heavySquatDay.locator('.day-prescriptions > div')).toHaveCount(1);
    await expect(heavySquatDay).toContainText('5 × 3');
    await expect(heavySquatDay).toContainText('85% TM');
    await expect(page.locator('.program-volume')).toContainText('Squat 69 reps');
    await expect(page.locator('.program-volume')).toContainText('Bench 69 reps');
    await expect(page.locator('.program-volume')).toContainText('Deadlift 33 reps');
    await noHorizontalOverflow(page);
    if (week === 'volume-1') {
      await page.screenshot({ path: `/private/tmp/smolov-sbd-${info.project.name}-revised-volume-week.png`, fullPage: true, animations: 'disabled' });
      if (info.project.name === 'mobile') {
        await lightDeadliftDay.scrollIntoViewIfNeeded();
        await page.screenshot({ path: '/private/tmp/smolov-sbd-mobile-revised-pairings.png', fullPage: false, animations: 'disabled' });
      }
    }
  }
  await page.locator('.calendar-day').filter({ hasText: 'Oct 29' }).click();
  await page.getByRole('button', { name: 'Start workout', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Deadlift', level: 1 })).toBeVisible();
  await expect(page.getByText('0 of 8 sets logged', { exact: true })).toBeVisible();
  await page.getByRole('group', { name: 'Exercises in prescribed order' }).getByRole('button', { name: /Bench/ }).click();
  await expect(page.getByRole('heading', { name: 'Bench', level: 1 })).toBeVisible();
  await expect(page.getByText('Planned 245 lb × 3', { exact: true })).toHaveCount(5);
  expect(errors).toEqual([]);
});

test('rounds a 270 lb prescription to 275 across preview, reload, and workout start', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('./');
  await enterTrainingMaxes(page, '315');
  await expect(page.getByLabel('Calculation increment (lb)', { exact: true })).toHaveValue('5');
  await expect(page.getByText(/For example, 270 becomes 275 lb\./)).toBeVisible();
  await page.getByRole('combobox', { name: 'Training display unit', exact: true }).selectOption('kg');
  await expect(page.getByLabel('Calculation increment (kg)', { exact: true })).toHaveValue('2.5');
  await expect(page.getByText(/Exact halfway weights round upward\./)).toBeVisible();
  await expect(page.getByText(/For example, 270 becomes 275 lb\./)).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Training display unit', exact: true }).selectOption('lb');
  expect((await readState(page))?.settings.trainingMaxes.deadlift?.weight).toBe(315);
  await navigate(page, 'Program');
  await expect(page.locator('.calendar-day').filter({ hasText: 'Oct 19' })).toContainText('5 × 3 · 275 lb');
  await navigate(page, 'Today');
  await expect(page.locator('.lift-row').first()).toContainText('275 lb');
  await page.reload();
  await expect(page.locator('.lift-row').first()).toContainText('275 lb');
  await page.getByRole('button', { name: 'Start workout', exact: true }).click();
  await expect(page.getByText('Planned 275 lb × 3', { exact: true })).toHaveCount(5);
  await expect(page.getByLabel('Deadlift set 1 actual weight', { exact: true })).toHaveValue('275');
  await expect.poll(async () => (await readState(page))?.workouts[0]?.targets.map(target => target.weight)).toEqual([275, 275, 275, 275, 275]);
  expect((await readState(page))?.settings.trainingMaxes.deadlift?.weight).toBe(315);
  await page.reload();
  await page.getByRole('button', { name: 'Resume workout', exact: true }).click();
  await expect(page.getByText('Planned 275 lb × 3', { exact: true })).toHaveCount(5);
  await noHorizontalOverflow(page);
  await page.screenshot({ path: `/private/tmp/smolov-sbd-${info.project.name}-rounded-weights.png`, fullPage: true, animations: 'disabled' });
  expect(errors).toEqual([]);
});

test('mixed backup keeps original and revised saved days with their own targets', async ({ page }, info) => {
  const settings = structuredClone(DEFAULT_SETTINGS);
  for (const lift of ['squat', 'bench', 'deadlift'] as const) {
    settings.trainingMaxes[lift] = { weight: 285, unit: 'lb', confirmedAt: trainingDate.toISOString() };
  }
  const originalDay = ORIGINAL_PROGRAM_DAYS.find(day => day.date === '2026-10-19')!;
  const original = startWorkout(originalDay, settings, LOCAL_ACCOUNT_ID, trainingDate);
  original.targets = original.targets.map(target => ({ ...target, weight: target.lift === 'deadlift' ? 240 : 200 }));
  const revisedSettings = structuredClone(settings);
  revisedSettings.trainingMaxes.squat!.weight = 300;
  revisedSettings.trainingMaxes.bench = null;
  const revised = skipWorkout(PROGRAM_DAYS.find(day => day.date === '2026-10-20')!, revisedSettings, LOCAL_ACCOUNT_ID, trainingDate);
  revised.targets = revised.targets.map(target => ({ ...target, weight: target.lift === 'squat' ? 210 : null }));
  const previousState = createInitialState(settings);
  previousState.workouts = [original, revised];
  const backup = exportBackup(previousState, LOCAL_ACCOUNT_ID, trainingDate);
  await page.goto('./');
  await enterTrainingMaxes(page);
  await page.getByLabel('Import JSON backup', { exact: true }).setInputFiles({
    name: 'mixed-layout-workouts.json', mimeType: 'application/json', buffer: Buffer.from(backup),
  });
  await expect(page.getByText('Imported 2 workouts; 0 duplicates skipped; 0 conflicts kept unchanged.', { exact: true })).toBeVisible();
  await expect.poll(async () => (await readState(page))?.workouts).toEqual([original, revised]);
  await navigate(page, 'Program');
  await expect(page.getByText('Unstarted days in volume week 1 keep their original pairings because the week contains saved workouts from that layout. Saved days keep their own targets.', { exact: true })).toBeVisible();
  await expect(page.getByText('Preview 5 future changed days', { exact: true })).toBeVisible();
  for (const [date, lifts] of [
    ['Oct 19', ['Deadlift', 'Squat']],
    ['Oct 20', ['Squat', 'Bench']],
    ['Oct 22', ['Squat', 'Deadlift']],
    ['Oct 24', ['Squat', 'Bench']],
    ['Oct 29', ['Deadlift', 'Bench']],
    ['Oct 31', ['Squat']],
  ] as const) {
    await expect(page.locator('.calendar-day').filter({ hasText: date }).locator('.day-prescriptions strong')).toHaveText([...lifts]);
  }
  const revisedDay = page.locator('.calendar-day').filter({ hasText: 'Oct 20' });
  await expect(revisedDay.locator('.day-prescriptions > div').nth(0)).toContainText('3 × 6 · 210 lb');
  await expect(revisedDay.locator('.day-prescriptions > div').nth(1)).toContainText('3 × 6 · — lb');
  await revisedDay.click();
  await expect(page.locator('.lift-row h3')).toHaveText(['Squat', 'Bench']);
  await expect(page.locator('.lift-row').nth(0)).toContainText('210 lb');
  await expect(page.locator('.lift-row').nth(1)).toContainText('— lb');
  await navigate(page, 'Today');
  await expect(page.locator('.lift-row').nth(0)).toContainText('240 lb');
  await expect(page.locator('.lift-row').nth(1)).toContainText('200 lb');
  await page.getByRole('button', { name: 'Resume workout', exact: true }).click();
  await expect(page.getByText('0 of 8 sets logged', { exact: true })).toBeVisible();
  await page.getByRole('group', { name: 'Exercises in prescribed order' }).getByRole('button', { name: /Squat/ }).click();
  await expect(page.getByText('Planned 200 lb × 6', { exact: true })).toHaveCount(3);
  await page.reload();
  expect((await readState(page))?.workouts).toEqual([original, revised]);
  await expect(page.locator('.lift-row').nth(0)).toContainText('240 lb');
  await expect(page.locator('.lift-row').nth(1)).toContainText('200 lb');
  await page.getByRole('button', { name: 'Resume workout', exact: true }).click();
  await expect(page.getByText('0 of 8 sets logged', { exact: true })).toBeVisible();
  await page.getByRole('group', { name: 'Exercises in prescribed order' }).getByRole('button', { name: /Squat/ }).click();
  await expect(page.getByText('Planned 200 lb × 6', { exact: true })).toHaveCount(3);
  await noHorizontalOverflow(page);
  await page.screenshot({ path: `/private/tmp/smolov-sbd-${info.project.name}-legacy-active-reopened.png`, fullPage: true, animations: 'disabled' });
});

test('logs actual sets, refreshes, finishes offline, reopens offline, and merges backup duplicates', async ({ page, context }, info) => {
  await page.goto('./');
  await beginVolumeSession(page);
  await expect(page.getByRole('spinbutton', { name: /RPE/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Complete Deadlift set 1', exact: true }).click();
  await expect.poll(async () => (await readState(page))?.workouts[0]?.sets.length).toBe(1);
  const firstIdentity = (await readState(page))?.workouts[0].sets[0].id;
  await page.locator('.set-row.logged.complete').getByRole('button', { name: 'Edit set', exact: true }).click();
  await page.getByLabel('Deadlift set 1 actual weight', { exact: true }).fill('235');
  await page.getByLabel('Deadlift set 1 actual reps', { exact: true }).fill('2');
  await page.getByRole('button', { name: 'Complete Deadlift set 1', exact: true }).click();
  await expect(page.getByText('235 lb × 2', { exact: true })).toBeVisible();
  await expect.poll(async () => (await readState(page))?.workouts[0].sets[0].weight).toBe(235);
  expect((await readState(page))?.workouts[0].sets[0].id).toBe(firstIdentity);
  const failedRow = page.locator('.set-row').filter({ has: page.getByRole('button', { name: 'Complete Deadlift set 2', exact: true }) });
  await failedRow.getByRole('button', { name: 'Failed', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Actual reps performed', { exact: true }).fill('0');
  await page.getByRole('dialog').getByRole('button', { name: 'Save failed set', exact: true }).click();
  const skippedRow = page.locator('.set-row').filter({ has: page.getByRole('button', { name: 'Complete Deadlift set 3', exact: true }) });
  await skippedRow.getByRole('button', { name: 'Skip', exact: true }).click();
  await expect(page.getByText('3 of 5 sets logged', { exact: true })).toBeVisible();
  await page.locator('.set-row.logged.skipped').getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByText('2 of 5 sets logged', { exact: true })).toBeVisible();
  await skippedRow.getByRole('button', { name: 'Skip', exact: true }).click();
  await page.locator('.warmups').getByText('Warm-up sets (optional)', { exact: true }).click();
  await page.locator('.warmups').getByRole('button', { name: 'Add deadlift warm-up', exact: true }).click();
  await page.locator('.warmups').getByLabel('Deadlift set 1 actual weight', { exact: true }).fill('95');
  await page.locator('.warmups').getByLabel('Deadlift set 1 actual reps', { exact: true }).fill('5');
  await page.locator('.warmups').getByRole('button', { name: 'Complete Deadlift set 1', exact: true }).click();
  await expect(page.getByText('3 of 5 sets logged', { exact: true })).toBeVisible();
  await expect.poll(async () => (await readState(page))?.workouts[0]?.sets.length).toBe(4);
  const before = await readState(page);
  expect(before?.workouts[0].targets[0]).toMatchObject({ weight: 245, reps: 3, unit: 'lb' });
  expect(before?.workouts[0].sets.map(set => [set.outcome, set.reps])).toEqual([['complete', 2], ['failed', 0], ['skipped', 0], ['complete', 5]]);
  const timerEnd = before?.timerEnd;
  expect(timerEnd).toBe(trainingDate.getTime() + 180_000);

  await page.clock.setFixedTime(new Date(trainingDate.getTime() + 10_000));
  await page.reload();
  await page.getByRole('button', { name: 'Resume workout', exact: true }).click();
  await expect(page.getByText('3 of 5 sets logged', { exact: true })).toBeVisible();
  await expect(page.getByRole('timer')).toHaveText('2:50');
  expect((await readState(page))?.timerEnd).toBe(timerEnd);
  await noHorizontalOverflow(page);
  await page.screenshot({ path: `/private/tmp/smolov-sbd-${info.project.name}-workout.png`, fullPage: true, animations: 'disabled' });

  // A real production worker must control this page before offline reopen is tested.
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Finish / stop workout', exact: true }).click();
  const finish = page.getByRole('dialog');
  await expect(finish.getByText('2 completed reps · 2 total performed reps.', { exact: true })).toBeVisible();
  await finish.getByRole('button', { name: 'Finish & save locally', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Training history', level: 1 })).toBeVisible();
  await expect(page.locator('.history-session')).toHaveCount(1);
  await expect(page.getByText('1 complete · 1 failed · 1 skipped · 2 unlogged', { exact: true })).toBeVisible();
  await expect(page.getByText('Sync needs attention', { exact: true })).toBeVisible();
  await expect.poll(async () => (await readState(page))?.workouts[0]?.status).toBe('partial');
  const finished = await readState(page);
  expect(finished?.workouts[0].sync.status).toBe('needs-attention');
  expect(finished?.outbox).toHaveLength(1);
  expect(finished?.outbox[0].attempts).toBe(0);
  expect(finished?.outbox[0].status).toBe('needs-attention');

  const reopened = await context.newPage();
  await reopened.goto('./');
  await expect(reopened.getByRole('heading', { name: 'Today’s training', level: 1 })).toBeVisible();
  await navigate(reopened, 'History');
  await expect(reopened.locator('.history-session')).toHaveCount(1);
  await expect(reopened.getByText('1 complete · 1 failed · 1 skipped · 2 unlogged', { exact: true })).toBeVisible();
  await reopened.close();
  await context.setOffline(false);
  await page.getByRole('button', { name: 'Retry pending sync', exact: true }).click();
  await expect(page.getByText('Sync needs attention', { exact: true })).toBeVisible();
  expect((await readState(page))?.outbox[0].attempts).toBe(0);

  await navigate(page, 'Settings');
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export JSON backup', exact: true }).click();
  const download = await downloadEvent;
  const backupPath = `/private/tmp/smolov-sbd-${info.project.name}-backup.json`;
  await download.saveAs(backupPath);
  await page.getByLabel('Import JSON backup', { exact: true }).setInputFiles(backupPath);
  await expect(page.getByText('Imported 0 workouts; 1 duplicates skipped; 0 conflicts kept unchanged.', { exact: true })).toBeVisible();
  await navigate(page, 'History');
  await expect(page.locator('.history-session')).toHaveCount(1);
  expect((await readState(page))?.workouts[0].targets).toEqual(before?.workouts[0].targets);
  await noHorizontalOverflow(page);
  await page.screenshot({ path: `/private/tmp/smolov-sbd-${info.project.name}-history.png`, fullPage: true, animations: 'disabled' });
});

test('paired deadlift resumes a missing-ETag upload and restores acknowledged history without duplicates', async ({ page, baseURL }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  // Every relay request is fulfilled here. This generated connection and its
  // encrypted fixture exist only in this isolated test, never a live account.
  const code = newCode();
  const connection = await pairConnection(code);
  const authorization = `Bearer ${await authFor(code)}`;
  const timestamp = '2026-10-16T12:00:00.000Z';
  const unrelated: SmolovSnapshot = {
    schema: 1, source: 'smolov', contract: 'smolov-v1',
    sessions: [{
      id: 'mock-bench-session', revision: 1, trainingDate: '2026-10-16', scheduledDate: '2026-10-16',
      startedAt: timestamp, updatedAt: timestamp, finishedAt: timestamp, status: 'completed', notes: 'Unrelated mock history',
    }],
    events: [{
      id: 'mock-bench-session:bench-single', source: 'smolov', sessionId: 'mock-bench-session', setId: 'bench-single', revision: 1,
      date: '2026-10-16', occurredAt: timestamp, exercise: 'benchPress', name: 'Bench Press', weight: 185, unit: 'lb',
      originalWeight: 185, originalUnit: 'lb', sets: 1, reps: 1, outcome: 'completed', success: true,
      singleCompleted: true, countsDay: true, kind: 'calibration', notes: '', pain: false, rpe: 7,
    }],
  };
  let remote = {
    body: JSON.stringify(await encryptSnapshot(code, unrelated)),
    httpEtag: '"mock-initial"', uploaded: trainingDate, customMetadata: { updatedAt: trainingDate.toISOString() },
  };
  let puts = 0;
  let bodyEtagTransport = false;
  const writeConditions: string[] = [];
  const environment = { BUCKET: {
    get: async (key: string) => {
      expect(key.endsWith('/smolov.json')).toBe(true);
      return remote;
    },
    put: async (key: string, body: string, options: { onlyIf: Headers; customMetadata: { updatedAt: string } }) => {
      expect(key.endsWith('/smolov.json')).toBe(true);
      if (options.onlyIf.get('If-Match') !== remote.httpEtag) return null;
      writeConditions.push(options.onlyIf.get('If-Match')!);
      puts++;
      remote = { body, httpEtag: `"mock-write-${puts}"`, uploaded: trainingDate, customMetadata: options.customMetadata };
      return remote;
    },
  } };
  await page.route(`${POWERLEVEL_ENDPOINT}/**`, async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path !== '/' && request.method() !== 'OPTIONS') {
      expect(path).toBe('/api/history/smolov');
      expect(request.headers().authorization).toBe(authorization);
    }
    const response = await relayWorker.fetch(new Request(request.url(), {
      method: request.method(), headers: request.headers(),
      ...(request.method() === 'PUT' ? { body: request.postData() } : {}),
    }), environment);
    const headers = Object.fromEntries(response.headers);
    let body = await response.text();
    if (request.method() === 'GET' && path === '/api/history/smolov' && response.ok) {
      const envelope = JSON.parse(body);
      if (bodyEtagTransport) {
        // A hosting proxy can rewrite or hide ETag; the body must preserve the
        // exact storage token used for the subsequent conditional write.
        headers.etag = 'W/"proxy-etag"';
        expect(envelope.snapshotEtag).toBe(remote.httpEtag);
      } else {
        delete headers.etag;
        delete envelope.snapshotEtag;
      }
      body = JSON.stringify(envelope);
    }
    await route.fulfill({ status: response.status, headers, body });
  });
  const readRemote = async () => await decryptSnapshot(code, JSON.parse(remote.body), 'smolov') as SmolovSnapshot;

  await page.goto('./');
  await expect(page).toHaveTitle('Smolov SBD · Meet Prep');
  expect(page.url()).toBe(new URL('./', baseURL!).href);
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  await enterTrainingMaxes(page);
  await page.getByLabel('Powerlevel connection code', { exact: true }).fill(code);
  await page.getByRole('button', { name: 'Pair existing account', exact: true }).click();
  await expect.poll(async () => (await readState(page, connection.accountId))?.settings.trainingMaxes.deadlift?.weight).toBe(285);
  await expect(page.locator('.connection-status')).toContainText('supports independent Smolov uploads');
  await openDay(page, 'Oct 19');
  await page.getByRole('button', { name: 'Start workout', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Deadlift', level: 1 })).toBeVisible();
  await page.getByLabel('Deadlift set 1 actual weight', { exact: true }).fill('235');
  await page.getByLabel('Deadlift set 1 actual reps', { exact: true }).fill('2');
  for (let set = 1; set <= 5; set++) {
    await page.getByRole('button', { name: `Complete Deadlift set ${set}`, exact: true }).click();
  }
  await expect.poll(async () => (await readState(page, connection.accountId))?.workouts[0].sets.length).toBe(5);
  const active = (await readState(page, connection.accountId))!.workouts[0];
  expect(active.status).toBe('active');
  expect(active.targets.map(target => [target.lift, target.weight, target.reps])).toEqual(Array.from({ length: 5 }, () => ['deadlift', 245, 3]));
  expect(puts).toBe(0);

  await page.getByRole('button', { name: 'Finish / stop workout', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Finish & save locally', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Training history', level: 1 })).toBeVisible();
  await expect.poll(async () => (await readState(page, connection.accountId))?.outbox[0].status).toBe('needs-attention');
  await expect(page.locator('.history-session')).toContainText('The relay did not return a safe snapshot ETag');
  const paused = (await readState(page, connection.accountId))!;
  expect(paused.outbox[0].attempts).toBe(1);
  expect(puts).toBe(0);
  await noHorizontalOverflow(page);
  await page.screenshot({ path: `/private/tmp/smolov-sbd-${info.project.name}-etag-paused.png`, fullPage: true, animations: 'disabled' });
  bodyEtagTransport = true;
  await page.getByRole('button', { name: 'Retry pending sync', exact: true }).click();
  await expect.poll(async () => (await readState(page, connection.accountId))?.workouts[0].sync.status).toBe('synced');
  const saved = (await readState(page, connection.accountId))!;
  const workout = saved.workouts[0];
  const exact = snapshotForWorkout(workout);
  expect(workout.status).toBe('completed');
  expect(workout.revision).toBeGreaterThan(active.revision);
  expect(workout.targets).toEqual(active.targets);
  expect(workout.sets).toEqual(active.sets);
  expect(workout.revision).toBe(paused.workouts[0].revision);
  expect(exact.events.map(event => [event.exercise, event.weight, event.reps])).toEqual([
    ['deadlift', 235, 2], ...Array.from({ length: 4 }, () => ['deadlift', 245, 3]),
  ]);
  expect(saved.outbox).toHaveLength(1);
  expect(saved.outbox[0]).toMatchObject({ accountId: connection.accountId, workoutId: workout.id, revision: workout.revision, status: 'synced', attempts: 2 });
  expect(puts).toBe(1);
  expect(writeConditions).toEqual(['"mock-initial"']);
  const firstRemote = await readRemote();
  expect(firstRemote.sessions.find(session => session.id === workout.id)).toEqual(exact.sessions[0]);
  expect(firstRemote.events.filter(event => event.sessionId === workout.id)).toEqual(exact.events);
  expect(firstRemote.events.filter(event => event.sessionId === unrelated.sessions[0].id)).toEqual(unrelated.events);

  // Simulate remote loss while the durable local acknowledgement remains synced.
  const missing: SmolovSnapshot = {
    ...firstRemote,
    sessions: firstRemote.sessions.filter(session => session.id !== workout.id),
    events: firstRemote.events.filter(event => event.sessionId !== workout.id),
  };
  remote = { ...remote, body: JSON.stringify(await encryptSnapshot(code, missing)), httpEtag: '"mock-missing-deadlift"' };
  expect((await readState(page, connection.accountId))?.outbox[0].status).toBe('synced');
  await page.getByRole('button', { name: 'Retry pending sync', exact: true }).click();
  await expect.poll(() => puts).toBe(2);
  await expect.poll(async () => (await readState(page, connection.accountId))?.outbox[0].attempts).toBe(3);
  expect(writeConditions).toEqual(['"mock-initial"', '"mock-missing-deadlift"']);
  const restored = await readRemote();
  expect(restored.sessions).toHaveLength(2);
  expect(restored.sessions.find(session => session.id === workout.id)).toEqual(exact.sessions[0]);
  expect(restored.events.filter(event => event.sessionId === workout.id)).toEqual(exact.events);
  expect(restored.events.filter(event => event.sessionId === unrelated.sessions[0].id)).toEqual(unrelated.events);

  await page.getByRole('button', { name: 'Retry pending sync', exact: true }).click();
  await expect.poll(async () => (await readState(page, connection.accountId))?.outbox[0].attempts).toBe(4);
  expect(puts).toBe(2);
  expect(await readRemote()).toEqual(restored);
  const finalState = (await readState(page, connection.accountId))!;
  expect(finalState.workouts[0]).toMatchObject({ id: workout.id, revision: workout.revision, status: 'completed', targets: workout.targets, sets: workout.sets, sync: { status: 'synced' } });
  expect(finalState.outbox).toHaveLength(1);
  expect(finalState.outbox[0].snapshot).toEqual(saved.outbox[0].snapshot);
  await noHorizontalOverflow(page);
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  expect(errors).toEqual([]);
  await page.screenshot({ path: `/private/tmp/smolov-sbd-${info.project.name}-etag-synced.png`, fullPage: true, animations: 'disabled' });
});

test('meet results preserve mixed units and require a successful attempt in all lifts', async ({ page }, info) => {
  await page.goto('./');
  await openDay(page, 'Nov 15');
  await expect(page.getByRole('heading', { name: 'Awaiting successful lifts', exact: true })).toBeVisible();
  await expect(page.getByRole('spinbutton', { name: /attempt \d weight/ })).toHaveCount(9);
  await expect(page.getByRole('spinbutton', { name: /RPE/ })).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Official meet unit', exact: true }).selectOption('kg');
  await page.getByLabel('Squat attempt 1 weight', { exact: true }).fill('180');
  await page.getByLabel('Squat attempt 1 result', { exact: true }).selectOption('good');
  await page.getByLabel('Bench attempt 1 weight', { exact: true }).fill('220');
  await page.getByLabel('Bench attempt 1 unit', { exact: true }).selectOption('lb');
  await page.getByLabel('Bench attempt 1 result', { exact: true }).selectOption('good');
  await expect(page.getByRole('heading', { name: 'Awaiting successful lifts', exact: true })).toBeVisible();
  await page.getByLabel('Deadlift attempt 1 weight', { exact: true }).fill('500');
  await page.getByLabel('Deadlift attempt 1 unit', { exact: true }).selectOption('lb');
  await page.getByLabel('Deadlift attempt 1 result', { exact: true }).selectOption('good');
  await expect(page.getByRole('heading', { name: 'Three-lift total', exact: true })).toBeVisible();
  await expect(page.locator('.meet-total')).toContainText('506.59');
  await page.getByLabel('Squat attempt 2 weight', { exact: true }).fill('200');
  await page.getByLabel('Squat attempt 2 result', { exact: true }).selectOption('no-lift');
  await expect(page.locator('.meet-total')).toContainText('506.59');
  await expect.poll(async () => (await readState(page))?.meet.attempts.filter(attempt => attempt.outcome === 'good').length).toBe(3);
  const meet = (await readState(page))?.meet;
  expect(meet?.unit).toBe('kg');
  expect(meet?.attempts.find(attempt => attempt.lift === 'bench' && attempt.number === 1)?.unit).toBe('lb');
  expect(meet?.attempts.find(attempt => attempt.lift === 'squat' && attempt.number === 1)?.unit).toBe('kg');
  await noHorizontalOverflow(page);
  await page.screenshot({ path: `/private/tmp/smolov-sbd-${info.project.name}-meet.png`, fullPage: true, animations: 'disabled' });
  await page.reload();
  await openDay(page, 'Nov 15');
  await expect(page.locator('.meet-total')).toContainText('506.59');
});

test('backup preference restore previews future targets and preserves the active workout in its original units', async ({ page }, info) => {
  await page.goto('./');
  await beginVolumeSession(page);
  await expect.poll(async () => (await readState(page))?.workouts.length).toBe(1);
  const original = (await readState(page))!.workouts[0];
  await navigate(page, 'Settings');
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export JSON backup', exact: true }).click();
  const download = await downloadEvent;
  const backupPath = `/private/tmp/smolov-sbd-${info.project.name}-restore-backup.json`;
  await download.saveAs(backupPath);
  const backup = JSON.parse(await readFile(backupPath, 'utf8')) as { state: AppState };
  backup.state.settings.trainingMaxes.squat!.weight = 300;
  backup.state.settings.trainingMaxes.bench!.weight = 300;
  backup.state.settings.unit = 'kg';
  backup.state.settings.increment = 2.5;
  backup.state.settings.restSeconds = 90;
  backup.state.settings.autoRest = false;
  await page.getByLabel('Also restore training maxes, units and timer preferences', { exact: true }).check();
  await page.getByLabel('Import JSON backup', { exact: true }).setInputFiles({
    name: 'restored-preferences.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)),
  });
  const review = page.getByRole('dialog', { name: 'Review backup preferences', exact: true });
  await expect(review).toBeVisible();
  await expect(review.locator('.preview-list')).toContainText('10-20 · Bench');
  await expect(review.locator('.preview-list')).toContainText('205 lb → 95 kg');
  await expect(review.locator('.preview-list')).toContainText('215 lb → 102.5 kg');
  await expect(review.locator('.preview-list')).not.toContainText('10-19');
  expect((await readState(page))?.settings.unit).toBe('lb');
  expect((await readState(page))?.settings.trainingMaxes.squat?.weight).toBe(285);
  await noHorizontalOverflow(page);
  await review.getByRole('button', { name: 'Import & restore preferences', exact: true }).click();
  await expect(review).not.toBeVisible();
  await expect(page.getByText('Imported 0 workouts; 1 duplicates skipped; 0 conflicts kept unchanged. Preferences restored.', { exact: true })).toBeVisible();
  const restored = await readState(page);
  expect(restored?.settings).toMatchObject({ unit: 'kg', increment: 2.5, restSeconds: 90, autoRest: false });
  expect(restored?.settings.trainingMaxes.squat?.weight).toBe(300);
  expect(restored?.workouts[0]).toEqual(original);
  await navigate(page, 'Today');
  await expect(page.locator('.lift-row').first()).toContainText('245 lb');
  await expect(page.locator('.lift-row')).toHaveCount(1);
  await page.getByRole('button', { name: 'Resume workout', exact: true }).click();
  await expect(page.getByLabel('Deadlift set 1 actual weight', { exact: true })).toHaveValue('245');
  await expect(page.locator('.target-label').first()).toHaveText('Planned 245 lb × 3');
  await expect(page.getByRole('group', { name: 'Exercises in prescribed order' }).getByRole('button', { name: /Squat/ })).toHaveCount(0);
  await expect(page.getByRole('timer')).toHaveText('1:30');
  await navigate(page, 'Program');
  await expect(page.locator('.calendar-day').filter({ hasText: 'Oct 19' })).toContainText('245 lb');
  await expect(page.locator('.calendar-day').filter({ hasText: 'Oct 19' })).not.toContainText('kg');
  await expect(page.locator('.calendar-day').filter({ hasText: 'Oct 21' })).toContainText('102.5 kg');
  await page.reload();
  expect((await readState(page))?.workouts[0]).toEqual(original);
  expect((await readState(page))?.settings.unit).toBe('kg');
});

test('Friday calibration starts together and an original calibration backup keeps its dates', async ({ page }, info) => {
  const calibrationDate = new Date('2026-10-14T12:00:00.000Z');
  await page.clock.setFixedTime(calibrationDate);
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Recovery day', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start workout', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Program phases', { exact: true })).toContainText('Oct 16–18');
  await navigate(page, 'Program');
  await page.getByRole('combobox', { name: 'Phase', exact: true }).selectOption('calibration');
  for (const date of ['Oct 14', 'Oct 15', 'Oct 17', 'Oct 18']) {
    await expect(page.locator('.calendar-day').filter({ hasText: date }).locator('.day-prescriptions strong')).toHaveCount(0);
  }
  const friday = page.locator('.calendar-day').filter({ hasText: 'Oct 16' });
  await expect(friday.locator('.day-prescriptions strong')).toHaveText(['Squat', 'Bench', 'Deadlift']);
  await expect(friday.locator('.day-prescriptions > div span')).toHaveText(['1 × 1 · RPE 6–8', '1 × 1 · RPE 6–8', '1 × 1 · RPE 6–8']);
  await page.getByRole('combobox', { name: 'Phase', exact: true }).selectOption('volume-1');
  const monday = page.locator('.calendar-day').filter({ hasText: 'Oct 19' });
  await expect(monday.locator('.day-prescriptions strong')).toHaveText(['Deadlift']);
  await expect(monday).toContainText('5 × 3');

  const original = startWorkout(ORIGINAL_PROGRAM_DAYS.find(day => day.date === '2026-10-14')!, DEFAULT_SETTINGS, LOCAL_ACCOUNT_ID, calibrationDate);
  const previousState = createInitialState(DEFAULT_SETTINGS);
  previousState.workouts = [original];
  await navigate(page, 'Settings');
  await page.getByLabel('Import JSON backup', { exact: true }).setInputFiles({
    name: 'original-calibration.json', mimeType: 'application/json', buffer: Buffer.from(exportBackup(previousState, LOCAL_ACCOUNT_ID, calibrationDate)),
  });
  await expect(page.getByText('Imported 1 workouts; 0 duplicates skipped; 0 conflicts kept unchanged.', { exact: true })).toBeVisible();
  await expect.poll(async () => (await readState(page))?.workouts).toEqual([original]);
  await navigate(page, 'Program');
  await expect(page.getByText('Calibration already started under the original dates. Remaining calibration days keep that layout to avoid repeat tests. Saved days keep their own targets.', { exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Phase', exact: true }).selectOption('calibration');
  await expect(page.locator('.calendar-day').filter({ hasText: 'Oct 14' }).locator('.day-prescriptions strong')).toHaveText(['Squat', 'Bench']);
  await expect(page.locator('.calendar-day').filter({ hasText: 'Oct 16' }).locator('.day-prescriptions strong')).toHaveText(['Deadlift']);
  await navigate(page, 'Today');
  await expect(page.locator('.lift-row h3')).toHaveText(['Squat', 'Bench']);
  await page.reload();
  expect((await readState(page))?.workouts).toEqual([original]);
  await page.getByRole('button', { name: 'Resume workout', exact: true }).click();
  await expect(page.getByText('0 of 2 sets logged', { exact: true })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Exercises in prescribed order' }).getByRole('button')).toHaveCount(2);
  await expect(page.getByLabel('Squat set 1 actual weight', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Squat achieved RPE', { exact: true })).toHaveValue('');
  await noHorizontalOverflow(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `/private/tmp/smolov-sbd-${info.project.name}-original-calibration-reopened.png`, fullPage: false, animations: 'disabled' });
});

test('Friday calibration screens stay unfilled and fit 430 and 360 pixel phones', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'Phone widths are covered by the mobile project.');
  await page.clock.setFixedTime(new Date('2026-10-16T12:00:00.000Z'));
  await page.setViewportSize({ width: 430, height: 932 });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Today’s training', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start workout', exact: true })).toBeVisible();
  await expect(page.locator('.lift-row h3')).toHaveText(['Squat', 'Bench', 'Deadlift']);
  await noHorizontalOverflow(page);
  await page.screenshot({ path: '/private/tmp/smolov-sbd-calibration-today.png', fullPage: false, animations: 'disabled' });
  await navigate(page, 'Settings');
  await noHorizontalOverflow(page);
  await expect(page.getByRole('button', { name: /^Squat Confirm TM/ })).toBeVisible();
  await navigate(page, 'Program');
  await noHorizontalOverflow(page);
  await navigate(page, 'Today');
  await page.getByRole('button', { name: 'Start workout', exact: true }).click();
  await expect(page.getByLabel('Squat set 1 actual weight', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Squat achieved RPE', { exact: true })).toHaveValue('');
  await expect(page.getByText('0 of 3 sets logged', { exact: true })).toBeVisible();
  await noHorizontalOverflow(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: '/private/tmp/smolov-sbd-calibration-active.png', fullPage: false, animations: 'disabled' });
  for (const lift of ['Bench', 'Deadlift']) {
    await page.getByRole('group', { name: 'Exercises in prescribed order' }).getByRole('button', { name: new RegExp(lift) }).click();
    await expect(page.getByLabel(`${lift} set 1 actual weight`, { exact: true })).toHaveValue('');
    await expect(page.getByLabel(`${lift} achieved RPE`, { exact: true })).toHaveValue('');
    await expect(page.locator('.target-label').first()).toHaveText('Target RPE 6–8');
  }
  await expect.poll(async () => (await readState(page))?.workouts.length).toBe(1);
  expect((await readState(page))?.workouts[0].sets).toEqual([]);
  expect((await readState(page))?.workouts[0].date).toBe('2026-10-16');
  expect((await readState(page))?.workouts[0].targets.map(target => [target.lift, target.kind, target.weight, target.rpeTarget])).toEqual([
    ['squat', 'calibration', null, '6–8'], ['bench', 'calibration', null, '6–8'], ['deadlift', 'calibration', null, '6–8'],
  ]);
  expect((await readState(page))?.settings.trainingMaxes).toEqual({ squat: null, bench: null, deadlift: null });
  await page.setViewportSize({ width: 360, height: 800 });
  await noHorizontalOverflow(page);
  for (const screen of ['Today', 'Settings', 'Program', 'Today'] as const) {
    await navigate(page, screen);
    await noHorizontalOverflow(page);
  }
  await page.getByRole('button', { name: 'Resume workout', exact: true }).click();
  await noHorizontalOverflow(page);
  await expect(page.getByLabel('Squat set 1 actual weight', { exact: true })).toHaveValue('');
});

test('a second tab reads safely and reloads saved state before acquiring the editing lock', async ({ page, context }) => {
  await page.goto('./');
  await beginVolumeSession(page);
  await page.getByRole('button', { name: 'Complete Deadlift set 1', exact: true }).click();
  await expect.poll(async () => (await readState(page))?.workouts[0]?.sets.length).toBe(1);
  const original = (await readState(page))!.workouts[0];
  const second = await context.newPage();
  await second.clock.setFixedTime(new Date(trainingDate.getTime() + 10_000));
  await second.goto('./');
  const readonly = second.getByText('Another Smolov tab is saving changes. Close that tab, then retry here.');
  await expect(readonly).toBeVisible();
  await navigate(second, 'History');
  await expect(second.getByRole('heading', { name: 'Training history', level: 1 })).toBeVisible();
  await expect(second.getByText('1 complete · 0 failed · 0 skipped · 4 unlogged', { exact: true })).toBeVisible();
  await expect(second.getByRole('button', { name: 'Resume workout', exact: true })).toBeDisabled();
  await expect(second.getByRole('button', { name: 'Retry pending sync', exact: true })).toBeDisabled();
  expect((await readState(second))?.workouts[0]).toEqual(original);
  await page.close();
  await second.getByRole('button', { name: 'Retry editing lock', exact: true }).click();
  await expect(readonly).not.toBeVisible();
  await navigate(second, 'Today');
  await expect(second.getByRole('button', { name: 'Resume workout', exact: true })).toBeEnabled();
  await second.getByRole('button', { name: 'Resume workout', exact: true }).click();
  await expect(second.getByText('1 of 5 sets logged', { exact: true })).toBeVisible();
  await second.getByRole('button', { name: 'Complete Deadlift set 2', exact: true }).click();
  await expect.poll(async () => (await readState(second))?.workouts[0]?.sets.length).toBe(2);
  const saved = (await readState(second))!.workouts[0];
  expect(saved.id).toBe(original.id);
  expect(saved.revision).toBe(original.revision + 1);
  expect(saved.targets).toEqual(original.targets);
  expect(new Set(saved.sets.map(set => set.targetId)).size).toBe(2);
  await second.close();
});
