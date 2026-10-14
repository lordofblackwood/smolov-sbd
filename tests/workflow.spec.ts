import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { AppState } from '../src/storage/types';

// Browser plugin not available. These isolated Chromium contexts exercise the real
// production UI and IndexedDB. External origins are blocked; no live accounts are used.
const trainingDate = new Date('2026-10-19T12:00:00.000Z');

async function readState(page: Page): Promise<AppState | undefined> {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('smolov-sbd-local', 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const database = open.result;
      const transaction = database.transaction('account-state', 'readonly');
      const request = transaction.objectStore('account-state').get('local-unpaired');
      let result: AppState | undefined;
      request.onsuccess = () => { result = request.result; };
      transaction.oncomplete = () => { database.close(); resolve(result); };
      transaction.onerror = () => { database.close(); reject(transaction.error); };
    };
  })) as Promise<AppState | undefined>;
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

async function enterTrainingMaxes(page: Page) {
  await navigate(page, 'Settings');
  for (const [lift, weight] of [['Squat', '285'], ['Bench', '285'], ['Deadlift', '285']]) {
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
  await expect(page.getByText('0 of 8 sets logged', { exact: true })).toBeVisible();
}

test.beforeEach(async ({ page, context }) => {
  // The test date controls scheduled UI only; no fixture workouts are seeded.
  await page.clock.setFixedTime(trainingDate);
  await context.route('**/*', async route => {
    if (new URL(route.request().url()).origin === 'http://127.0.0.1:4173') await route.continue();
    else await route.abort('blockedbyclient');
  });
});

test('production app renders an accessible phone layout and truthful empty state', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/');
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

test('logs actual sets, refreshes, finishes offline, reopens offline, and merges backup duplicates', async ({ page, context }, info) => {
  await page.goto('/');
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
  await expect(page.getByText('3 of 8 sets logged', { exact: true })).toBeVisible();
  await page.locator('.set-row.logged.skipped').getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByText('2 of 8 sets logged', { exact: true })).toBeVisible();
  await skippedRow.getByRole('button', { name: 'Skip', exact: true }).click();
  await page.locator('.warmups').getByText('Warm-up sets (optional)', { exact: true }).click();
  await page.locator('.warmups').getByRole('button', { name: 'Add deadlift warm-up', exact: true }).click();
  await page.locator('.warmups').getByLabel('Deadlift set 1 actual weight', { exact: true }).fill('95');
  await page.locator('.warmups').getByLabel('Deadlift set 1 actual reps', { exact: true }).fill('5');
  await page.locator('.warmups').getByRole('button', { name: 'Complete Deadlift set 1', exact: true }).click();
  await expect(page.getByText('3 of 8 sets logged', { exact: true })).toBeVisible();
  await expect.poll(async () => (await readState(page))?.workouts[0]?.sets.length).toBe(4);
  const before = await readState(page);
  expect(before?.workouts[0].targets[0]).toMatchObject({ weight: 240, reps: 3, unit: 'lb' });
  expect(before?.workouts[0].sets.map(set => [set.outcome, set.reps])).toEqual([['complete', 2], ['failed', 0], ['skipped', 0], ['complete', 5]]);
  const timerEnd = before?.timerEnd;
  expect(timerEnd).toBe(trainingDate.getTime() + 180_000);

  await page.clock.setFixedTime(new Date(trainingDate.getTime() + 10_000));
  await page.reload();
  await page.getByRole('button', { name: 'Resume workout', exact: true }).click();
  await expect(page.getByText('3 of 8 sets logged', { exact: true })).toBeVisible();
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
  await expect(page.getByText('1 complete · 1 failed · 1 skipped · 5 unlogged', { exact: true })).toBeVisible();
  await expect(page.getByText('Sync needs attention', { exact: true })).toBeVisible();
  await expect.poll(async () => (await readState(page))?.workouts[0]?.status).toBe('partial');
  const finished = await readState(page);
  expect(finished?.workouts[0].sync.status).toBe('needs-attention');
  expect(finished?.outbox).toHaveLength(1);
  expect(finished?.outbox[0].attempts).toBe(0);
  expect(finished?.outbox[0].status).toBe('needs-attention');

  const reopened = await context.newPage();
  await reopened.goto('/');
  await expect(reopened.getByRole('heading', { name: 'Today’s training', level: 1 })).toBeVisible();
  await navigate(reopened, 'History');
  await expect(reopened.locator('.history-session')).toHaveCount(1);
  await expect(reopened.getByText('1 complete · 1 failed · 1 skipped · 5 unlogged', { exact: true })).toBeVisible();
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

test('meet results preserve mixed units and require a successful attempt in all lifts', async ({ page }, info) => {
  await page.goto('/');
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
  await page.goto('/');
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
  await expect(review.locator('.preview-list')).toContainText('200 lb → 95 kg');
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
  await expect(page.locator('.lift-row').first()).toContainText('240 lb');
  await expect(page.locator('.lift-row').nth(1)).toContainText('200 lb');
  await page.getByRole('button', { name: 'Resume workout', exact: true }).click();
  await expect(page.getByLabel('Deadlift set 1 actual weight', { exact: true })).toHaveValue('240');
  await expect(page.locator('.target-label').first()).toHaveText('Planned 240 lb × 3');
  await page.getByRole('group', { name: 'Exercises in prescribed order' }).getByRole('button', { name: /Squat/ }).click();
  await expect(page.getByText('Planned 200 lb × 6', { exact: true })).toHaveCount(3);
  await expect(page.getByRole('timer')).toHaveText('1:30');
  await navigate(page, 'Program');
  await expect(page.locator('.calendar-day').filter({ hasText: 'Oct 21' })).toContainText('102.5 kg');
  await page.reload();
  expect((await readState(page))?.workouts[0]).toEqual(original);
  expect((await readState(page))?.settings.unit).toBe('kg');
});

test('calibration screens stay unfilled and fit 430 and 360 pixel phones', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'Phone widths are covered by the mobile project.');
  await page.clock.setFixedTime(new Date('2026-10-14T12:00:00.000Z'));
  await page.setViewportSize({ width: 430, height: 932 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Today’s training', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start workout', exact: true })).toBeVisible();
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
  await expect(page.getByText('0 of 2 sets logged', { exact: true })).toBeVisible();
  await noHorizontalOverflow(page);
  await page.screenshot({ path: '/private/tmp/smolov-sbd-calibration-active.png', fullPage: false, animations: 'disabled' });
  await expect.poll(async () => (await readState(page))?.workouts.length).toBe(1);
  expect((await readState(page))?.workouts[0].sets).toEqual([]);
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
  await page.goto('/');
  await beginVolumeSession(page);
  await page.getByRole('button', { name: 'Complete Deadlift set 1', exact: true }).click();
  await expect.poll(async () => (await readState(page))?.workouts[0]?.sets.length).toBe(1);
  const original = (await readState(page))!.workouts[0];
  const second = await context.newPage();
  await second.clock.setFixedTime(new Date(trainingDate.getTime() + 10_000));
  await second.goto('/');
  const readonly = second.getByText('Another Smolov tab is saving changes. Close that tab, then retry here.');
  await expect(readonly).toBeVisible();
  await navigate(second, 'History');
  await expect(second.getByRole('heading', { name: 'Training history', level: 1 })).toBeVisible();
  await expect(second.getByText('1 complete · 0 failed · 0 skipped · 7 unlogged', { exact: true })).toBeVisible();
  await expect(second.getByRole('button', { name: 'Resume workout', exact: true })).toBeDisabled();
  await expect(second.getByRole('button', { name: 'Retry pending sync', exact: true })).toBeDisabled();
  expect((await readState(second))?.workouts[0]).toEqual(original);
  await page.close();
  await second.getByRole('button', { name: 'Retry editing lock', exact: true }).click();
  await expect(readonly).not.toBeVisible();
  await navigate(second, 'Today');
  await expect(second.getByRole('button', { name: 'Resume workout', exact: true })).toBeEnabled();
  await second.getByRole('button', { name: 'Resume workout', exact: true }).click();
  await expect(second.getByText('1 of 8 sets logged', { exact: true })).toBeVisible();
  await second.getByRole('button', { name: 'Complete Deadlift set 2', exact: true }).click();
  await expect.poll(async () => (await readState(second))?.workouts[0]?.sets.length).toBe(2);
  const saved = (await readState(second))!.workouts[0];
  expect(saved.id).toBe(original.id);
  expect(saved.revision).toBe(original.revision + 1);
  expect(saved.targets).toEqual(original.targets);
  expect(new Set(saved.sets.map(set => set.targetId)).size).toBe(2);
  await second.close();
});
