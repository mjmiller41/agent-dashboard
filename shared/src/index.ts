// @agent-dashboard/shared — zod schemas + inferred TS types for every
// workspace document type (PLAN.md §4), plus the filename-convention
// registry used to pick the right schema for a workspace-relative path.

export const SHARED_PACKAGE_NAME = '@agent-dashboard/shared';

export * from './schemas/config.ts';
export * from './schemas/agents.ts';
export * from './schemas/flow.ts';
export * from './schemas/skills.ts';
export * from './schemas/crons.ts';
export * from './schemas/generations.ts';
export * from './schemas/links.ts';
export * from './schemas/sprints.ts';
export * from './schemas/registry.ts';
