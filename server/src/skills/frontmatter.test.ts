import { describe, expect, it } from 'vitest';
import { parseSkillFrontmatter } from './frontmatter.ts';

describe('parseSkillFrontmatter', () => {
  it('parses plain scalar name/description', () => {
    const raw = [
      '---',
      'name: tdd',
      'description: Test-driven development workflow.',
      '---',
      '',
      '# TDD',
    ].join('\n');
    expect(parseSkillFrontmatter(raw)).toEqual({
      name: 'tdd',
      description: 'Test-driven development workflow.',
    });
  });

  it('strips double and single quotes around scalar values', () => {
    const raw = ['---', 'name: "implement"', "description: 'Implement a spec.'", '---'].join('\n');
    expect(parseSkillFrontmatter(raw)).toEqual({ name: 'implement', description: 'Implement a spec.' });
  });

  it('folds a >- block scalar description across multiple lines into one space-joined string', () => {
    const raw = [
      '---',
      'name: context-engineering',
      'description: >-',
      '  Master context engineering for AI agent systems. Use when designing agent',
      '  architectures, debugging context failures, optimizing token usage.',
      '---',
    ].join('\n');
    expect(parseSkillFrontmatter(raw)).toEqual({
      name: 'context-engineering',
      description:
        'Master context engineering for AI agent systems. Use when designing agent ' +
        'architectures, debugging context failures, optimizing token usage.',
    });
  });

  it('ignores irrelevant keys (version, allowed-tools, argument-hint, etc.)', () => {
    const raw = [
      '---',
      'name: watch',
      'version: "0.2.0"',
      'description: Watch a video.',
      'argument-hint: "<video-url> [question]"',
      'allowed-tools: Bash, Read',
      '---',
    ].join('\n');
    expect(parseSkillFrontmatter(raw)).toEqual({ name: 'watch', description: 'Watch a video.' });
  });

  it('returns an empty object when there is no frontmatter block', () => {
    expect(parseSkillFrontmatter('# Just a heading\n\nNo frontmatter here.')).toEqual({});
  });

  it('returns an empty object when frontmatter has neither name nor description', () => {
    const raw = ['---', 'disable-model-invocation: true', '---'].join('\n');
    expect(parseSkillFrontmatter(raw)).toEqual({});
  });
});
