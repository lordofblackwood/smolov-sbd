import { describe, expect, it } from 'vitest';
import { requestWriterLease, WRITER_LOCK_NAME, type WriterLockStatus } from '../src/storage/useWriterLock';

/** Separate callers share one browser lock manager, as independent same-origin tabs do. */
function sharedLocks(): Pick<LockManager, 'request'> {
  const held = new Set<string>();
  const request = async (name: string, optionsOrCallback: LockOptions | LockGrantedCallback<unknown>, suppliedCallback?: LockGrantedCallback<unknown>) => {
    const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : suppliedCallback!;
    if (held.has(name)) return callback(null);
    held.add(name);
    try { return await callback({ name, mode: 'exclusive' } as Lock); }
    finally { held.delete(name); }
  };
  return { request: request as LockManager['request'] };
}

const tick = () => new Promise<void>(resolve => queueMicrotask(resolve));

describe('one local writer across tracker tabs', () => {
  it('prevents competing whole-state writers and allows a new owner after release', async () => {
    const locks = sharedLocks();
    const firstStates: WriterLockStatus[] = [], secondStates: WriterLockStatus[] = [];
    const first = requestWriterLease(status => firstStates.push(status), locks);
    await tick();
    const second = requestWriterLease(status => secondStates.push(status), locks);
    await second.closed;
    expect(firstStates).toEqual(['acquiring', 'writable']);
    expect(secondStates).toEqual(['acquiring', 'read-only']);
    first.release();
    await first.closed;
    const retryStates: WriterLockStatus[] = [];
    const retry = requestWriterLease(status => retryStates.push(status), locks);
    await tick();
    expect(retryStates.at(-1)).toBe('writable');
    retry.release();
    await retry.closed;
  });

  it('cannot publish writable ownership after the caller has already cleaned up', async () => {
    const states: WriterLockStatus[] = [];
    const lease = requestWriterLease(status => states.push(status), sharedLocks());
    lease.release();
    await lease.closed;
    expect(states).toEqual(['acquiring']);
  });

  it('stays nonwritable if browser coordination is unavailable or rejected', async () => {
    const unsupportedStates: WriterLockStatus[] = [];
    const unsupported = requestWriterLease(status => unsupportedStates.push(status), undefined);
    await unsupported.closed;
    expect(unsupportedStates.at(-1)).toBe('unsupported');
    const rejectedStates: WriterLockStatus[] = [];
    const rejecting = { request: () => Promise.reject(new DOMException('Unavailable', 'SecurityError')) } as Pick<LockManager, 'request'>;
    await requestWriterLease(status => rejectedStates.push(status), rejecting).closed;
    expect(rejectedStates.at(-1)).toBe('error');
    expect(WRITER_LOCK_NAME).toBe('smolov-sbd-writer-v1');
  });
});
