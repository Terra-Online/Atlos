import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { deferred } from '../../../test-support/pages';

let client: typeof import('./backendClient');
let auth: typeof import('@/store/auth').useAuthStore;
const network = vi.fn<typeof fetch>();
const response = (roleId: string) => Response.json({ binding: { bound: true, enabled: true, roleId, serverId: 1 } });

beforeEach(async () => {
    vi.resetModules(); vi.useFakeTimers({ toFake: ['Date'] }); network.mockReset();
    network.mockImplementation(() => Promise.resolve(response('latest')));
    vi.stubGlobal('fetch', network);
    ({ useAuthStore: auth } = await import('@/store/auth'));
    auth.getState().setSessionUser({ uid: 'a', nickname: 'A' });
    client = await import('./backendClient');
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it('deduplicates current session requests, expires the cache and preserves HTTP credentials', async () => {
    const pending = deferred<Response>(); network.mockReturnValue(pending.promise);
    const first = client.getEFBindingStatus(), second = client.getEFBindingStatus();
    expect(second).toBe(first);
    pending.resolve(response('current')); expect((await first).binding.roleId).toBe('current');
    expect((await client.getEFBindingStatus()).binding.roleId).toBe('current');
    expect(network).toHaveBeenCalledOnce();
    const [url, options] = network.mock.calls[0];
    expect(url).toContain('/binding/v1/endfield/status');
    expect(options?.credentials).toBe('include');
    expect(options?.headers).toBeInstanceOf(Headers);
    vi.setSystemTime(Date.now() + 3001);
    network.mockResolvedValueOnce(response('after-ttl'));
    expect((await client.getEFBindingStatus()).binding.roleId).toBe('after-ttl');
    expect(network).toHaveBeenCalledTimes(2);
});

it.each(['account-switch', 'relogin', 'account-roundtrip'] as const)('does not reuse a warm binding cache after %s', async (boundary) => {
    network.mockResolvedValueOnce(response('old')).mockResolvedValueOnce(response('fresh'));
    expect((await client.getEFBindingStatus()).binding.roleId).toBe('old');
    if (boundary === 'relogin') auth.getState().clearSessionUser();
    else auth.getState().setSessionUser({ uid: 'b', nickname: 'B' });
    if (boundary !== 'account-switch') auth.getState().setSessionUser({ uid: 'a', nickname: 'A' });
    expect((await client.getEFBindingStatus()).binding.roleId).toBe('fresh');
    expect(network).toHaveBeenCalledTimes(2);
});

it('starts a new account request and keeps its lock when an older request finishes', async () => {
    const older = deferred<Response>(), newer = deferred<Response>();
    network.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    const oldRequest = client.getEFBindingStatus();
    auth.getState().setSessionUser({ uid: 'b', nickname: 'B' });
    const newRequest = client.getEFBindingStatus();
    expect(network).toHaveBeenCalledTimes(2);
    older.resolve(response('old')); await oldRequest;
    expect(client.getEFBindingStatus()).toBe(newRequest);
    newer.resolve(response('fresh')); expect((await newRequest).binding.roleId).toBe('fresh');
    expect((await client.getEFBindingStatus()).binding.roleId).toBe('fresh');
    expect(network).toHaveBeenCalledTimes(2);
});

it('does not let a previous account mutation invalidate the new account status request', async () => {
    const unlink = deferred<Response>(), status = deferred<Response>();
    network.mockReturnValueOnce(unlink.promise).mockReturnValueOnce(status.promise);
    const oldMutation = client.unlinkEFBinding();
    auth.getState().setSessionUser({ uid: 'b', nickname: 'B' });
    const newStatus = client.getEFBindingStatus();
    unlink.resolve(Response.json({ ok: true, binding: { bound: false, enabled: false } })); await oldMutation;
    expect(client.getEFBindingStatus()).toBe(newStatus);
    status.resolve(response('b')); expect((await newStatus).binding.roleId).toBe('b');
    expect((await client.getEFBindingStatus()).binding.roleId).toBe('b');
    expect(network).toHaveBeenCalledTimes(2);
});

it('cannot refill an invalidated status cache or clear a newer status lock after a binding mutation', async () => {
    const oldStatus = deferred<Response>(), bind = deferred<Response>(), newStatus = deferred<Response>();
    network.mockReturnValueOnce(oldStatus.promise).mockReturnValueOnce(bind.promise).mockReturnValueOnce(newStatus.promise);
    const stale = client.getEFBindingStatus();
    const mutation = client.bindEFRole('flow', { roleId: 'new-role', serverId: 1 });
    bind.resolve(Response.json({ ok: true, binding: { bound: true, enabled: true, roleId: 'new-role', serverId: 1 } })); await mutation;
    const fresh = client.getEFBindingStatus();
    oldStatus.resolve(response('stale')); await stale;
    expect(client.getEFBindingStatus()).toBe(fresh);
    newStatus.resolve(response('new-role')); expect((await fresh).binding.roleId).toBe('new-role');
    expect((await client.getEFBindingStatus()).binding.roleId).toBe('new-role');
    expect(network).toHaveBeenCalledTimes(3);
});

it('keeps a later mutation in charge of cache invalidation within the same account', async () => {
    const first = deferred<Response>(), last = deferred<Response>(), status = deferred<Response>();
    network.mockReturnValueOnce(first.promise).mockReturnValueOnce(last.promise).mockReturnValueOnce(status.promise);
    const oldMutation = client.bindEFRole('old-flow', { roleId: 'old-role', serverId: 1 });
    const latestMutation = client.unlinkEFBinding();
    const duringMutation = client.getEFBindingStatus();
    first.resolve(Response.json({ ok: true, binding: { bound: true, enabled: true } })); await oldMutation;
    expect(client.getEFBindingStatus()).toBe(duringMutation);
    last.resolve(Response.json({ ok: true, binding: { bound: false, enabled: false } })); await latestMutation;
    status.resolve(response('during-mutation')); await duringMutation;
    expect((await client.getEFBindingStatus()).binding.roleId).toBe('latest');
    expect(network).toHaveBeenCalledTimes(4);
});
