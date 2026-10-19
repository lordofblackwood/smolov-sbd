import { describe, expect, it, vi } from 'vitest'
import type { Workout } from '../src/domain/types'
import { checkConnection, mergeSessionRevision, pairConnection, snapshotForWorkout, syncWorkout } from '../src/integration/powerlevel'
import { decryptSnapshot, newCode } from '../src/integration/vendor/sync.mjs'
import worker from '../integrations/relay/src/worker.mjs'

function workout(accountId: string, id = 'session-1'): Workout {
  return {
    id, revision: 1, date: '2026-10-14', startedAt: '2026-10-14T12:00:00-04:00', updatedAt: '2026-10-14T12:04:00-04:00', finishedAt: '2026-10-14T12:04:00-04:00',
    status: 'completed', accountId, notes: 'Actual calibration', sync: { status: 'pending' },
    targets: [{ id: 'bench:calibration:1', blockId: 'bench:calibration', lift: 'bench', setNumber: 1, reps: 1, weight: null, unit: 'lb', rule: 'Calibration single', rpeTarget: '6–8', kind: 'calibration' }],
    sets: [{ id: 'actual-set', targetId: 'bench:calibration:1', lift: 'bench', weight: 285, unit: 'lb', reps: 1, outcome: 'complete', rpe: 7, notes: 'Controlled', pain: false, loggedAt: '2026-10-14T12:03:00-04:00' }],
  }
}

/** Faithful in-memory conditional storage; never contacts the live relay. */
function mockRelay(options: { loseWriteResponse?: boolean; conflict?: boolean; reconciliationUnavailable?: boolean } = {}) {
  let writes = 0
  let puts = 0
  let failed = false
  const keys: string[] = []
  const conditions: Headers[] = []
  const objects = new Map<string, { body: string; httpEtag: string; uploaded: Date; customMetadata: { updatedAt: string } }>()
  const env = { BUCKET: {
    get: async (key: string) => objects.get(key) ?? null,
    put: async (key: string, body: string, config: { onlyIf?: Headers; customMetadata: { updatedAt: string } }) => {
      conditions.push(config.onlyIf ?? new Headers())
      const prior = objects.get(key)
      if (options.conflict || (config.onlyIf?.get('If-None-Match') === '*' && prior) || (config.onlyIf?.has('If-Match') && config.onlyIf.get('If-Match') !== prior?.httpEtag)) return null
      writes++
      keys.push(key)
      const record = { body, httpEtag: `"etag-${writes}"`, uploaded: new Date(), customMetadata: config.customMetadata }
      objects.set(key, record)
      return record
    },
  } }
  const fetcher: typeof fetch = vi.fn(async (input, init) => {
    const request = new Request(input, init)
    if (failed && options.reconciliationUnavailable && request.method === 'GET' && new URL(request.url).pathname !== '/') throw new TypeError('offline after dispatch')
    if (request.method === 'PUT') puts++
    const response = await worker.fetch(request, env)
    if (request.method === 'PUT' && options.loseWriteResponse && !failed) {
      failed = true
      throw new TypeError('connection dropped after commit')
    }
    return response
  })
  return { fetcher, objects, keys, conditions, countWrites: () => writes, countPuts: () => puts }
}

describe('prepared existing-service extension, isolated from production', () => {
  it('reports an advertised upload capability during a read-only check without performing a write', async () => {
    const relay = mockRelay()
    expect(await checkConnection(newCode(), { fetcher: relay.fetcher })).toMatchObject({ status: 'available', uploadsSupported: true })
    expect(relay.countPuts()).toBe(0)
  })

  it('stays paused with the real current version-1 capability shape', async () => {
    const code = newCode(), connection = await pairConnection(code)
    const fetcher: typeof fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ service: 'Powerlevel encrypted history relay', version: 1 }), { status: 200 }))
    expect(await syncWorkout(workout(connection.accountId), code, connection.accountId, { fetcher })).toMatchObject({ status: 'needs-attention', retryable: false })
    expect(vi.mocked(fetcher).mock.calls).toHaveLength(1)
    expect(vi.mocked(fetcher).mock.calls[0][1]?.method).toBe('GET')
  })

  it('uses a dedicated encrypted source and conditional creation only after capability verification', async () => {
    const code = newCode(), connection = await pairConnection(code), relay = mockRelay()
    expect(await syncWorkout(workout(connection.accountId), code, connection.accountId, { fetcher: relay.fetcher })).toMatchObject({ status: 'synced' })
    expect(relay.keys).toHaveLength(1)
    expect(relay.keys[0]).toMatch(/\/smolov\.json$/)
    expect(relay.keys[0]).not.toContain('bulgarian')
    expect(relay.conditions[0].get('If-None-Match')).toBe('*')
    const encrypted = JSON.parse([...relay.objects.values()][0].body)
    const saved = await decryptSnapshot(code, encrypted, 'smolov')
    expect(saved.events[0]).toMatchObject({ source: 'smolov', exercise: 'benchPress', weight: 285, unit: 'lb', originalWeight: 285, originalUnit: 'lb', reps: 1, rpe: 7, notes: 'Controlled', singleCompleted: true })
    expect(saved.sessions[0]).toMatchObject({ id: 'session-1', revision: 1, trainingDate: '2026-10-14' })
  })

  it('reconciles retry/reload without uploading the same revision again', async () => {
    const code = newCode(), connection = await pairConnection(code), relay = mockRelay(), session = workout(connection.accountId)
    await syncWorkout(session, code, connection.accountId, { fetcher: relay.fetcher })
    expect(await syncWorkout(JSON.parse(JSON.stringify(session)), code, connection.accountId, { fetcher: relay.fetcher })).toMatchObject({ status: 'synced' })
    expect(relay.countWrites()).toBe(1)
    expect(relay.countPuts()).toBe(1)
  })

  it('upserts a correction with If-Match while preserving other sessions', async () => {
    const code = newCode(), connection = await pairConnection(code), relay = mockRelay(), first = workout(connection.accountId)
    await syncWorkout(first, code, connection.accountId, { fetcher: relay.fetcher })
    await syncWorkout(workout(connection.accountId, 'another-session'), code, connection.accountId, { fetcher: relay.fetcher })
    const correction = structuredClone(first)
    correction.revision = 2
    correction.updatedAt = '2026-10-14T12:05:00-04:00'
    correction.sets[0].weight = 280
    correction.sets[0].notes = 'Corrected actual load'
    expect(await syncWorkout(correction, code, connection.accountId, { fetcher: relay.fetcher })).toMatchObject({ status: 'synced' })
    expect(relay.conditions[2].get('If-Match')).toBe('"etag-2"')
    const snapshot = await decryptSnapshot(code, JSON.parse([...relay.objects.values()][0].body), 'smolov')
    expect(snapshot.sessions).toHaveLength(2)
    expect(snapshot.events).toHaveLength(2)
    expect(snapshot.events.find((event: { sessionId: string }) => event.sessionId === first.id)).toMatchObject({ revision: 2, weight: 280 })
  })

  it.each([null, 'W/"proxy-etag"', '"proxy-etag"'])('uses the object version from the encrypted response when a proxy changes ETag to %s', async header => {
    const code = newCode(), connection = await pairConnection(code), relay = mockRelay()
    await syncWorkout(workout(connection.accountId), code, connection.accountId, { fetcher: relay.fetcher })
    const fetcher: typeof fetch = async (input, init) => {
      const response = await relay.fetcher(input, init)
      if (new URL(String(input)).pathname === '/api/history/smolov' && init?.method === 'GET' && response.ok) {
        const headers = new Headers(response.headers)
        if (header === null) headers.delete('ETag')
        else headers.set('ETag', header)
        return new Response(response.body, { status: response.status, headers })
      }
      return response
    }
    const deadlift = workout(connection.accountId, 'deadlift-session')
    deadlift.targets[0].lift = deadlift.sets[0].lift = 'deadlift'
    expect(await syncWorkout(deadlift, code, connection.accountId, { fetcher })).toMatchObject({ status: 'synced' })
    expect(relay.conditions[1].get('If-Match')).toBe('"etag-1"')
    expect(relay.countWrites()).toBe(2)
    const saved = await decryptSnapshot(code, JSON.parse([...relay.objects.values()][0].body), 'smolov')
    expect(saved.sessions).toHaveLength(2)
    expect(saved.events.find((event: { sessionId: string }) => event.sessionId === deadlift.id).exercise).toBe('deadlift')
  })

  it('still accepts a strong header from relays without the additive body tag', async () => {
    const code = newCode(), connection = await pairConnection(code), relay = mockRelay()
    await syncWorkout(workout(connection.accountId), code, connection.accountId, { fetcher: relay.fetcher })
    const fetcher: typeof fetch = async (input, init) => {
      const response = await relay.fetcher(input, init)
      if (new URL(String(input)).pathname !== '/api/history/smolov' || init?.method !== 'GET' || !response.ok) return response
      const envelope = await response.json()
      delete envelope.snapshotEtag
      return new Response(JSON.stringify(envelope), { status: response.status, headers: response.headers })
    }
    expect(await syncWorkout(workout(connection.accountId, 'next-session'), code, connection.accountId, { fetcher })).toMatchObject({ status: 'synced' })
    expect(relay.conditions[1].get('If-Match')).toBe('"etag-1"')
  })

  it.each(['*', 'W/"weak"', 'unquoted', '"back\\slash"', '"line\nbreak"', 42, null, '"one", "two"'])('rejects an unsafe body version %j without falling back to a different header', async tag => {
    const code = newCode(), connection = await pairConnection(code), relay = mockRelay()
    await syncWorkout(workout(connection.accountId), code, connection.accountId, { fetcher: relay.fetcher })
    const fetcher: typeof fetch = async (input, init) => {
      const response = await relay.fetcher(input, init)
      if (new URL(String(input)).pathname !== '/api/history/smolov' || init?.method !== 'GET' || !response.ok) return response
      return new Response(JSON.stringify({ ...await response.json(), snapshotEtag: tag }), { status: response.status, headers: response.headers })
    }
    expect(await syncWorkout(workout(connection.accountId, 'next-session'), code, connection.accountId, { fetcher })).toMatchObject({ status: 'needs-attention', reason: 'The relay did not return a safe snapshot ETag.', retryable: false })
    expect(relay.countPuts()).toBe(1)
  })

  it('pauses without writing when both snapshot version transports are unavailable', async () => {
    const code = newCode(), connection = await pairConnection(code), relay = mockRelay()
    await syncWorkout(workout(connection.accountId), code, connection.accountId, { fetcher: relay.fetcher })
    const fetcher: typeof fetch = async (input, init) => {
      const response = await relay.fetcher(input, init)
      if (new URL(String(input)).pathname !== '/api/history/smolov' || init?.method !== 'GET' || !response.ok) return response
      const envelope = await response.json(), headers = new Headers(response.headers)
      delete envelope.snapshotEtag
      headers.delete('ETag')
      return new Response(JSON.stringify(envelope), { status: response.status, headers })
    }
    expect(await syncWorkout(workout(connection.accountId, 'next-session'), code, connection.accountId, { fetcher })).toMatchObject({ status: 'needs-attention', reason: 'The relay did not return a safe snapshot ETag.' })
    expect(relay.countPuts()).toBe(1)
  })

  it('rejects stale or conflicting revisions rather than replacing newer evidence', () => {
    const original = workout('test-account'), later = structuredClone(original)
    later.revision = 2
    expect(() => mergeSessionRevision(snapshotForWorkout(later), snapshotForWorkout(original))).toThrow('newer revision')
    const changed = structuredClone(original)
    changed.sets[0].weight = 275
    expect(() => mergeSessionRevision(snapshotForWorkout(original), snapshotForWorkout(changed))).toThrow('different remote content')
  })

  it('keeps failed reps, skips, and warm-ups separate from successful strength evidence', () => {
    const session = workout('test-account')
    session.targets[0].kind = 'working'
    delete session.targets[0].rpeTarget
    session.targets[0].weight = 230
    session.targets[0].reps = 5
    session.sets[0].weight = 225
    session.sets[0].reps = 3
    session.sets[0].outcome = 'failed'
    delete session.sets[0].rpe
    expect(snapshotForWorkout(session).events[0]).toMatchObject({ weight: 225, reps: 3, success: false, singleCompleted: false })
    session.sets[0].outcome = 'skipped'
    session.sets[0].reps = 0
    expect(snapshotForWorkout(session).events[0]).toMatchObject({ weight: null, originalWeight: null, reps: 0, success: false, countsDay: false })
    session.targets[0].kind = 'warmup'
    session.sets[0].outcome = 'complete'
    session.sets[0].reps = 1
    expect(snapshotForWorkout(session).events[0]).toMatchObject({ singleCompleted: false })
  })

  it('does not make requests for another account or an invalid local record', async () => {
    const code = newCode(), connection = await pairConnection(code), relay = mockRelay()
    expect(await syncWorkout(workout('different-account'), code, connection.accountId, { fetcher: relay.fetcher })).toMatchObject({ status: 'needs-attention' })
    expect(relay.fetcher).not.toHaveBeenCalled()
    const invalid = workout(connection.accountId)
    invalid.sets[0].targetId = 'missing-target'
    expect(await syncWorkout(invalid, code, connection.accountId, { fetcher: relay.fetcher })).toMatchObject({ status: 'needs-attention' })
    expect(relay.fetcher).not.toHaveBeenCalled()
  })

  it('recovers a committed write with a lost response by exact read-back', async () => {
    const code = newCode(), connection = await pairConnection(code), relay = mockRelay({ loseWriteResponse: true })
    expect(await syncWorkout(workout(connection.accountId), code, connection.accountId, { fetcher: relay.fetcher })).toMatchObject({ status: 'synced' })
    expect(relay.countPuts()).toBe(1)
    expect(relay.countWrites()).toBe(1)
  })

  it('pauses when an ambiguous write cannot be reconciled and never blindly repeats PUT', async () => {
    const code = newCode(), connection = await pairConnection(code), relay = mockRelay({ loseWriteResponse: true, reconciliationUnavailable: true })
    expect(await syncWorkout(workout(connection.accountId), code, connection.accountId, { fetcher: relay.fetcher })).toMatchObject({ status: 'needs-attention', ambiguous: true, retryable: false })
    expect(relay.countPuts()).toBe(1)
  })

  it('pauses atomic conflicts and authentication failures', async () => {
    const code = newCode(), connection = await pairConnection(code), relay = mockRelay({ conflict: true })
    expect(await syncWorkout(workout(connection.accountId), code, connection.accountId, { fetcher: relay.fetcher })).toMatchObject({ status: 'needs-attention', retryable: false })
    expect(relay.countWrites()).toBe(0)
    const badAuth: typeof fetch = vi.fn(async input => String(input).endsWith('/') ? worker.fetch(new Request(input), { BUCKET: {} }) : new Response('', { status: 401 }))
    expect(await syncWorkout(workout(connection.accountId), code, connection.accountId, { fetcher: badAuth })).toMatchObject({ status: 'needs-attention', retryable: false })
  })

  it('permits safe automatic retries only for transient failures before write dispatch', async () => {
    const code = newCode(), connection = await pairConnection(code)
    const offline: typeof fetch = vi.fn().mockRejectedValue(new TypeError('offline'))
    expect(await syncWorkout(workout(connection.accountId), code, connection.accountId, { fetcher: offline })).toMatchObject({ status: 'pending', retryable: true })
    expect(vi.mocked(offline).mock.calls).toHaveLength(1)
  })

  it('retains scheduled dates but attributes actual evidence to New York activity dates across DST', () => {
    const session = workout('test-account')
    session.date = '2026-10-26'
    session.startedAt = '2026-11-02T04:50:00Z'
    session.updatedAt = '2026-11-02T05:20:00Z'
    session.finishedAt = session.updatedAt
    session.sets[0].loggedAt = '2026-11-02T05:10:00Z'
    const snapshot = snapshotForWorkout(session)
    expect(snapshot.sessions[0]).toMatchObject({ scheduledDate: '2026-10-26', trainingDate: '2026-11-01' })
    expect(snapshot.events[0]).toMatchObject({ date: '2026-11-02', occurredAt: '2026-11-02T05:10:00Z' })
    session.sets[0].loggedAt = '2026-11-01T05:30:00Z'
    expect(snapshotForWorkout(session).events[0].date).toBe('2026-11-01')
    session.sets[0].loggedAt = '2026-11-01T06:30:00Z'
    expect(snapshotForWorkout(session).events[0].date).toBe('2026-11-01')
  })
})
