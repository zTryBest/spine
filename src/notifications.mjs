import fs from 'node:fs';
import path from 'node:path';

export const NOTIFICATION_MAX = 20;

function notificationsFile(root) {
  return path.join(root, '.hikspine', 'notifications.json');
}

export function notificationId(item) {
  const basis = [
    item?.at || '',
    item?.type || '',
    item?.message || '',
    item?.session || '',
  ].join('\n');
  let hash = 2166136261;
  for (let i = 0; i < basis.length; i += 1) {
    hash ^= basis.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `n-${(hash >>> 0).toString(36)}`;
}

function readRaw(root) {
  try {
    const list = JSON.parse(fs.readFileSync(notificationsFile(root), 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function normalizeNotification(item) {
  const normalized = {
    id: item?.id || notificationId(item || {}),
    at: item?.at || '',
    type: item?.type || '',
    message: item?.message || '',
    session: item?.session || '',
    handledAt: item?.handledAt || '',
  };
  return { ...normalized, handled: !!normalized.handledAt };
}

export function readNotifications(root) {
  return readRaw(root).map(normalizeNotification).slice(-NOTIFICATION_MAX);
}

export function writeNotifications(root, notifications) {
  const dir = path.dirname(notificationsFile(root));
  fs.mkdirSync(dir, { recursive: true });
  const list = (Array.isArray(notifications) ? notifications : [])
    .map(normalizeNotification)
    .slice(-NOTIFICATION_MAX);
  fs.writeFileSync(notificationsFile(root), JSON.stringify(list, null, 2));
  return list;
}

export function appendNotification(root, notification) {
  const item = normalizeNotification({
    at: notification?.at || new Date().toISOString(),
    type: notification?.type || '',
    message: notification?.message || '',
    session: notification?.session || '',
  });
  const list = readNotifications(root).filter((existing) => existing.id !== item.id);
  list.push(item);
  writeNotifications(root, list);
  return item;
}

export function markNotificationsHandled(root, ids) {
  const targets = new Set(Array.isArray(ids) ? ids : [ids]);
  const at = new Date().toISOString();
  let handled = 0;
  const updated = readNotifications(root).map((item) => {
    if (!targets.has(item.id) || item.handledAt) return item;
    handled += 1;
    return { ...item, handledAt: at, handled: true };
  });
  return { handled, notifications: writeNotifications(root, updated) };
}

export function markAllNotificationsHandled(root) {
  const ids = readNotifications(root).filter((item) => !item.handledAt).map((item) => item.id);
  return markNotificationsHandled(root, ids);
}
