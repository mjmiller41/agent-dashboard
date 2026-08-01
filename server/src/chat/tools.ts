// Server-side tools for POST /api/chat (PLAN.md §6 "Assistant panel"), only
// registered when the request has `workspaceTools: true`. Each tool wraps
// `workspace.ts` directly — the same guarded/validated/atomic read+write
// path `routes/ws.ts` uses — so a tool-driven write gets identical path
// guarding, schema validation, and (via the shared chokidar watcher) the
// same SSE `ws-change` broadcast as a UI-driven edit. No tool bypasses that
// path or talks to the filesystem directly.
import { tool } from 'ai';
import { z } from 'zod';
import {
  AgentsFileSchema,
  AgentStatusSchema,
  SprintsFileSchema,
  SprintTaskStatusSchema,
} from '@agent-dashboard/shared';
import {
  Workspace,
  WorkspaceNotFoundError,
  WorkspacePathError,
  WorkspaceValidationError,
} from '../workspace.ts';

/** Renders a caught Workspace error (or anything else) as a small JSON-safe
 *  object the model can read and react to, instead of throwing and aborting
 *  the whole chat turn over one bad tool call. */
function toolError(err: unknown): { error: string; issues?: unknown } {
  if (err instanceof WorkspaceValidationError) return { error: err.message, issues: err.issues };
  if (err instanceof WorkspacePathError) return { error: err.message };
  if (err instanceof WorkspaceNotFoundError) return { error: err.message };
  return { error: err instanceof Error ? err.message : String(err) };
}

// No explicit return-type annotation: leaving it inferred keeps each tool's
// precise `ExecutableTool` type (with `execute` known non-optional), which
// tools.test.ts calls directly. It's still structurally assignable to AI
// SDK's `ToolSet` wherever streamText expects one (routes/chat.ts).
export function buildWorkspaceTools(workspace: Workspace) {
  return {
    read_workspace_file: tool({
      description:
        'Read a file from the workspace by its workspace-relative path (e.g. "agents.json", ' +
        '"docs/readme.md"). Returns the parsed JSON for .json files or raw text otherwise.',
      inputSchema: z.object({ path: z.string().min(1).describe('Workspace-relative file path') }),
      execute: async ({ path }) => {
        try {
          const result = await workspace.readFile(path);
          return { path, kind: result.kind, data: result.data };
        } catch (err) {
          return toolError(err);
        }
      },
    }),

    write_workspace_file: tool({
      description:
        'Write a file in the workspace by its workspace-relative path. For .json files (e.g. ' +
        '"sprints.json", "agents.json"), `content` must be the full JSON document matching that ' +
        "file's schema (a partial patch will fail validation) — read the file first if you need " +
        'to preserve existing fields. For non-JSON files (e.g. docs/*.md), `content` must be a ' +
        'string. Prefer update_sprint_task / update_agent_status for single-field edits to those ' +
        'two files.',
      inputSchema: z.object({
        path: z.string().min(1).describe('Workspace-relative file path'),
        content: z.any().describe('Full JSON document (object/array) for .json paths, or a string otherwise'),
      }),
      execute: async ({ path, content }) => {
        try {
          const rev = await workspace.writeFile(path, content);
          return { path, rev, ok: true };
        } catch (err) {
          return toolError(err);
        }
      },
    }),

    list_workspace: tool({
      description: 'List every file currently in the workspace, with path/size/mtime for each.',
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const tree = await workspace.listTree();
          return { tree };
        } catch (err) {
          return toolError(err);
        }
      },
    }),

    update_sprint_task: tool({
      description:
        'Update one task in the current sprint (sprints.json) by its task id: change its status ' +
        '(backlog/todo/doing/done) and/or notes. Reads, validates, and writes back sprints.json.',
      inputSchema: z.object({
        taskId: z.string().min(1),
        status: SprintTaskStatusSchema.optional(),
        notes: z.string().optional(),
      }),
      execute: async ({ taskId, status, notes }) => {
        try {
          const result = await workspace.readFile('sprints.json');
          const parsed = SprintsFileSchema.safeParse(result.data);
          if (!parsed.success)
            return { error: 'sprints.json failed schema validation', issues: parsed.error.issues };
          const task = parsed.data.tasks.find((t) => t.id === taskId);
          if (!task) return { error: `no task with id "${taskId}" in sprints.json` };
          if (status !== undefined) task.status = status;
          if (notes !== undefined) task.notes = notes;
          const rev = await workspace.writeFile('sprints.json', parsed.data);
          return { taskId, status: task.status, notes: task.notes, rev, ok: true };
        } catch (err) {
          return toolError(err);
        }
      },
    }),

    update_agent_status: tool({
      description:
        'Update one agent in the roster (agents.json) by its agent id: change its status ' +
        '(active/idle/blocked/offline) and/or current task. Reads, validates, and writes back ' +
        'agents.json, refreshing lastUpdated.',
      inputSchema: z.object({
        agentId: z.string().min(1),
        status: AgentStatusSchema.optional(),
        currentTask: z.string().optional(),
      }),
      execute: async ({ agentId, status, currentTask }) => {
        try {
          const result = await workspace.readFile('agents.json');
          const parsed = AgentsFileSchema.safeParse(result.data);
          if (!parsed.success)
            return { error: 'agents.json failed schema validation', issues: parsed.error.issues };
          const agent = parsed.data.agents.find((a) => a.id === agentId);
          if (!agent) return { error: `no agent with id "${agentId}" in agents.json` };
          if (status !== undefined) agent.status = status;
          if (currentTask !== undefined) agent.currentTask = currentTask;
          agent.lastUpdated = new Date().toISOString();
          const rev = await workspace.writeFile('agents.json', parsed.data);
          return { agentId, status: agent.status, currentTask: agent.currentTask, rev, ok: true };
        } catch (err) {
          return toolError(err);
        }
      },
    }),
  };
}
