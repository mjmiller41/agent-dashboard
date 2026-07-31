// Filename-convention -> schema lookup, per PLAN.md §4/§5. Shared by the server
// (workspace.ts validates PUTs against this) and by tests that walk
// workspace.example/ and validate every JSON file against its schema.
import type { z } from 'zod';
import { ConfigSchema } from './config.ts';
import { AgentsFileSchema } from './agents.ts';
import { FlowSchema } from './flow.ts';
import { SkillsFileSchema } from './skills.ts';
import { CronsFileSchema } from './crons.ts';
import { GenerationsFileSchema } from './generations.ts';
import { LinksFileSchema } from './links.ts';
import { SprintsFileSchema } from './sprints.ts';

export type WorkspaceSchema = z.ZodType;

/**
 * Resolve the zod schema for a workspace-relative file path, by filename
 * convention (PLAN.md §4). Returns `null` for known-unvalidated file kinds
 * (`docs/**\/*.md`, `icons/*.svg`) and for any path that isn't a recognized
 * workspace document at all.
 */
export function schemaForPath(relativePath: string): WorkspaceSchema | null {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');

  switch (normalized) {
    case 'config.json':
      return ConfigSchema;
    case 'agents.json':
      return AgentsFileSchema;
    case 'skills.json':
      return SkillsFileSchema;
    case 'crons.json':
      return CronsFileSchema;
    case 'generations.json':
      return GenerationsFileSchema;
    case 'links.json':
      return LinksFileSchema;
    case 'sprints.json':
      return SprintsFileSchema;
    default:
      break;
  }

  if (/^flows\/[^/]+\.json$/.test(normalized)) {
    return FlowSchema;
  }

  return null;
}

/** True for the free-form document kinds that intentionally have no schema. */
export function isUnvalidatedWorkspacePath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
  return /^docs\/.+\.md$/.test(normalized) || /^icons\/[^/]+\.svg$/.test(normalized);
}
