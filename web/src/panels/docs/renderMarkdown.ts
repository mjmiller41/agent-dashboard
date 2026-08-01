// marked + DOMPurify (PLAN.md §2/§12 guardrail 4 — never render unvalidated
// HTML unsanitized). Both are already installed (Phase 4's Assistant panel);
// this is a small, deliberate duplication of assistant/ChatMessage.tsx's
// private renderMarkdown helper, not an import from it — panels must not
// import from each other (PLAN.md §12 guardrail 10), and the two call sites
// have different needs (breaks:true chat bubbles vs. a full doc render).
import DOMPurify from 'dompurify';
import { marked } from 'marked';

export function renderMarkdown(content: string): string {
  const raw = marked.parse(content, { async: false, breaks: true }) as string;
  return DOMPurify.sanitize(raw);
}
