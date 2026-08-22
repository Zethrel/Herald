// The class and specialisation catalogue.
//
// This is the stable half of the problem: which specs exist, what they play as,
// and which primary stat they scale with. Consumable recommendations change
// every tier and live in the tier data file; this does not.
//
// If a patch adds, removes or re-roles a spec, edit this file -- it is data.

export const ROLES = { tank: 'tank', healer: 'healer', melee: 'melee', ranged: 'ranged' };
export const STATS = { strength: 'strength', agility: 'agility', intellect: 'intellect' };

const spec = (className, name, role, stat, aliases = []) => ({
  key: `${className.toLowerCase().replace(/\s+/g, '')}.${name.toLowerCase().replace(/\s+/g, '')}`,
  className,
  name,
  role,
  stat,
  aliases,
});

export const SPECS = [
  spec('Death Knight', 'Blood', ROLES.tank, STATS.strength, ['blood dk', 'bdk']),
  spec('Death Knight', 'Frost', ROLES.melee, STATS.strength, ['frost dk', 'fdk']),
  spec('Death Knight', 'Unholy', ROLES.melee, STATS.strength, ['uh dk', 'uhdk']),

  // Devourer came in with the guild's own consumable table rather than from
  // this file's usual source, so its role is the one thing here that is
  // inferred: agility is certain (it is a Demon Hunter), Vengeance is already
  // the tank, and the table gives it two weapon oils, which is a dual-wielding
  // damage spec. Correct the role here if that turns out to be wrong -- nothing
  // else in the code decides it.
  spec('Demon Hunter', 'Devourer', ROLES.melee, STATS.agility, ['devourer dh', 'dev dh']),
  spec('Demon Hunter', 'Havoc', ROLES.melee, STATS.agility, ['havoc dh']),
  spec('Demon Hunter', 'Vengeance', ROLES.tank, STATS.agility, ['veng dh', 'vdh']),

  spec('Druid', 'Balance', ROLES.ranged, STATS.intellect, ['boomkin', 'boomy', 'moonkin']),
  spec('Druid', 'Feral', ROLES.melee, STATS.agility, ['cat druid']),
  spec('Druid', 'Guardian', ROLES.tank, STATS.agility, ['bear druid', 'bear']),
  spec('Druid', 'Restoration', ROLES.healer, STATS.intellect, ['resto druid', 'rdruid', 'tree']),

  spec('Evoker', 'Devastation', ROLES.ranged, STATS.intellect, ['dev evoker', 'deva']),
  spec('Evoker', 'Preservation', ROLES.healer, STATS.intellect, ['pres evoker', 'pres']),
  spec('Evoker', 'Augmentation', ROLES.ranged, STATS.intellect, ['aug evoker', 'aug']),

  spec('Hunter', 'Beast Mastery', ROLES.ranged, STATS.agility, ['bm hunter', 'bm']),
  spec('Hunter', 'Marksmanship', ROLES.ranged, STATS.agility, ['mm hunter', 'mm']),
  spec('Hunter', 'Survival', ROLES.melee, STATS.agility, ['sv hunter', 'surv']),

  spec('Mage', 'Arcane', ROLES.ranged, STATS.intellect, []),
  spec('Mage', 'Fire', ROLES.ranged, STATS.intellect, []),
  spec('Mage', 'Frost', ROLES.ranged, STATS.intellect, ['frost mage']),

  spec('Monk', 'Brewmaster', ROLES.tank, STATS.agility, ['brm', 'brew']),
  spec('Monk', 'Mistweaver', ROLES.healer, STATS.intellect, ['mw monk', 'mw']),
  spec('Monk', 'Windwalker', ROLES.melee, STATS.agility, ['ww monk', 'ww']),

  spec('Paladin', 'Holy', ROLES.healer, STATS.intellect, ['hpal', 'holy pal']),
  spec('Paladin', 'Protection', ROLES.tank, STATS.strength, ['prot pal', 'ppal']),
  spec('Paladin', 'Retribution', ROLES.melee, STATS.strength, ['ret', 'ret pal']),

  spec('Priest', 'Discipline', ROLES.healer, STATS.intellect, ['disc', 'disc priest']),
  spec('Priest', 'Holy', ROLES.healer, STATS.intellect, ['hpriest', 'holy priest']),
  spec('Priest', 'Shadow', ROLES.ranged, STATS.intellect, ['spriest', 'shadow priest']),

  spec('Rogue', 'Assassination', ROLES.melee, STATS.agility, ['sin', 'assa']),
  spec('Rogue', 'Outlaw', ROLES.melee, STATS.agility, ['combat']),
  spec('Rogue', 'Subtlety', ROLES.melee, STATS.agility, ['sub', 'sub rogue']),

  spec('Shaman', 'Elemental', ROLES.ranged, STATS.intellect, ['ele sham', 'ele']),
  spec('Shaman', 'Enhancement', ROLES.melee, STATS.agility, ['enh sham', 'enh']),
  spec('Shaman', 'Restoration', ROLES.healer, STATS.intellect, ['resto sham', 'rsham']),

  spec('Warlock', 'Affliction', ROLES.ranged, STATS.intellect, ['affli', 'aff lock']),
  spec('Warlock', 'Demonology', ROLES.ranged, STATS.intellect, ['demo', 'demo lock']),
  spec('Warlock', 'Destruction', ROLES.ranged, STATS.intellect, ['destro', 'destro lock']),

  spec('Warrior', 'Arms', ROLES.melee, STATS.strength, ['arms warr']),
  spec('Warrior', 'Fury', ROLES.melee, STATS.strength, ['fury warr']),
  spec('Warrior', 'Protection', ROLES.tank, STATS.strength, ['prot warr', 'pwarr']),
];

export const SPEC_KEYS = SPECS.map((entry) => entry.key);

export function specByKey(key) {
  return SPECS.find((entry) => entry.key === key) ?? null;
}

function normalize(text) {
  return (text ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Find a spec from whatever someone typed: "mage.fire", "fire mage",
 * "Fire Mage", "boomkin", "ww monk".
 *
 * Returns null rather than guessing when the text is ambiguous -- "frost" alone
 * is a Mage and a Death Knight, and picking one silently would put the wrong
 * flask in someone's bags.
 */
export function findSpec(text) {
  const wanted = normalize(text);
  if (!wanted) return null;

  const exactKey = SPECS.find((entry) => normalize(entry.key) === wanted.replace(/ /g, ''));
  if (exactKey) return exactKey;

  const candidates = SPECS.filter((entry) => {
    const specName = normalize(entry.name);
    const className = normalize(entry.className);
    return (
      wanted === `${specName} ${className}` ||
      wanted === `${className} ${specName}` ||
      entry.aliases.some((alias) => normalize(alias) === wanted)
    );
  });

  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1) return null;

  // Last resort: a bare spec name, only when it belongs to exactly one class.
  const byName = SPECS.filter((entry) => normalize(entry.name) === wanted);
  return byName.length === 1 ? byName[0] : null;
}

/** Specs grouped by class, in catalogue order. Used for rendering. */
export function specsByClass() {
  const grouped = new Map();
  for (const entry of SPECS) {
    if (!grouped.has(entry.className)) grouped.set(entry.className, []);
    grouped.get(entry.className).push(entry);
  }
  return grouped;
}
