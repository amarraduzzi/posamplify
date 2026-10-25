import type { ChosenMod } from './types';

/** Options as they are read on the till and the bon: a group with everything ticked is "Légumes : tout". */
export function modParts(mods: { name: string; group_id?: string; group_name?: string; all?: boolean }[] | undefined, word = 'tout'): string[] {
  const out: string[] = [];
  const done = new Set<string>();
  for (const m of mods ?? []) {
    if (m.all && m.group_name) {
      const k = m.group_id ?? m.group_name;
      if (done.has(k)) continue;
      done.add(k);
      out.push(`${m.group_name} : ${word}`);
    } else out.push(m.name);
  }
  return out;
}

export const modsLabel = (mods: ChosenMod[] | undefined) => modParts(mods).join(', ');
