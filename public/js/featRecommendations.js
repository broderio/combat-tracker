const CATEGORY_BY_FEATURE = [
  { match: /fighting style/i, category: 'Fighting Style Feats' },
  { match: /epic boon/i, category: 'Epic Boon Feats' },
  { match: /ability score improvement/i, category: 'General Feats' },
];

function categoryForChoice(choice) {
  return CATEGORY_BY_FEATURE.find(({ match }) => match.test(choice.feature || ''))?.category || null;
}

function levelEligible(feat, characterLevel) {
  if (Number.isInteger(feat.minimumCharacterLevel) && feat.minimumCharacterLevel > characterLevel) return false;
  const levelPrerequisite = /level\s+(\d+)\+/i.exec(feat.prerequisites || '');
  return !levelPrerequisite || Number(levelPrerequisite[1]) <= characterLevel;
}

/** Build suggestion groups only from explicit feat-list choices in local class/subclass records. */
export function buildFeatRecommendationGroups({ classRecord, subclassRecord, feats = [], characterLevel = 1 }) {
  const level = Math.max(1, Math.min(20, Number.parseInt(characterLevel, 10) || 1));
  const featById = new Map(feats.map((feat) => [feat.id, feat]));
  const records = [classRecord, subclassRecord].filter(Boolean);
  const choices = records.flatMap((record) =>
    (record.choices || [])
      .filter((choice) => choice.optionSource?.type === 'feat-list' && Number(choice.level) <= level)
      .map((choice) => ({ choice, record }))
  );

  return choices.map(({ choice, record }) => {
    const category = categoryForChoice(choice);
    let candidates;
    if (choice.options?.length) {
      candidates = choice.options
        .map((option) => featById.get(option.id) || feats.find((feat) => feat.name === option.label))
        .filter(Boolean);
    } else {
      candidates = feats.filter((feat) => (!category || feat.category === category) && levelEligible(feat, level));
    }
    return {
      id: `${record.id}:${choice.id}`,
      level: Number(choice.level) || 1,
      feature: choice.feature || 'Feat choice',
      category,
      feats: [...new Map(candidates.map((feat) => [feat.id, feat])).values()]
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, 10),
    };
  });
}
