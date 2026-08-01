// Tiny hand-rolled YAML-frontmatter parser (PLAN.md §12 guardrail 6: a new YAML-parsing
// dependency isn't warranted for this small, bounded format). Extracts only the fields the
// skill scanner needs (`name`/`description`) from a `---\nkey: value\n...\n---` block at the
// top of a SKILL.md file — not a general YAML parser (lists, nested maps, anchors, etc. are
// intentionally out of scope; every real SKILL.md on this machine only needs scalar/folded
// string values for these two keys).
export interface SkillFrontmatter {
  name?: string;
  description?: string;
}

const RELEVANT_KEYS = new Set(['name', 'description']);

export function parseSkillFrontmatter(raw: string): SkillFrontmatter {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
  const result: SkillFrontmatter = {};
  if (!match) return result;

  let currentKey: string | null = null;
  let currentLines: string[] = [];
  let folded = false; // '>' (folded, space-joined) vs '|' (literal, newline-joined)

  function flush(): void {
    if (currentKey && RELEVANT_KEYS.has(currentKey)) {
      const value = stripQuotes(currentLines.join(folded ? ' ' : '\n').trim());
      if (value) (result as Record<string, string>)[currentKey] = value;
    }
    currentKey = null;
    currentLines = [];
    folded = false;
  }

  const body = match[1] ?? '';
  for (const line of body.split(/\r?\n/)) {
    const topLevel = /^([A-Za-z0-9_-]+):[ \t]*(.*)$/.exec(line);
    if (topLevel && !/^\s/.test(line)) {
      flush();
      currentKey = topLevel[1] ?? null;
      const rest = (topLevel[2] ?? '').trim();
      if (rest === '>-' || rest === '>' || rest === '|-' || rest === '|') {
        folded = rest.startsWith('>');
        currentLines = [];
      } else {
        currentLines = [rest];
      }
      continue;
    }
    if (currentKey && /^\s+/.test(line)) {
      currentLines.push(line.trim());
    } else if (currentKey && line.trim() === '') {
      currentLines.push('');
    }
  }
  flush();

  return result;
}

function stripQuotes(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}
