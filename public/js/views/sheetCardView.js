import { computeCondition, SPELL_LEVELS } from '/shared/schema.js';
import { EVENTS } from '/shared/protocol.js';
import { socketClient } from '../socketClient.js';
import { rulesRepository } from '../rulesRepository.js';

export function buildHpBar(hp) {
  const track = document.createElement('div');
  track.className = 'hp-bar-track';
  const fill = document.createElement('div');
  const pct = hp.max > 0 ? Math.max(0, Math.min(100, (hp.current / hp.max) * 100)) : 0;
  fill.className = 'hp-bar-fill ' + computeCondition(hp);
  fill.style.width = pct + '%';
  track.appendChild(fill);
  return track;
}

/**
 * Renders one small bright-blue vertical rectangle per spell level that has
 * slots, stacked left-to-right directly under the HP bar. Each rectangle
 * fills bottom-up using the static maximum and persisted expended count,
 * with the spell level printed centered on top of it. Left-click spends a
 * slot (fill drops), right-click restores one (fill rises) — the same
 * click-to-spend / right-click-to-undo pattern used nowhere else yet, so a
 * tooltip spells it out.
 *
 * @param {Record<number, {maximum:number, expended:number}>} spellSlots
 * @param {((level: number, nextExpended: number) => void)|null} [onChange] Omit/pass null for a
 *   read-only display (e.g. another player's simplified stat block) — no click handlers attached.
 */
export function buildSpellSlotsRow(spellSlots, onChange) {
  if (!spellSlots) return null;
  const levels = SPELL_LEVELS.filter((level) => (spellSlots[level]?.maximum || 0) > 0);
  if (!levels.length) return null;

  const row = document.createElement('div');
  row.className = 'spell-slots-row';

  levels.forEach((level) => {
    const { maximum, expended } = spellSlots[level];
    const current = Math.max(0, maximum - expended);

    const column = document.createElement('div');
    column.className = 'spell-slot-column';

    const track = document.createElement('div');
    track.className = 'spell-slot-track' + (onChange ? '' : ' readonly');
    track.title = onChange
      ? `Level ${level} slots: ${current}/${maximum} — click to spend, right-click to restore`
      : `Level ${level} slots: ${current}/${maximum}`;

    const fill = document.createElement('div');
    fill.className = 'spell-slot-fill';
    fill.style.height = `${maximum > 0 ? (current / maximum) * 100 : 0}%`;
    track.appendChild(fill);

    const label = document.createElement('div');
    label.className = 'spell-slot-level-label';
    label.textContent = level;
    track.appendChild(label);

    if (onChange) {
      track.addEventListener('click', () => {
        if (current > 0) onChange(level, expended + 1);
      });
      track.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (current < maximum && expended > 0) onChange(level, expended - 1);
      });
    }

    column.appendChild(track);
    row.appendChild(column);
  });

  return row;
}


export function abilityMod(score) {
  const mod = Math.floor((score - 10) / 2);
  return mod >= 0 ? `+${mod}` : `${mod}`;
}

/** Derives a `{str: '+2', ...}`-shaped modifier map from raw ability scores. */
export function computeModifiers(scores) {
  if (!scores) return null;
  const mods = {};
  Object.entries(scores).forEach(([key, score]) => {
    mods[key] = abilityMod(score);
  });
  return mods;
}

export function buildAbilityScoreGrid(scores, modifiers) {
  if (!scores) return null;
  const grid = document.createElement('div');
  grid.className = 'char-sheet-abilities';
  Object.entries(scores).forEach(([key, score]) => {
    const pill = document.createElement('div');
    pill.className = 'ability-pill';
    const mod = modifiers && modifiers[key] ? `<span class="mod">${modifiers[key]}</span>` : '';
    pill.innerHTML = `${key.toUpperCase()}<span class="val">${score}</span>${mod}`;
    grid.appendChild(pill);
  });
  return grid;
}

// Wraps content in a <details>/<summary> so the browser handles expand/
// collapse for free — no click handlers to write or maintain. Returns null
// when there's nothing to show, so callers can skip appending empty
// sections rather than rendering a dropdown with nothing inside it.
export function buildDetailsSection(title, contentEl, { open = false, count = null } = {}) {
  if (!contentEl) return null;

  const details = document.createElement('details');
  details.className = 'monster-details';
  if (open) details.open = true;

  const summary = document.createElement('summary');
  summary.textContent = count !== null ? `${title} (${count})` : title;
  details.appendChild(summary);

  const body = document.createElement('div');
  body.className = 'monster-details-body';
  body.appendChild(contentEl);
  details.appendChild(body);

  return details;
}

function parseToHitModifier(toHit) {
  const m = /[+-]?\d+/.exec(toHit || '');
  return m ? parseInt(m[0], 10) : 0;
}

function parseDamageDice(damage) {
  const m = /(\d+)\s*d\s*(\d+)\s*([+-]\s*\d+)?/i.exec(damage || '');
  if (!m) return null;
  return {
    count: parseInt(m[1], 10),
    sides: parseInt(m[2], 10),
    modifier: m[3] ? parseInt(m[3].replace(/\s+/g, ''), 10) : 0,
  };
}

/** Rolls an attack's to-hit (d20 + modifier) and/or damage dice over the shared dice roller
 * pipeline, so results show up in everyone's dice log same as a manual roll. */
function rollAttack(attack) {
  if (attack.toHit) {
    socketClient.emitEvent(EVENTS.ROLL_DICE, { count: 1, sides: 20, modifier: parseToHitModifier(attack.toHit) });
  }
  if (attack.damage) {
    const dmg = parseDamageDice(attack.damage);
    if (dmg) socketClient.emitEvent(EVENTS.ROLL_DICE, { count: dmg.count, sides: dmg.sides, modifier: dmg.modifier });
  }
}

export function buildAttacksList(attacks) {
  if (!attacks?.length) return null;

  const list = document.createElement('div');
  list.className = 'monster-attacks-list';

  attacks.forEach((attack) => {
    const feature = attack.feature;
    const attackBonus = Number.isFinite(feature?.attackRoll?.bonus) ? feature.attackRoll.bonus : null;
    const damageParts = feature?.damage || [];
    const healingParts = feature?.healing || [];
    const rangeText = feature?.range ? `${feature.range.kind} ${feature.range.distance ?? ''}${feature.range.unit ? ` ${feature.range.unit}` : ''}`.trim() : null;
    const areaText = feature?.area ? `${feature.area.size} ${feature.area.unit} ${feature.area.shape}` : null;
    const saveText = feature?.save ? `${feature.save.ability || 'Unknown'} save` : null;
    const item = document.createElement('div');
    item.className = 'monster-attack';

    const nameRow = document.createElement('div');
    nameRow.className = 'monster-attack-name-row';
    const name = document.createElement('div');
    name.className = 'monster-attack-name';
    name.textContent = attack.name || 'Unnamed Attack';
    nameRow.appendChild(name);

    if (feature ? (attackBonus !== null || damageParts.length > 0) : (attack.toHit || attack.damage)) {
      const rollBtn = document.createElement('button');
      rollBtn.type = 'button';
      rollBtn.className = 'monster-attack-roll-btn';
      rollBtn.textContent = 'Roll';
      rollBtn.title = 'Roll to-hit and damage';
      rollBtn.addEventListener('click', () => feature ? rollFeature(feature) : rollAttack(attack));
      nameRow.appendChild(rollBtn);
    }

    item.appendChild(nameRow);

    const details = document.createElement('div');
    details.className = 'monster-attack-details';
    const properties = [];
    if (feature) {
      if (feature.attackRoll?.type) properties.push(`${feature.attackRoll.type} attack`);
      if (rangeText) properties.push(rangeText);
      if (areaText) properties.push(areaText);
      if (feature.target?.kind) properties.push(`Targets ${feature.target.kind}`);
      if (saveText) properties.push(saveText);
    } else {
      if (attack.attackType) properties.push(attack.attackType);
      if (attack.reach) properties.push(`Reach ${attack.reach}`);
      if (attack.targets) properties.push(`Targets ${attack.targets}`);
    }
    if (properties.length) {
      details.textContent = properties.join(' · ');
      item.appendChild(details);
    }

    if (feature ? attackBonus !== null : attack.toHit) {
      const roll = document.createElement('div');
      roll.className = 'monster-attack-roll';
      roll.textContent = `${attackBonus !== null ? `${attackBonus >= 0 ? '+' : ''}${attackBonus}` : attack.toHit} to hit`;
      item.appendChild(roll);
    }

    if (feature ? damageParts.length : attack.damage) {
      const damage = document.createElement('div');
      damage.className = 'monster-attack-damage';
      const damageText = feature
        ? damageParts.map(({ formula, damageType }) => `${formula}${damageType ? ` ${damageType}` : ''}`).join(' + ')
        : attack.damageType ? `${attack.damage} ${attack.damageType}` : attack.damage;
      damage.textContent = `Damage: ${damageText}`;
      item.appendChild(damage);
    }

    if (feature && healingParts.length) {
      const healing = document.createElement('div');
      healing.className = 'monster-attack-damage';
      healing.textContent = `Healing: ${healingParts.map(({ formula }) => formula).join(' + ')}`;
      item.appendChild(healing);
    }

    const description = feature?.description || attack.desc;
    if (description) {
      const desc = document.createElement('div');
      desc.className = 'monster-attack-details';
      desc.textContent = description;
      item.appendChild(desc);
    }

    if (attack.equipmentId) {
      rulesRepository.getCatalogRecord('equipment', attack.equipmentId).then((record) => {
        if (!record || !item.isConnected) return;
        const ruleDetails = document.createElement('div');
        ruleDetails.className = 'monster-attack-details local-weapon-details';
        ruleDetails.textContent = [
          record.subcategory,
          record.weaponType,
          record.damage?.raw && `Base damage: ${record.damage.raw}`,
          record.weaponProperties?.map((property) => `${property.name}${property.details ? ` (${property.details})` : ''}`).join(', '),
          record.mastery && `Mastery: ${record.mastery}`,
          record.weight?.raw && `Weight: ${record.weight.raw}`,
          record.cost?.raw && `Cost: ${record.cost.raw}`,
        ].filter(Boolean).join(' · ');
        item.appendChild(ruleDetails);
      }).catch(() => {});
    }

    list.appendChild(item);
  });

  return list;
}

// Traits, non-attack Actions, Bonus Actions, Reactions, and Legendary
// Actions are all the same { name, desc } shape in the underlying data —
// grouped into one section with a small tag per entry instead of five
// mostly-empty dropdowns. Character "Features" reuse the same renderer.
export function buildFeatureList(entries) {
  if (!entries?.length) return null;
  const wrap = document.createElement('div');
  entries.forEach((entry) => {
    const item = document.createElement('div');
    item.className = 'monster-feature';
    const tagHtml = entry.tag ? `<span class="monster-feature-tag">${entry.tag}</span>` : '';
    const nameLine = document.createElement('div');
    nameLine.innerHTML = `<span class="monster-feature-name">${entry.name}</span>${tagHtml}`;
    item.appendChild(nameLine);
    const description = entry.description || entry.desc;
    if (description) {
      const desc = document.createElement('div');
      desc.className = 'monster-feature-desc';
      desc.textContent = description;
      item.appendChild(desc);
    }
    const feature = entry.feature || entry;
    const mechanics = [
      feature.activation?.type && `Activation: ${feature.activation.type}`,
      feature.range && `Range: ${feature.range.kind}${feature.range.distance !== null ? ` ${feature.range.distance} ${feature.range.unit || ''}` : ''}`,
      feature.area && `Area: ${feature.area.size} ${feature.area.unit} ${feature.area.shape}`,
      feature.target?.kind && `Target: ${feature.target.kind}${feature.target.count ? ` (${feature.target.count})` : ''}`,
      feature.attackRoll?.type && `${feature.attackRoll.type} attack${Number.isFinite(feature.attackRoll.bonus) ? ` ${feature.attackRoll.bonus >= 0 ? '+' : ''}${feature.attackRoll.bonus}` : ''}`,
      feature.save?.ability && `${feature.save.ability.toUpperCase()} save${feature.save.dcFormula?.kind === 'fixed' ? ` DC ${feature.save.dcFormula.value}` : ''}`,
      feature.damage?.length && `Damage: ${feature.damage.map(({ formula, damageType }) => `${formula}${damageType ? ` ${damageType}` : ''}`).join(' + ')}`,
      feature.healing?.length && `Healing: ${feature.healing.map(({ formula }) => formula).join(' + ')}`,
      feature.conditionEffects?.length && `Conditions: ${feature.conditionEffects.map(({ condition }) => condition).join(', ')}`,
      feature.duration && `Duration: ${feature.duration.value ?? ''} ${feature.duration.unit}`,
      feature.concentration && 'Concentration',
      feature.uses && `Uses: ${typeof feature.uses.maximum === 'number' ? feature.uses.maximum : feature.uses.maximum.formula} per ${feature.uses.period}`,
    ].filter(Boolean);
    if (mechanics.length) {
      const mechanicsEl = document.createElement('div');
      mechanicsEl.className = 'monster-attack-details';
      mechanicsEl.textContent = mechanics.join(' · ');
      item.appendChild(mechanicsEl);
    }
    wrap.appendChild(item);
  });
  return wrap;
}

function rollFeature(feature) {
  const bonus = feature.attackRoll?.bonus;
  if (Number.isFinite(bonus)) socketClient.emitEvent(EVENTS.ROLL_DICE, { count: 1, sides: 20, modifier: bonus });
  for (const { formula } of feature.damage || []) {
    const dice = parseDamageDice(formula);
    if (dice) socketClient.emitEvent(EVENTS.ROLL_DICE, { count: dice.count, sides: dice.sides, modifier: dice.modifier });
  }
}

function titleCase(str) {
  return str.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1));
}

function buildSpellGroupList(groups) {
  if (!groups) return null;
  const entries = Object.entries(groups).filter(([, spells]) => spells && spells.length);
  if (!entries.length) return null;
  const wrap = document.createElement('div');
  entries.forEach(([label, spells]) => {
    const group = document.createElement('div');
    group.className = 'monster-spell-group';
    group.innerHTML = `<span class="monster-spell-group-label">${label}:</span> ${spells.map(titleCase).join(', ')}`;
    wrap.appendChild(group);
  });
  return wrap;
}

/** Monster-style spellcasting: ability + grouped-by-level/innate spell lists. */
export function buildSpellcastingContent(spellcasting) {
  if (!spellcasting) return null;
  const wrap = document.createElement('div');

  if (spellcasting.ability) {
    const ability = document.createElement('div');
    ability.className = 'monster-feature';
    ability.innerHTML = `<strong>Spellcasting Ability:</strong> ${spellcasting.ability}`;
    wrap.appendChild(ability);
  }

  const innate = buildSpellGroupList(spellcasting.innate);
  if (innate) wrap.appendChild(innate);

  const byLevel = buildSpellGroupList(spellcasting.spellsByLevel);
  if (byLevel) wrap.appendChild(byLevel);

  if (!innate && !byLevel && spellcasting.spellList && spellcasting.spellList.length) {
    const flat = document.createElement('div');
    flat.textContent = spellcasting.spellList.join(', ');
    wrap.appendChild(flat);
  }

  return wrap.childElementCount ? wrap : null;
}

/** Render local spell records with their full descriptions and available casting metadata. */
export function buildFlatSpellList(spells) {
  if (!spells?.length) return null;
  const wrap = document.createElement('div');
  spells.forEach((spell) => {
    const row = document.createElement('div');
    row.className = 'monster-spell-group';
    const title = document.createElement('div');
    title.className = 'monster-spell-group-label';
    title.textContent = spell.id || 'Unavailable local spell';
    row.appendChild(title);
    wrap.appendChild(row);
    if (!spell.id) return;
    rulesRepository.getCatalogRecord('spells', spell.id).then((record) => {
      if (!record) {
        title.textContent = `${spell.id} (record unavailable)`;
        return;
      }
      title.textContent = record.name;
      const level = document.createElement('div');
      level.className = 'monster-attack-details';
      level.textContent = [
        record.level === 0 ? 'Cantrip' : `Level ${record.level}`,
        record.school,
        record.feature.activation?.type && `Casting time: ${record.feature.activation.type}`,
        record.feature.range && `Range: ${record.feature.range.kind}${record.feature.range.distance !== null ? ` ${record.feature.range.distance} ${record.feature.range.unit || ''}` : ''}`,
        record.feature.duration && `Duration: ${record.feature.duration.value ?? ''} ${record.feature.duration.unit}${record.feature.concentration ? ' (Concentration)' : ''}`,
        record.ritual && 'Ritual',
        record.classes?.length && `Classes: ${record.classes.map((classEntry) => classEntry.name).join(', ')}`,
        record.components?.length && `Components: ${record.components.join(', ')}`,
        record.material && `Material: ${record.material}`,
      ].filter(Boolean).join(' · ');
      row.appendChild(level);

      const renderedFeature = buildFeatureList([record.feature]);
      if (renderedFeature) row.appendChild(renderedFeature);

      const sources = (record.sources || []).map((source) => source.publication || source.title).filter(Boolean);
      if (sources.length) {
        const sourceEl = document.createElement('div');
        sourceEl.className = 'monster-attack-details';
        sourceEl.textContent = `Source: ${[...new Set(sources)].join(', ')}`;
        row.appendChild(sourceEl);
      }
    }).catch(() => {
      title.textContent = `${spell.id} (could not load local spell record)`;
    });
  });
  return wrap;
}

export function buildLabelValueRow(label, value) {
  if (!value && value !== 0) return null;
  const row = document.createElement('div');
  row.innerHTML = `<strong>${label}:</strong> ${value}`;
  return row;
}

/** Builds a two-column grid of label/value rows, skipping any with no value. Returns null if none rendered. */
export function buildRowsGrid(rows) {
  const grid = document.createElement('div');
  grid.className = 'monster-statblock-grid';
  let any = false;
  rows.forEach(([label, value]) => {
    const row = buildLabelValueRow(label, value);
    if (row) {
      grid.appendChild(row);
      any = true;
    }
  });
  return any ? grid : null;
}

export function buildDescriptionContent(text, className = 'char-sheet-notes') {
  if (!text) return null;
  const p = document.createElement('p');
  p.className = className;
  p.textContent = text;
  return p;
}

/**
 * Assembles a full `.char-sheet-card` from a normalized model:
 * @param {{
 *   badge?: string, name: string, meta?: string, stats?: [string, string|number][],
 *   hp: {current:number,max:number}, topAbilitiesEl?: Element, notes?: string,
 *   quickEditEl?: Element, editButtonEl?: Element,
 *   sections?: Array<{title: string, contentEl: Element|null, open?: boolean, count?: number|null}>
 * }} model
 */
export function buildSheetCard(model) {
  const card = document.createElement('div');
  card.className = 'char-sheet-card';

  const nameEl = document.createElement('div');
  nameEl.className = 'char-sheet-name';
  nameEl.textContent = model.badge ? `${model.badge} ${model.name}`.trim() : model.name;
  card.appendChild(nameEl);

  if (model.meta) {
    const metaEl = document.createElement('div');
    metaEl.className = 'char-sheet-meta';
    metaEl.textContent = model.meta;
    card.appendChild(metaEl);
  }

  if (model.stats?.length) {
    const statsEl = document.createElement('div');
    statsEl.className = 'char-sheet-stats';
    statsEl.innerHTML = model.stats.map(([label, value]) => `<div>${label} <strong>${value}</strong></div>`).join('');
    card.appendChild(statsEl);
  }

  card.appendChild(buildHpBar(model.hp));

  if (model.spellSlotsEl) card.appendChild(model.spellSlotsEl);

  if (model.topAbilitiesEl) card.appendChild(model.topAbilitiesEl);

  if (model.notes) {
    const notes = document.createElement('div');
    notes.className = 'char-sheet-notes';
    notes.textContent = model.notes;
    card.appendChild(notes);
  }

  if (model.quickEditEl) card.appendChild(model.quickEditEl);
  if (model.editButtonEl) card.appendChild(model.editButtonEl);

  (model.sections || []).forEach(({ title, contentEl, open, count }) => {
    const section = buildDetailsSection(title, contentEl, { open, count: count ?? null });
    if (section) card.appendChild(section);
  });

  return card;
}
