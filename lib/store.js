'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA = path.join(__dirname, '..', 'data');
const FILE = path.join(DATA, 'worklist.json');

const DEFAULTS = () => ({
  settings: { photographer: { name: '', wikitreeId: '' }, defaultCountry: 'United States of America' },
  batches: [],
  stones: [],
  people: [],
});

let db = null;
function load() {
  if (db) return db;
  fs.mkdirSync(DATA, { recursive: true });
  try { db = { ...DEFAULTS(), ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; } catch { db = DEFAULTS(); }
  return db;
}
function save() {
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, FILE);
}
const id = () => crypto.randomBytes(6).toString('hex');

module.exports = { load, save, id, DATA };
