// The runtime side of the allowlist: resolve it, act on it, tell you about it.

import { ACTIONS, approvedIds, planGuildAccess } from './approval.js';
import { alert, buildUnapprovedEmbed, findInviter } from './report.js';

/** The allowlist as it stands: the environment's entries plus the stored ones. */
export async function currentApproved({ store, env }) {
  const app = await store.getApp();
  return approvedIds({ envApproved: env.approvedGuilds, storedApproved: app.approvedGuilds });
}

/**
 * Decide about one server, report it if it is not approved, and leave if that
 * is the configured action.
 *
 * @param {boolean} isNew true for a fresh invite, false for the startup sweep
 */
export async function enforceGuildAccess({ guild, client, store, env, log, isNew = false }) {
  const approved = await currentApproved({ store, env });
  const plan = planGuildAccess({ guild, approved, action: env.unapprovedAction, isNew });

  if (plan.approved) return plan;

  log.warn(
    `Unapproved server: ${guild.name} (${guild.id}), ${guild.memberCount ?? '?'} members — ${
      plan.leave ? 'leaving' : 'staying, commands blocked'
    }`,
  );

  const inviter = await findInviter(guild, client.user.id);
  await alert({
    client,
    embed: buildUnapprovedEmbed({ guild, inviter, left: plan.leave, isNew }),
    owners: env.ownerIds,
    webhookUrl: env.alertWebhookUrl,
    log,
  });

  if (plan.leave) {
    // Reported before leaving, so the report can still read the member count
    // and the audit log.
    await guild.leave().catch((error) => log.error(`Could not leave ${guild.id}: ${error.message}`));
  }

  return plan;
}

export { ACTIONS };
