'use strict';
/**
 * Activity registry. Every other file in this folder is an activity: it exports a class with a static `meta`.
 * See README.md for the contract. A broken activity file is skipped (and logged), it never stops the server.
 */
const fs = require('fs');
const path = require('path');

const registry = new Map(); // type -> class

for (const file of fs.readdirSync(__dirname)) {
  if (!file.endsWith('.js') || file === 'index.js') continue;
  try {
    const Cls = require(path.join(__dirname, file));
    const meta = Cls && Cls.meta;
    if (!meta || typeof meta.type !== 'string' || typeof Cls !== 'function') throw new Error('missing static meta.type or not a class');
    registry.set(meta.type, Cls);
  } catch (e) {
    console.error(`[activities] skipped ${file}: ${e.message}`);
  }
}

/** Public list for the host menu. */
function list() {
  return [...registry.values()].map((C) => ({
    type: C.meta.type,
    title: C.meta.title || C.meta.type,
    blurb: C.meta.blurb || '',
    minPlayers: C.meta.minPlayers || 1,
    key: C.meta.key || '',
    options: C.meta.options || [],
  }));
}

/** Create an activity instance, or return null for an unknown type. */
function create(type, room, opts) {
  const C = registry.get(type);
  return C ? new C(room, opts || {}) : null;
}

module.exports = { list, create, registry };
