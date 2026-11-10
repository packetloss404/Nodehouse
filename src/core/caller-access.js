'use strict';

function canBrowse(user, config) {
  return Boolean(user &&
    (user.state === 'active' || user.state === 'pending') &&
    (!user.guest || config.allowGuests !== false));
}

function canWrite(user) {
  return Boolean(user && user.state === 'active' && !user.guest);
}

function canAccessFileArea(user, area, config) {
  return canBrowse(user, config) && Boolean(area && area.accessLevel <= user.access_level);
}

module.exports = { canBrowse, canWrite, canAccessFileArea };
