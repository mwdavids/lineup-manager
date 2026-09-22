'use strict';
/*
 * Durable offline-outbox tests (issue #13, Workstream D).
 *
 * The whole local state is the team document and is already mirrored to
 * IndexedDB; the gap was that the "unsynced changes" (dirty) flag lived only in
 * memory, so a relaunch after offline edits either never flushed them or let the
 * silent auto-reconnect overwrite them with the server copy. These tests pin the
 * fix: the dirty flag is persisted and restored across a simulated relaunch, so
 * pending edits survive and are known to still need flushing.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/loadApp');

const app = loadApp();
const LM = app.LM;
const Sync = LM.Sync;

test.after(() => {
  try { app.dom.window.close(); } catch (e) { /* ignore */ }
});

function connectAccount(dirty) {
  Sync.mode = 'account';
  Sync.teamId = 'tm-abc123';
  Sync.teamName = 'Thunder';
  Sync.passcode = null;
  Sync.endpoint = '';
  Sync.baseVersion = 7;
  Sync.connected = true;
  Sync.dirty = dirty;
}

test('the dirty (outbox) flag persists and restores across a relaunch', () => {
  connectAccount(true);
  LM.syncSaveConfig();

  // Simulate a relaunch: in-memory flag is cleared, config reloaded from storage.
  Sync.dirty = false;
  Sync.connected = false;
  LM.syncLoadConfig();

  assert.equal(Sync.dirty, true, 'pending offline edits are still marked unsynced after relaunch');
  assert.equal(Sync.connected, true, 'account team reconnects');
  assert.equal(Sync.baseVersion, 7, 'base version restored');
  assert.equal(Sync.teamId, 'tm-abc123');
});

test('a clean (fully synced) session restores with no pending flag', () => {
  connectAccount(false);
  LM.syncSaveConfig();
  Sync.dirty = true; // ensure the restore, not the stale value, wins
  LM.syncLoadConfig();
  assert.equal(Sync.dirty, false, 'nothing pending → not dirty after relaunch');
});

test('disconnecting clears the persisted outbox flag', () => {
  connectAccount(true);
  LM.syncSaveConfig();
  assert.ok(app.window.localStorage.getItem('lineupManager.sync.v1'), 'config persisted while connected');
  LM.syncDisconnect(); // clears config (and dirty)
  assert.equal(app.window.localStorage.getItem('lineupManager.sync.v1'), null, 'persisted config + outbox flag removed on disconnect');
  assert.equal(Sync.dirty, false, 'in-memory flag cleared too');
});
