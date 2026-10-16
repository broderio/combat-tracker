import { slug } from './util.js';

/** Add a common contract without removing legacy fields consumed by existing clients. */
export function normalizeChoice(choice, { recordId, recordKind, classId = null, source = null } = {}) {
  const count = choice.selection?.count ?? null;
  const countRule = choice.selection?.countRule ?? null;
  const hasResolver = Boolean(choice.optionSource);
  const hasInlineOptions = (choice.options?.length ?? 0) > 0;
  const resolution = choice.resolution ?? (hasInlineOptions && count !== null && count <= choice.options.length && !choice.changeRule ? 'structured'
    : hasResolver || hasInlineOptions ? 'partial' : 'manual');
  return {
    ...choice,
    featureId: choice.featureId ?? `${recordId}-${choice.level}-${slug(choice.feature)}`,
    levelContext: choice.levelContext ?? { type: recordKind, recordId, classId },
    selection: {
      count, countRule,
      min: choice.selection?.min ?? (count !== null ? count : null),
      max: choice.selection?.max ?? (count !== null ? count : null),
      distinct: choice.selection?.distinct ?? (hasInlineOptions ? true : null),
    },
    dependsOn: choice.dependsOn == null ? [] : Array.isArray(choice.dependsOn) ? choice.dependsOn : [choice.dependsOn],
    prerequisites: choice.prerequisites ?? [],
    replacement: choice.replacement ?? {
      allowed: choice.changeRule && /\breplac(?:e|ement)\b/i.test(choice.changeRule) ? true : null,
      timing: null,
      maxReplacements: null,
    },
    effects: choice.effects ?? [],
    resolution,
    ...(resolution === 'structured' ? {} : {
      unresolvedReason: choice.unresolvedReason ?? 'The source prose or legacy extractor does not fully encode all eligibility, dependency, or replacement rules.',
    }),
    options: (choice.options ?? []).map((option) => ({
      ...option,
      ...(source && !option.sources ? { sources: [source] } : {}),
    })),
    sources: choice.sources ?? (source ? [source] : []),
  };
}

export function manualChoice({ recordId, recordKind, classId = null, level = 1, feature, prompt, source, idSuffix = 'manual', scope = 'progression' }) {
  const featureId = `${recordId}-${level}-${slug(feature)}`;
  return normalizeChoice({
    id: `${featureId}-${idSuffix}`, featureId, level, feature, prompt, scope,
    selection: { count: null, countRule: null, min: null, max: null, distinct: null },
    options: [], optionSource: null, changeRule: null,
    resolution: 'manual', unresolvedReason: 'Choice-like rule text is present, but options and/or selection conditions are not safely normalized.',
  }, { recordId, recordKind, classId, source });
}

export const hasChoiceLanguage = (text) => /\b(?:choose|choice|select|selection|options? of your choice|may replace|can replace|increase one ability score|ability score of your choice|one ability score of your choice|increase\b.{0,120}\bscore\b)\b/i.test(String(text ?? ''));
