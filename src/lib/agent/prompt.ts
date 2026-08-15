/**
 * SystemPrompt — composable prompt assembly.
 *
 * Four scoped registrars combine per step:
 *   - section({name, order, text | (ctx)=>text, complete?})  — static persona/guidance
 *   - context({name, order, text | (ctx)=>text})              — dynamic runtime context
 *   - tools(provider: (ctx) => ToolSchema[])                   — tool schemas
 *   - variable(name, provider: (ctx) => string | undefined)   — {{var}} interpolation
 *
 * assemble({scope, signal}) merges global + scoped layers, sorts by order,
 * interpolates variables strictly, and returns a rendered system string plus
 * the tool schemas.
 */

import type { ToolSchema } from './llm/types';
import type { Json } from './types';

export interface AssembledSection {
  name: string;
  order: number;
  text: string;
}

export interface PromptAssembly {
  sections: AssembledSection[];
  tools: ToolSchema[];
  variables: Record<string, string | undefined>;
}

export interface PromptContext {
  scope?: string;
  signal?: AbortSignal;
  /** Free-form bag plugins can read when rendering sections/variables. */
  [key: string]: unknown;
}

type TextProvider = string | ((ctx: PromptContext) => string | undefined);

interface SectionRegistration {
  name: string;
  order: number;
  text: TextProvider;
  complete?: boolean;
}

interface ContextRegistration {
  name: string;
  order: number;
  text: TextProvider;
}

interface ToolsRegistration {
  provider: (ctx: PromptContext) => ToolSchema[];
}

interface VariableRegistration {
  name: string;
  provider: (ctx: PromptContext) => string | undefined;
}

export class SystemPrompt {
  private sections: SectionRegistration[] = [];
  private contexts: ContextRegistration[] = [];
  private toolsReg: ToolsRegistration[] = [];
  private variables: VariableRegistration[] = [];
  private suppressedRuntimeContext = false;

  section(reg: Omit<SectionRegistration, never>): () => void {
    this.sections.push(reg);
    return () => {
      const i = this.sections.indexOf(reg);
      if (i >= 0) this.sections.splice(i, 1);
    };
  }

  context(reg: Omit<ContextRegistration, never>): () => void {
    this.contexts.push(reg);
    return () => {
      const i = this.contexts.indexOf(reg);
      if (i >= 0) this.contexts.splice(i, 1);
    };
  }

  tools(provider: (ctx: PromptContext) => ToolSchema[]): () => void {
    const reg: ToolsRegistration = { provider };
    this.toolsReg.push(reg);
    return () => {
      const i = this.toolsReg.indexOf(reg);
      if (i >= 0) this.toolsReg.splice(i, 1);
    };
  }

  variable(name: string, provider: (ctx: PromptContext) => string | undefined): () => void {
    const reg: VariableRegistration = { name, provider };
    this.variables.push(reg);
    return () => {
      const i = this.variables.indexOf(reg);
      if (i >= 0) this.variables.splice(i, 1);
    };
  }

  suppressRuntimeContext(): void {
    this.suppressedRuntimeContext = true;
  }

  assemble(ctx: PromptContext): PromptAssembly {
    // Sections (sorted by order, dedup by name — last wins).
    const sectionsByName = new Map<string, SectionRegistration>();
    for (const s of [...this.sections].sort((a, b) => a.order - b.order)) {
      sectionsByName.set(s.name, s);
    }
    const sections: AssembledSection[] = [];
    for (const s of [...sectionsByName.values()].sort((a, b) => a.order - b.order)) {
      const text = typeof s.text === 'string' ? s.text : s.text(ctx);
      if (text && text.trim()) sections.push({ name: s.name, order: s.order, text: text.trim() });
    }

    // Tools.
    const toolSet = new Map<string, ToolSchema>();
    for (const reg of this.toolsReg) {
      for (const t of reg.provider(ctx)) toolSet.set(t.name, t);
    }
    const tools = [...toolSet.values()].sort((a, b) => a.name.localeCompare(b.name));

    // Variables.
    const variables: Record<string, string | undefined> = {};
    for (const v of this.variables) {
      variables[v.name] = v.provider(ctx);
    }

    return { sections, tools, variables };
  }

  /** Render a PromptAssembly into a final system string. */
  renderPrompt(assembly: PromptAssembly): string {
    const parts: string[] = [];
    for (const s of assembly.sections) {
      let text = s.text;
      // Strict {{var}} interpolation.
      text = text.replace(/\{\{(\w+)\}\}/g, (full, name: string) => {
        const val = assembly.variables[name];
        if (val === undefined || val === null || val === '') {
          // Leave unknown variables as-is rather than throwing (lenient).
          return full;
        }
        return val;
      });
      parts.push(text);
    }
    return parts.join('\n\n');
  }
}

export type { Json };
