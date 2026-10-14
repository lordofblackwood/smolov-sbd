import { describe, expect, it, vi } from 'vitest'
import {
  EXERCISE_IDS, KNOWN_POWERLEVEL_SOURCES, SOURCE_LIMITATION, checkConnection,
  convertWeight, mapActualSetFields, pairConnection,
} from '../src/integration/powerlevel'
import { validateSnapshot } from '../src/integration/vendor/history.mjs'
import { authFor, decryptSnapshot, encryptSnapshot, newCode, putHistory } from '../src/integration/vendor/sync.mjs'

describe('the inspected Powerlevel contract', () => {
  it('uses the existing source and exercise catalog rather than a new slot', () => {
    expect(KNOWN_POWERLEVEL_SOURCES).toEqual(['bulgarian', 'accessory', 'bodyweight', 'smolov'])
    expect(EXERCISE_IDS).toEqual({ squat: 'backSquat', bench: 'benchPress', deadlift: 'deadlift' })
    expect(() => validateSnapshot({ schema: 1, source: 'unregistered', events: [] }, 'unregistered')).toThrow()
  })

  it('converts units using the exact international pound', () => {
    expect(convertWeight(100, 'lb', 'kg')).toBe(45.359237)
    expect(convertWeight(100, 'kg', 'lb')).toBeCloseTo(220.4622621849, 8)
    expect(convertWeight(convertWeight(285, 'lb', 'kg'), 'kg', 'lb')).toBeCloseTo(285, 10)
    expect(() => convertWeight(Number.NaN, 'lb', 'kg')).toThrow()
  })

  it('maps actual set evidence with stable identities and no invented RPE or single', () => {
    const input = { id: 'set:one', lift: 'bench' as const, actualWeight: 100, actualReps: 4, unit: 'kg' as const, outcome: 'failed' as const, notes: 'Stopped early' }
    const event = mapActualSetFields('session:one', '2026-11-01', input)!
    expect(event).toMatchObject({ exercise: 'benchPress', name: 'Bench Press', reps: 4, sets: 1, unit: 'lb', success: false, singleCompleted: false, countsDay: true })
    expect(event.weight).toBeCloseTo(220.4622621849, 8)
    expect(event.id).toBe(mapActualSetFields('session:one', '2026-11-01', input)!.id)
    expect(event).not.toHaveProperty('rpe')
    expect(event).not.toHaveProperty('repSet')
    expect(event).not.toHaveProperty('source')
    // Only this isolated fixture is assigned to the existing slot for schema QA.
    expect(validateSnapshot({ schema: 1, source: 'bulgarian', events: [{ ...event, source: 'bulgarian' }] }, 'bulgarian').events).toHaveLength(1)
    expect(input.notes).toBe('Stopped early')
  })

  it('does not turn targets, skips, zero reps, or warm-ups into proven singles', () => {
    const base = { id: 'set', lift: 'squat' as const, actualWeight: 200, actualReps: 1, unit: 'lb' as const, outcome: 'completed' as const }
    expect(mapActualSetFields('session', '2026-10-14', { ...base, actualWeight: null })).toBeNull()
    expect(mapActualSetFields('session', '2026-10-14', { ...base, outcome: 'skipped' })).toBeNull()
    expect(mapActualSetFields('session', '2026-10-14', { ...base, actualReps: 0 })).toMatchObject({ success: false, singleCompleted: false, countsDay: false })
    expect(mapActualSetFields('session', '2026-10-14', { ...base, warmup: true })).toMatchObject({ singleCompleted: false })
    expect(mapActualSetFields('session', '2026-10-14', { ...base, rpe: 7.5 })).toMatchObject({ singleCompleted: true })
  })

  it('reuses the existing authenticated encryption and source-bound decryption', async () => {
    const code = newCode()
    const snapshot = { schema: 1, source: 'bulgarian', events: [] }
    const encrypted = await encryptSnapshot(code, snapshot)
    expect(encrypted).toMatchObject({ version: 1 })
    expect(encrypted.ciphertext).not.toContain('bulgarian')
    expect(await decryptSnapshot(code, encrypted, 'bulgarian')).toEqual(snapshot)
    await expect(decryptSnapshot(newCode(), encrypted, 'bulgarian')).rejects.toThrow()
    await expect(decryptSnapshot(code, encrypted, 'accessory')).rejects.toThrow()
    expect(await authFor(code)).toMatch(/^[a-f0-9]{64}$/)
  })

  it('tests vendor PUT only through an injected mock, without a live account write', async () => {
    const code = newCode()
    const fetcher: typeof fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    await putHistory(code, { schema: 1, source: 'bulgarian', events: [] }, { fetcher })
    const [url, options] = vi.mocked(fetcher).mock.calls[0]
    expect(String(url)).toMatch(/\/api\/history\/bulgarian$/)
    expect(options?.method).toBe('PUT')
    expect(options?.headers).toMatchObject({ Authorization: `Bearer ${await authFor(code)}` })
    expect(JSON.parse(String(options?.body))).toHaveProperty('ciphertext')
  })
})

describe('connection scope and honest relay checks', () => {
  it('validates the original pairing code and separates local account identities', async () => {
    const code = newCode()
    const first = await pairConnection(code)
    expect(await pairConnection(` ${code} `)).toEqual(first)
    expect((await pairConnection(newCode())).accountId).not.toBe(first.accountId)
    expect(first.accountId).not.toBe(await authFor(code))
    await expect(pairConnection('not-a-connection')).rejects.toThrow()
  })

  it('checks the actual read endpoint only when explicitly requested', async () => {
    const fetcher: typeof fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ service: 'Powerlevel encrypted history relay', version: 1 }), { status: 200 }))
      .mockResolvedValueOnce(new Response('', { status: 404 }))
    const signal = new AbortController().signal
    const result = await checkConnection(newCode(), { fetcher, signal })
    expect(result).toMatchObject({ status: 'available', uploadsSupported: false })
    expect(vi.mocked(fetcher).mock.calls[1][1]).toMatchObject({ method: 'GET', signal, cache: 'no-store' })
    expect(result.message).toContain('still need')
  })

  it('reports authentication, browser-origin, and transient errors honestly', async () => {
    const code = newCode()
    for (const status of [401, 403]) {
      const fetcher: typeof fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ service: 'Powerlevel encrypted history relay', version: 1 }), { status: 200 })).mockResolvedValueOnce(new Response('', { status }))
      expect(await checkConnection(code, { fetcher })).toMatchObject({ status: 'auth-error', uploadsSupported: false })
    }
    const serverError: typeof fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ service: 'Powerlevel encrypted history relay', version: 1 }), { status: 200 })).mockResolvedValueOnce(new Response('', { status: 503 }))
    expect(await checkConnection(code, { fetcher: serverError })).toMatchObject({ status: 'failed', uploadsSupported: false })
    const offline: typeof fetch = vi.fn().mockRejectedValue(new TypeError('offline'))
    expect(await checkConnection(code, { fetcher: offline })).toMatchObject({ status: 'unreachable', uploadsSupported: false })
  })
})
