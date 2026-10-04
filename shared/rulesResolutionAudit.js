import {
  getManualRecordChoiceAdapters,
  resolveChoiceOptions,
  resolveChoiceSelectionCount,
} from './characterBuilder.js';

const CHOICE_LANGUAGE = /\b(?:choose|choice|choices|select|selected|of your choice|replace one|whenever you gain .* can replace)\b/i;
const INPUT_COUNT_RULE = /^max\(1,\s*abilityModifier\((str|dex|con|int|wis|cha)\)\s*\+\s*classLevel\(([a-z0-9-]+)\)\)$/i;

function normalized(value) {
  return String(value || '').trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function sourceName(source) {
  return source?.publication || source?.title || source?.id || '';
}

function stableAuditId({ recordType, recordId, choiceId, sourceField, issueCode }) {
  return [recordType || 'record', recordId || 'unknown', choiceId || sourceField || 'record', issueCode]
    .map((value) => String(value).replace(/[^a-zA-Z0-9._:-]+/g, '-'))
    .join(':');
}

function matchingChoices(record, featureName, level) {
  const needle = normalized(featureName);
  return (Array.isArray(record?.choices) ? record.choices : []).filter((choice) => {
    if (Number(choice.level) !== Number(level)) return false;
    if (normalized(choice.feature) === needle) return true;
    const featureId = normalized(choice.featureId);
    return featureId && (featureId === needle || featureId.endsWith(` ${needle}`));
  });
}

function addIssue(items, base, issue) {
  const auditId = stableAuditId({ ...base, issueCode: issue.code });
  if (items.some((item) => item.auditId === auditId)) return;
  items.push({
    auditId,
    recordType: base.recordType || 'record',
    recordId: base.recordId || null,
    recordName: base.recordName || base.recordId || 'Unknown record',
    recordPath: base.recordPath || null,
    choiceId: base.choiceId || null,
    sourceField: base.sourceField || null,
    feature: base.feature || null,
    level: base.level ?? null,
    levelContext: base.levelContext || null,
    scope: base.scope || null,
    prompt: base.prompt || null,
    optionSource: base.optionSource || null,
    optionCount: base.optionCount ?? null,
    options: Array.isArray(base.options) ? base.options : [],
    fullText: base.fullText || '',
    sources: Array.isArray(base.sources) ? base.sources : [],
    relatedChoiceIds: Array.isArray(base.relatedChoiceIds) ? base.relatedChoiceIds : [],
    issueCode: issue.code,
    severity: issue.severity || 'needs-generator-review',
    reason: issue.reason,
  });
}

function associatedFeatureText(record, choice) {
  const level = Number(choice?.level);
  const featureName = normalized(choice?.feature);
  if (!Number.isInteger(level) || !featureName) return '';
  const features = Array.isArray(record?.featuresByLevel?.[String(level)]) ? record.featuresByLevel[String(level)] : [];
  return features.filter((feature) => normalized(feature?.name) === featureName)
    .map((feature) => feature.description || '')
    .filter(Boolean)
    .join('\n\n');
}

function choiceAuditBase(recordEntry, record, choice, featureText = '') {
  const feature = String(choice?.feature || '');
  const equipmentText = /starting equipment/i.test(feature)
    ? record?.startingEquipment?.raw || record?.equipment?.raw || ''
    : '';
  return {
    recordType: recordEntry.recordType || record?.kind || 'record',
    recordId: record?.id || recordEntry.recordId || null,
    recordName: record?.name || recordEntry.recordName || record?.id || 'Unknown record',
    recordPath: recordEntry.path || recordEntry.recordPath || null,
    choiceId: choice?.id || null,
    feature: choice?.feature || null,
    level: choice?.level ?? null,
    levelContext: choice?.levelContext || 'class-level',
    scope: choice?.scope || 'unspecified',
    prompt: choice?.prompt || null,
    optionSource: choice?.optionSource || null,
    optionCount: Array.isArray(choice?.options) ? choice.options.length : null,
    options: Array.isArray(choice?.options) ? choice.options : [],
    fullText: featureText || associatedFeatureText(record, choice) || equipmentText || choice?.description || choice?.unresolvedReason || '',
    sources: choice?.sources?.length ? choice.sources : record?.sources || [],
  };
}

function addProseChoiceIssue(items, recordEntry, record, {
  sourceField,
  feature,
  level = null,
  text,
  relatedChoices = [],
}) {
  addIssue(items, {
    recordType: recordEntry.recordType || record?.kind || 'record',
    recordId: record?.id || recordEntry.recordId || null,
    recordName: record?.name || recordEntry.recordName || record?.id || 'Unknown record',
    recordPath: recordEntry.path || recordEntry.recordPath || null,
    sourceField,
    feature: feature || null,
    level,
    levelContext: 'source-prose',
    fullText: text,
    sources: record?.sources || [],
    relatedChoiceIds: relatedChoices.map((choice) => choice.id).filter(Boolean),
  }, {
    code: 'possible-prose-choice',
    severity: 'verify-source-coverage',
    reason: relatedChoices.length
      ? `Choice-like text remains in this source feature. Verify that all options, counts, timing, and prerequisites are covered by these generated choice records: ${relatedChoices.map((choice) => choice.id).filter(Boolean).join(', ')}.`
      : 'Choice-like source text has no matching generated choice record. The UI must show this prose for manual review; the generator should parse or explicitly mark it unresolved.',
  });
}

/**
 * Produce a deterministic inventory of generated character rules that the builder
 * cannot fully resolve, plus heuristic prose candidates for generator review.
 * The heuristic findings are explicitly marked as candidates, not asserted rules.
 */
export function createRulesResolutionAudit(records, {
  catalogs = {},
  edition = null,
  databaseSchemaVersion = null,
  failures = [],
} = {}) {
  const items = [];
  for (const failure of failures) {
    addIssue(items, {
      recordType: failure.recordType || 'record',
      recordId: failure.recordId,
      recordName: failure.recordName,
      recordPath: failure.path,
      sourceField: 'record-detail',
      sources: [],
    }, {
      code: 'record-detail-unavailable',
      reason: failure.error || 'The manifest/catalog lists this record, but the detail record could not be loaded.',
    });
  }

  for (const recordEntry of Array.isArray(records) ? records : []) {
    const record = recordEntry?.record;
    if (!record || typeof record !== 'object') continue;
    const recordType = recordEntry.recordType || record.kind || 'record';
    const classRecord = recordEntry.classRecord || (recordType === 'class' ? record : null);
    const classId = classRecord?.id || record.classId || record.id || null;
    const choices = Array.isArray(record.choices) ? record.choices : [];

    if (!record.id) {
      addIssue(items, {
        recordType,
        recordId: recordEntry.recordId || null,
        recordName: record.name || recordEntry.recordName || recordEntry.recordId || 'Unknown record',
        recordPath: recordEntry.path || recordEntry.recordPath || null,
        sourceField: 'id',
        sources: record.sources || [],
      }, {
        code: 'missing-stable-record-id',
        reason: 'The detail record has no stable local ID. Any generated child choice IDs and persisted references need generator review.',
      });
    }

    choices.forEach((choice) => {
      if (!choice) return;
      const base = choiceAuditBase(recordEntry, record, choice);
      if (choice.scope === 'runtime') {
        addIssue(items, base, {
          code: 'runtime-choice-review',
          severity: 'verify-source-coverage',
          reason: 'This choice is marked runtime/in-play rather than character creation or progression; verify whether it belongs in generator coverage or should remain outside the character builder.',
        });
        return;
      }
      if (!choice.id) {
        addIssue(items, base, {
          code: 'missing-stable-choice-id',
          reason: 'This rule choice has no stable local choice ID, so its selection cannot be safely persisted or targeted by the generator.',
        });
      }

      const resolution = resolveChoiceOptions(choice, {
        catalogs,
        classId,
        classLevel: choice.level,
        classRecord,
        spellcastingRecord: record.spellcasting ? record : classRecord,
        characterLevel: null,
        buildSelections: [],
      });
      if (['manual', 'unsupported', 'unavailable'].includes(resolution.state)) {
        const code = resolution.state === 'unsupported'
          ? 'unsupported-option-resolver'
          : resolution.state === 'unavailable'
            ? /catalog is not available/i.test(resolution.reason || '')
              ? 'catalog-unavailable'
              : /needs a selected class context|needs the matching selected class record/i.test(resolution.reason || '')
                ? 'resolver-context-unavailable'
                : choice.optionSource?.type === 'character-spellbook' && !choice.optionSource.castingTime
                  ? null
                  : 'resolver-empty'
            : 'manual-or-partial-choice';
        if (code) addIssue(items, { ...base, optionCount: resolution.items?.length ?? base.optionCount }, {
          code,
          reason: resolution.reason || 'The builder cannot fully resolve the generated choice.',
        });
      }

      if (choice.optionSource?.type === 'feat-list' && choice.optionSource.eligibility === 'character-and-rule-prerequisites') {
        addIssue(items, base, {
          code: 'incomplete-prerequisite-validation',
          severity: 'verify-source-coverage',
          reason: 'Only explicit minimum-level fields can be filtered. The remaining feat prerequisites and qualification rules are not validated by the builder.',
        });
      }
      if (choice.optionSource?.type === 'spell-list'
          && choice.optionSource.spellKind === 'spell'
          && choice.optionSource.spellLevel === undefined
          && choice.optionSource.eligibility !== 'spell-level-unlocked-at-class-level') {
        addIssue(items, base, {
          code: 'spell-level-eligibility-not-explicit',
          severity: 'verify-source-coverage',
          reason: 'The builder can cap candidates using the local class-level slot table, but the generated choice does not explicitly encode spell-level eligibility or any extra spell restrictions.',
        });
      }
      const eligibility = choice.optionSource?.eligibility;
      const supportedEligibility = !eligibility
        || eligibility === 'character-and-rule-prerequisites'
        || eligibility === 'fighting-style'
        || eligibility === 'spell-level-unlocked-at-class-level';
      if (eligibility && !supportedEligibility) {
        addIssue(items, base, {
          code: 'unsupported-option-eligibility',
          reason: `Option eligibility “${eligibility}” is not fully interpreted by the builder.`,
        });
      }

      const countRule = choice.selection?.countRule;
      if (countRule) {
        const dynamicInputCount = INPUT_COUNT_RULE.test(countRule);
        const directCount = resolveChoiceSelectionCount(choice, {
          classRecord,
          progressionRecord: record,
          classLevel: choice.level,
          classId,
          abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
        });
        const countCoveredByRecord = !directCount.resolved && /^(progression\.(cantripsKnownByLevel|preparedSpellsByLevel)|progression\.values\.weapon-mastery\.value)$/.test(countRule)
          && record.progression?.[String(choice.level)];
        if (!directCount.resolved && !dynamicInputCount && !countCoveredByRecord) {
          addIssue(items, base, {
            code: 'unsupported-selection-count',
            reason: directCount.reason || `Selection count rule “${countRule}” is not supported by the builder.`,
          });
        }
      } else if (!choice.selection || choice.selection.count === null) {
        addIssue(items, base, {
          code: 'missing-selection-count',
          reason: choice.selection
            ? 'The choice record has no count or count rule. The builder cannot know how many options to validate.'
            : 'The choice record has no selection-count contract. The builder cannot know whether or how many options should be selected.',
        });
      }
      const equipmentSource = /starting equipment/i.test(choice.feature || '')
        ? record.startingEquipment || record.equipment
        : null;
      if (equipmentSource?.raw && choice.options?.length
          && choice.options.some((option) => !option?.description && !option?.raw)) {
        addIssue(items, { ...base, fullText: equipmentSource.raw }, {
          code: 'option-details-unparsed',
          severity: 'needs-generator-review',
          reason: 'The choice has selectable option IDs, but the option records do not include their associated equipment-package details. The parent record has only raw package text.',
        });
      }
    });

    const adapters = getManualRecordChoiceAdapters(record);
    adapters.forEach((choice) => {
      addIssue(items, choiceAuditBase(recordEntry, record, choice), {
        code: 'manual-adapter-choice',
        reason: choice.unresolvedReason || 'This choice is adapted from prose/partial fields and is not validated by the local data contract.',
      });
    });

    if (['feat', 'feats'].includes(recordType)
        && (record.prerequisites || (Array.isArray(record.abilityScorePrerequisites) && record.abilityScorePrerequisites.length))) {
      addIssue(items, {
        recordType,
        recordId: record.id,
        recordName: record.name,
        recordPath: recordEntry.path || recordEntry.recordPath || null,
        sourceField: 'prerequisites',
        feature: record.name,
        fullText: typeof record.prerequisites === 'string' ? record.prerequisites : '',
        sources: record.sources || [],
      }, {
        code: 'feat-prerequisite-validation-incomplete',
        severity: 'verify-source-coverage',
        reason: 'Feat prerequisites are presented from local source data but are not fully checked for eligibility by the builder. Confirm structured ability/level fields and preserve any remaining prerequisite prose.',
      });
    }

    for (const [level, featureList] of Object.entries(record.featuresByLevel || {})) {
      (Array.isArray(featureList) ? featureList : []).forEach((feature, index) => {
        if (!CHOICE_LANGUAGE.test(feature?.description || '')) return;
        const related = matchingChoices(record, feature.name, Number(level));
        addProseChoiceIssue(items, recordEntry, record, {
          sourceField: `featuresByLevel.${level}.${index}`,
          feature: feature.name,
          level: Number(level),
          text: feature.description || '',
          relatedChoices: related,
        });
      });
    }

    (Array.isArray(record.traits) ? record.traits : []).forEach((trait, index) => {
      if (!CHOICE_LANGUAGE.test(trait?.description || '')) return;
      const hasAdapter = adapters.some((choice) => choice.id === `adapter:${record.id}:trait:${trait.id}`);
      if (hasAdapter) return;
      const related = matchingChoices(record, trait.name, null);
      addProseChoiceIssue(items, recordEntry, record, {
        sourceField: `traits.${index}`,
        feature: trait.name || trait.id,
        text: trait.description || '',
        relatedChoices: related,
      });
    });

    if (['feat', 'feats', 'equipment', 'spell', 'spells'].includes(recordType) && CHOICE_LANGUAGE.test(record.description || '')) {
      addProseChoiceIssue(items, recordEntry, record, {
        sourceField: 'description',
        feature: record.name,
        text: record.description || '',
        relatedChoices: choices,
      });
    }
    (Array.isArray(record.benefits) ? record.benefits : []).forEach((benefit, index) => {
      const text = typeof benefit === 'string' ? benefit : benefit?.description || '';
      if (!CHOICE_LANGUAGE.test(text)) return;
      addProseChoiceIssue(items, recordEntry, record, {
        sourceField: `benefits.${index}`,
        feature: typeof benefit === 'string' ? record.name : benefit.name || record.name,
        text,
        relatedChoices: choices,
      });
    });
  }

  items.sort((left, right) =>
    String(left.recordType).localeCompare(String(right.recordType))
    || String(left.recordName).localeCompare(String(right.recordName))
    || Number(left.level || 0) - Number(right.level || 0)
    || String(left.sourceField || left.choiceId || '').localeCompare(String(right.sourceField || right.choiceId || ''))
    || left.issueCode.localeCompare(right.issueCode)
  );
  const issuesByCode = {};
  items.forEach((item) => { issuesByCode[item.issueCode] = (issuesByCode[item.issueCode] || 0) + 1; });
  return {
    format: 'dnd-tracker-rules-resolution-audit',
    formatVersion: 1,
    edition,
    databaseSchemaVersion,
    generatedAt: new Date().toISOString(),
    scope: ['classes', 'subclasses', 'species', 'backgrounds', 'feats', 'spells', 'equipment'],
    summary: { itemCount: items.length, issuesByCode },
    items,
  };
}
