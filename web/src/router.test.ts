import { afterEach, describe, expect, it } from 'vitest';
import { buildHash, getCurrentRoute, navigate, onRouteChange, parseHash } from './router';

describe('parseHash', () => {
  it('parses an empty/absent hash as no route', () => {
    expect(parseHash('')).toEqual({ panelId: null, subpath: null });
    expect(parseHash('#')).toEqual({ panelId: null, subpath: null });
    expect(parseHash('#/')).toEqual({ panelId: null, subpath: null });
  });

  it('parses a panel-only hash', () => {
    expect(parseHash('#/agents')).toEqual({ panelId: 'agents', subpath: null });
  });

  it('parses a panel + subpath hash', () => {
    expect(parseHash('#/flows/deploy-pipeline')).toEqual({ panelId: 'flows', subpath: 'deploy-pipeline' });
  });

  it('joins a multi-segment subpath back together', () => {
    expect(parseHash('#/docs/guides/setup')).toEqual({ panelId: 'docs', subpath: 'guides/setup' });
  });

  it('decodes percent-encoded segments', () => {
    expect(parseHash('#/docs/a%20b')).toEqual({ panelId: 'docs', subpath: 'a b' });
  });
});

describe('buildHash', () => {
  it('builds a panel-only hash', () => {
    expect(buildHash('agents')).toBe('#/agents');
  });

  it('builds a panel + subpath hash', () => {
    expect(buildHash('flows', 'deploy-pipeline')).toBe('#/flows/deploy-pipeline');
  });

  it('percent-encodes special characters', () => {
    expect(buildHash('docs', 'a b')).toBe('#/docs/a%20b');
  });

  it('round-trips through parseHash', () => {
    const hash = buildHash('sprints', 'q1 plan');
    expect(parseHash(hash)).toEqual({ panelId: 'sprints', subpath: 'q1 plan' });
  });
});

describe('window integration', () => {
  afterEach(() => {
    window.location.hash = '';
  });

  it('getCurrentRoute reads window.location.hash', () => {
    window.location.hash = '#/agents';
    expect(getCurrentRoute()).toEqual({ panelId: 'agents', subpath: null });
  });

  it('navigate sets window.location.hash', () => {
    navigate('crons', 'weekly');
    expect(window.location.hash).toBe('#/crons/weekly');
  });

  it('onRouteChange fires the callback on hashchange and unsubscribes cleanly', () => {
    let calls = 0;
    const unsubscribe = onRouteChange(() => {
      calls += 1;
    });

    window.location.hash = '#/agents';
    window.dispatchEvent(new Event('hashchange'));
    expect(calls).toBe(1);

    unsubscribe();
    window.location.hash = '#/flows';
    window.dispatchEvent(new Event('hashchange'));
    expect(calls).toBe(1);
  });
});
