import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceStore } from './store';

function resetStore(): void {
  useWorkspaceStore.setState({ files: new Map(), refCounts: new Map() });
}

describe('useWorkspaceStore', () => {
  beforeEach(() => {
    resetStore();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('subscribe() fetches a path on first subscriber only', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ path: 'config.json', kind: 'json', data: { title: 'Hi' } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const unsubscribeA = useWorkspaceStore.getState().subscribe('config.json');
    const unsubscribeB = useWorkspaceStore.getState().subscribe('config.json');
    await vi.waitFor(() => {
      expect(useWorkspaceStore.getState().files.get('config.json')?.data).toEqual({ title: 'Hi' });
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/ws/file?path=config.json');

    unsubscribeA();
    unsubscribeB();
  });

  it('unsubscribe drops the refcount so a later handleWsChange is ignored', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ path: 'agents.json', kind: 'json', data: { agents: [] } }),
      }),
    );

    const unsubscribe = useWorkspaceStore.getState().subscribe('agents.json');
    await vi.waitFor(() => {
      expect(useWorkspaceStore.getState().files.get('agents.json')?.loading).toBe(false);
    });
    unsubscribe();

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    useWorkspaceStore.getState().handleWsChange('agents.json', 'rev-1');
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('handleWsChange refetches a subscribed path on a new rev', async () => {
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => {
        call += 1;
        return {
          ok: true,
          json: async () => ({ path: 'agents.json', kind: 'json', data: { agents: [], call } }),
        };
      }),
    );

    const unsubscribe = useWorkspaceStore.getState().subscribe('agents.json');
    await vi.waitFor(() => {
      expect(useWorkspaceStore.getState().files.get('agents.json')?.loading).toBe(false);
    });
    expect(call).toBe(1);

    useWorkspaceStore.getState().handleWsChange('agents.json', 'rev-external');
    await vi.waitFor(() => {
      expect(useWorkspaceStore.getState().files.get('agents.json')?.rev).toBe('rev-external');
    });
    expect(call).toBe(2);

    unsubscribe();
  });

  it('handleWsChange echo-suppresses a rev matching our own last write', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ path: 'sprints.json', kind: 'json', data: { tasks: [] } }),
      }),
    );

    const unsubscribe = useWorkspaceStore.getState().subscribe('sprints.json');
    await vi.waitFor(() => {
      expect(useWorkspaceStore.getState().files.get('sprints.json')?.loading).toBe(false);
    });

    const putMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ path: 'sprints.json', rev: 'rev-mine' }),
    });
    vi.stubGlobal('fetch', putMock);
    await useWorkspaceStore.getState().writeFile('sprints.json', { tasks: [{ id: '1' }] });
    expect(useWorkspaceStore.getState().files.get('sprints.json')?.rev).toBe('rev-mine');

    const refetchMock = vi.fn();
    vi.stubGlobal('fetch', refetchMock);
    useWorkspaceStore.getState().handleWsChange('sprints.json', 'rev-mine');
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(refetchMock).not.toHaveBeenCalled();

    unsubscribe();
  });

  it('writeFile PUTs JSON with the right method/headers/body and records the returned rev', async () => {
    const putMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ path: 'config.json', rev: 'abc123' }),
    });
    vi.stubGlobal('fetch', putMock);

    const result = await useWorkspaceStore.getState().writeFile('config.json', { title: 'New' });

    expect(result).toEqual({ path: 'config.json', rev: 'abc123' });
    expect(putMock).toHaveBeenCalledWith(
      '/api/ws/file?path=config.json',
      expect.objectContaining({
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'New' }),
      }),
    );
    expect(useWorkspaceStore.getState().files.get('config.json')?.data).toEqual({ title: 'New' });
  });

  it('refetch surfaces a network/HTTP error without throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ error: 'no such workspace file: missing.json' }),
      }),
    );

    await useWorkspaceStore.getState().refetch('missing.json');

    const entry = useWorkspaceStore.getState().files.get('missing.json');
    expect(entry?.error).toBe('no such workspace file: missing.json');
    expect(entry?.loading).toBe(false);
  });
});
