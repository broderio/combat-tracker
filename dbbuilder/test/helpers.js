// Synthetic fixtures: placeholder text only, shaped like Wikidot-rendered 2024 class pages.
const bonus = (l) => 2 + Math.floor((l - 1) / 4);
const rng = (n) => Array.from({ length: n }, (_, i) => i + 1);
const row = (cells) => `<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`;

export function coreTraits(o) {
  const r = ([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`;
  return `<table class="wikitable"><tr><th colspan="2">Core ${o.name} Traits</th></tr>${[
    ['Primary Ability', o.primary], ['Hit Point Die', o.hitDie], ['Saving Throw Proficiencies', o.saves],
    ['Skill Proficiencies', o.skills], ['Weapon Proficiencies', o.weapons], ['Armor Training', o.armor],
    ['Starting Equipment', o.equipment],
  ].map(r).join('')}</table>`;
}

const featureNames = (l) => (l === 1 ? ['Fighting Style', 'Second Wind'] : l === 2 ? ['Action Surge'] : [`Feature ${l}`]);

export function fighterPage({ omit = [] } = {}) {
  const features = rng(20).map((l) => `${featureNames(l).join(', ')}`);
  const table = `<table class="wikitable"><tr><th>Level</th><th>Proficiency Bonus</th><th>Class Features</th><th>Weapon Mastery</th></tr>${
    rng(20).map((l) => row([l, `+${bonus(l)}`, features[l - 1], l < 4 ? 2 : 3])).join('')}</table>`;
  const sections = rng(20).flatMap((l) => featureNames(l).map((n) => (n === 'Action Surge'
    ? `<h3><span class="mw-headline">${n}</span></h3><p>Placeholder text for ${n}.</p>`
    : `<h3><span class="mw-headline">Level ${l}: ${n}</span></h3><p>Placeholder text for ${n}.</p><ul><li>Option one</li><li>Option two</li></ul>`))).join('');
  const core = coreTraits({
    name: 'Fighter', primary: 'Strength or Dexterity', hitDie: 'D10 per Fighter level', saves: 'Strength and Constitution',
    skills: 'Choose 2: Acrobatics, Athletics, History, Insight, or Survival', weapons: 'Simple and Martial weapons',
    armor: 'Light, Medium, and Heavy armor and Shields',
    equipment: 'Choose A or B: (A) Chain Mail, Greatsword, 8 Javelins, Dungeoneer\'s Pack (Backpack, Rope), and 4 GP; or (B) 155 GP',
  });
  return `<div class="mw-parser-output">
    <p>Intro text about the Fighter.</p>${omit.includes('core') ? '' : core}
    <h2><span class="mw-headline">Fighter Features</span></h2>${table}${sections}
    <h2><span class="mw-headline">Fighter Subclasses</span></h2>
    <h3><span class="mw-headline">Champion</span></h3><p>Placeholder champion intro.</p>
      <h4>Level 3: Improved Critical</h4><p>Placeholder.</p><h4>Level 7: Remarkable Athlete</h4><p>Placeholder.</p>
    <h3><span class="mw-headline">Battle Master</span></h3><p>Placeholder.</p><h4>Level 3: Combat Superiority</h4><p>Placeholder.</p>
    <h2><span class="mw-headline">Multiclassing</span></h2><p>Ability Score Minimum: Strength 13 or Dexterity 13</p>
  </div>`;
}

/** full: 2 header rows with colspan/rowspan; pact: Warlock-style columns */
export function casterPage(kind = 'full') {
  const slotCount = (l, s) => (s <= Math.min(9, Math.ceil(l / 2)) ? 2 : '—');
  const head = kind === 'full'
    ? `<tr><th rowspan="2">Level</th><th rowspan="2">Proficiency Bonus</th><th rowspan="2">Class Features</th><th rowspan="2">Cantrips</th><th rowspan="2">Prepared Spells</th><th colspan="9">Spell Slots per Spell Level</th></tr><tr>${rng(9).map((n) => `<th>${n}${['st', 'nd', 'rd'][n - 1] ?? 'th'}</th>`).join('')}</tr>`
    : '<tr><th>Level</th><th>Proficiency Bonus</th><th>Class Features</th><th>Cantrips</th><th>Prepared Spells</th><th>Spell Slots</th><th>Slot Level</th></tr>';
  const body = rng(20).map((l) => row([
    l, `+${bonus(l)}`, l === 1 ? 'Spellcasting' : `Feature ${l}`, 2 + Math.floor(l / 5), 3 + l,
    ...(kind === 'full' ? rng(9).map((s) => slotCount(l, s)) : [Math.min(4, 1 + Math.floor(l / 8)), Math.min(5, Math.ceil(l / 2))]),
  ])).join('');
  const name = kind === 'full' ? 'Wizard' : 'Warlock';
  const core = coreTraits({
    name, primary: kind === 'full' ? 'Intelligence' : 'Charisma', hitDie: kind === 'full' ? 'D6' : 'D8',
    saves: kind === 'full' ? 'Intelligence and Wisdom' : 'Wisdom and Charisma',
    skills: 'Choose any 3 skills', weapons: 'Simple weapons', armor: 'None',
    equipment: 'Choose A or B: (A) Dagger, Spellbook; or (B) 100 GP',
  });
  const spellText = kind === 'full'
    ? 'Intelligence is your spellcasting ability for your Wizard spells. You use the Wizard spell list.'
    : 'Charisma is your spellcasting ability for your Warlock spells. You use the Warlock spell list.';
  const sections = rng(20).map((l) => `<h3>Level ${l}: ${l === 1 ? (kind === 'full' ? 'Spellcasting' : 'Spellcasting') : `Feature ${l}`}</h3><p>${l === 1 ? spellText : 'Placeholder.'}</p>`).join('');
  return `<div class="mw-parser-output">${core}<h2>${name} Features</h2><table>${head}${body}</table>${sections}
    <h2>${name} Subclasses</h2><h3>Test Subclass</h3><h4>Level 3: Test Feature</h4><p>Placeholder.</p>
    <h2>Multiclassing</h2><p>Prerequisites: ${kind === 'full' ? 'Intelligence 13' : 'Charisma 13'}</p></div>`;
}

export const linkedSubclassPage = `<div class="mw-parser-output"><p>Intro.</p>
  <h2>Level 3: Wild Feature</h2><p>Placeholder.</p><h2>Level 6: Wilder Feature</h2><p>Placeholder.</p></div>`;
