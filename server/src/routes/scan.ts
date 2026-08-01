// POST /api/scan/skills (PLAN.md §5/§8 item 8): walks configured skill roots and regenerates
// skills.json, merging with (not clobbering) any hand-added `source: 'manual'` nodes. The actual
// filesystem walk + frontmatter parsing + merge logic lives in ../skills/scan.ts (testable
// independent of Hono — same split as chat/tools.ts + routes/chat.ts). Writes go through
// `workspace.writeFile` (atomic, schema-validated), same as every other route — no second
// file-write path.
import { Hono } from 'hono';
import { ConfigSchema, SkillsFileSchema } from '@agent-dashboard/shared';
import { Workspace, WorkspaceNotFoundError } from '../workspace.ts';
import { scanSkills } from '../skills/scan.ts';

export function createScanRoutes(workspace: Workspace): Hono {
  const routes = new Hono();

  routes.post('/skills', async (c) => {
    let roots: string[] | undefined;
    try {
      const configResult = await workspace.readFile('config.json');
      const parsedConfig = ConfigSchema.safeParse(configResult.data);
      if (parsedConfig.success) roots = parsedConfig.data.skillRoots;
    } catch (err) {
      if (!(err instanceof WorkspaceNotFoundError)) throw err;
      // no config.json yet — scanSkills() falls back to its own default roots
    }

    let existing;
    try {
      const existingResult = await workspace.readFile('skills.json');
      const parsedExisting = SkillsFileSchema.safeParse(existingResult.data);
      if (parsedExisting.success) existing = parsedExisting.data;
    } catch (err) {
      if (!(err instanceof WorkspaceNotFoundError)) throw err;
      // no skills.json yet — scanSkills() falls back to {nodes: [], edges: []}
    }

    const result = await scanSkills({ ...(roots ? { roots } : {}), ...(existing ? { existing } : {}) });
    await workspace.writeFile('skills.json', result.file);

    return c.json({
      skills: result.file,
      rootsScanned: result.rootsScanned,
      rootsSkipped: result.rootsSkipped,
    });
  });

  return routes;
}
