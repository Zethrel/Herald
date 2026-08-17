// Works out what has to happen to a server's roles for the blueprint to be
// satisfied. Pure: it takes a snapshot of the server and returns a list of
// intentions, so the interesting decisions are testable without a gateway
// connection.
//
// The plan is strictly additive. Nothing here ever renames, reorders or deletes
// a role a guild already had -- a server that has been running for four expansions
// has history in its role list, and a setup command is not the place to overwrite it.

import { RANKS } from '../blueprint.js';

export function normalizeName(name) {
  return name.normalize('NFKC').trim().toLowerCase();
}

/**
 * @param {object} input
 * @param {Array<{id: string, name: string, managed?: boolean}>} input.existingRoles roles currently on the server
 * @param {Record<string, string|null>} input.boundRoleIds rank key -> role id already recorded in the store
 * @param {Array<object>} [input.ranks] blueprint ranks, in top-to-bottom order
 * @returns {{steps: Array<{key: string, name: string, action: 'keep'|'adopt'|'create', roleId: string|null}>}}
 */
export function planRoles({ existingRoles, boundRoleIds = {}, ranks = RANKS }) {
  const byId = new Map(existingRoles.map((role) => [role.id, role]));
  const byName = new Map();
  for (const role of existingRoles) {
    // Bot-managed roles cannot be handed out, so they are never adoption
    // candidates even when the name matches.
    if (role.managed) continue;
    const key = normalizeName(role.name);
    if (!byName.has(key)) byName.set(key, role);
  }

  const steps = ranks.map((rank) => {
    const bound = boundRoleIds[rank.key];
    if (bound && byId.has(bound)) {
      return { key: rank.key, name: byId.get(bound).name, action: 'keep', roleId: bound };
    }

    const match = byName.get(normalizeName(rank.name));
    if (match) {
      return { key: rank.key, name: match.name, action: 'adopt', roleId: match.id };
    }

    return { key: rank.key, name: rank.name, action: 'create', roleId: null };
  });

  return { steps };
}

export function summarizePlan(steps) {
  return {
    keep: steps.filter((step) => step.action === 'keep').length,
    adopt: steps.filter((step) => step.action === 'adopt').length,
    create: steps.filter((step) => step.action === 'create').length,
  };
}
