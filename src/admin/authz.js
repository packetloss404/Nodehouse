'use strict';

const ACCESS = Object.freeze({
  CALLER: 10,
  MODERATOR: 100,
  SYSOP: 200,
});

const PERMISSIONS = Object.freeze({
  VIEW_CONTROL_DESK: ACCESS.MODERATOR,
  MODERATE_COMMUNITY: ACCESS.MODERATOR,
  MANAGE_USERS: ACCESS.SYSOP,
  MANAGE_SYSTEM: ACCESS.SYSOP,
});

function safeActor(user) {
  if (!user) return null;
  return {
    id: Number(user.id),
    username: String(user.username || ''),
    accessLevel: Number(user.access_level || 0),
  };
}

function hasPermission(actor, permission) {
  const required = PERMISSIONS[permission];
  return Number.isFinite(required) && Number(actor && actor.accessLevel) >= required;
}

function requirePermission(permission) {
  return (req, res, next) => {
    if (!hasPermission(req.adminActor, permission)) {
      res.status(403).json({ error: 'Insufficient access' });
      return;
    }
    next();
  };
}

module.exports = { ACCESS, PERMISSIONS, safeActor, hasPermission, requirePermission };
