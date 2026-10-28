const database = require('./database');

function createDailyCallService(store = database) {
  return {
    snapshot(user, accessibleBases, { since = null, currentCallLogId = null, firstCall = false } = {}) {
      if (!user || !user.id || !user.username) throw new Error('A caller identity is required.');
      // A first call has no "since" reference, so count the full board; otherwise
      // fall back to the caller's stored last call when none was supplied.
      const timestamp = firstCall ? null : (since ?? user.last_call_date ?? null);
      const baseIds = (accessibleBases || []).map((base) => Number(base.id ?? base))
        .filter(Number.isInteger);
      const subscriptions = store.readerSubscriptions.ensure(user.id, baseIds)
        .filter((subscription) => baseIds.includes(subscription.base_id));
      const subscribedBaseIds = subscriptions.filter((subscription) => subscription.subscribed)
        .map((subscription) => subscription.base_id);
      const unreadByBase = subscriptions.map((subscription) => ({
        baseId: subscription.base_id,
        subscribed: Boolean(subscription.subscribed),
        unread: subscription.subscribed
          ? store.messages.countUnreadByBase(subscription.base_id, user.id) : 0,
      }));
      const activeBulletins = store.bulletins.getActive();
      const activePolls = store.polls.getActive();
      return {
        generatedAt: new Date().toISOString(),
        since: timestamp,
        mail: { unread: store.privateMail.countUnread(user.username) },
        conferences: {
          totalUnread: store.messages.countUnreadByBases(subscribedBaseIds, user.id),
          bases: unreadByBase,
        },
        bulletins: {
          active: activeBulletins.length,
          newSinceLastCall: timestamp
            ? activeBulletins.filter((item) => item.created_at > timestamp).length
            : activeBulletins.length,
        },
        files: { newSinceLastCall: timestamp ? store.files.countSince(timestamp) : store.files.getTotal() },
        callers: {
          sinceLastCall: timestamp ? store.callLog.countSince(timestamp, user.id) : 0,
          previous: currentCallLogId === null ? null : store.callLog.getPrevious(currentCallLogId),
        },
        polls: { active: activePolls.length },
      };
    },
  };
}

module.exports = { createDailyCallService };
