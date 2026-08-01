import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { useWorkspaceFile, type UseWorkspaceFileResult } from './useWorkspaceFile';
import { useWorkspaceStore } from '../store';

const schema = z.object({ title: z.string().min(1) });

let container: HTMLDivElement;
let root: Root;
// A mutable ref-object (not a reassigned outer binding) so the render
// function itself stays pure per eslint-plugin-react-hooks' purity rule —
// only `resultRef.current` is mutated, `resultRef` itself never is.
const resultRef: { current: UseWorkspaceFileResult<z.infer<typeof schema>> | undefined } = {
  current: undefined,
};

function Harness({ path }: { path: string }) {
  const result = useWorkspaceFile(path, schema);
  // Recording into the outer ref-object happens in an effect, not during
  // render, per eslint-plugin-react-hooks' purity/immutability rule.
  useEffect(() => {
    resultRef.current = result;
  });
  return null;
}

async function flush(): Promise<void> {
  // Let pending fetch-then-.json()-then-setState microtasks settle across a render.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  useWorkspaceStore.setState({ files: new Map(), refCounts: new Map() });
  resultRef.current = undefined;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('useWorkspaceFile', () => {
  it('starts in a loading state with no data/error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})));
    await act(async () => {
      root.render(<Harness path="config.json" />);
      await Promise.resolve();
    });
    expect(resultRef.current?.loading).toBe(true);
    expect(resultRef.current?.data).toBeUndefined();
    expect(resultRef.current?.error).toBeUndefined();
  });

  it('exposes parsed data once the fetch resolves with schema-valid content', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ path: 'config.json', kind: 'json', data: { title: 'Hello' } }),
      }),
    );

    act(() => {
      root.render(<Harness path="config.json" />);
    });
    await flush();

    expect(resultRef.current?.data).toEqual({ title: 'Hello' });
    expect(resultRef.current?.error).toBeUndefined();
    expect(resultRef.current?.loading).toBe(false);
  });

  it('surfaces a schema validation failure as `error`, not a thrown exception', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ path: 'config.json', kind: 'json', data: { title: '' } }),
      }),
    );

    expect(() => {
      act(() => {
        root.render(<Harness path="config.json" />);
      });
    }).not.toThrow();
    await flush();

    expect(resultRef.current?.data).toBeUndefined();
    expect(resultRef.current?.error?.path).toBe('config.json');
    expect(resultRef.current?.error?.message).toContain('failed schema validation');
    expect(resultRef.current?.error?.issues?.length).toBeGreaterThan(0);
  });

  it('surfaces a fetch/HTTP failure as `error`', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ error: 'no such workspace file: config.json' }),
      }),
    );

    act(() => {
      root.render(<Harness path="config.json" />);
    });
    await flush();

    expect(resultRef.current?.data).toBeUndefined();
    expect(resultRef.current?.error?.message).toBe('no such workspace file: config.json');
  });

  it('save() PUTs the mutator result back to the file', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ path: 'config.json', kind: 'json', data: { title: 'Old' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ path: 'config.json', rev: 'rev-1' }),
      });
    vi.stubGlobal('fetch', fetchMock);

    act(() => {
      root.render(<Harness path="config.json" />);
    });
    await flush();
    expect(resultRef.current?.data).toEqual({ title: 'Old' });

    await act(async () => {
      await resultRef.current?.save((current) => ({ title: `${current?.title ?? ''} Updated` }));
    });

    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/ws/file?path=config.json',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ title: 'Old Updated' }) }),
    );
  });
});
