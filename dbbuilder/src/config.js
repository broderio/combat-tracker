import fs from 'node:fs';

export function loadConfig(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export const classTitle = (config, name) => config.classes.titles?.[name] ?? config.classes.titleTemplate.replace('{name}', name);

/**
 * Which pages hold a class's subclasses? Explicit list in config wins; otherwise any link on the
 * class page whose title matches subclasses.linkPattern ({class} is replaced by the class name).
 */
export function resolveSubclassTitles(config, className, pageLinks) {
  const explicit = config.subclasses?.pages?.[className];
  if (explicit) return explicit;
  const pattern = config.subclasses?.linkPattern;
  if (!pattern) return [];
  const re = new RegExp(pattern.replace('{class}', className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'i');
  return pageLinks.filter((t) => re.test(t));
}
