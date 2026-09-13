const test = require('node:test');
const assert = require('node:assert/strict');
const display = require('../static/tom_common/js/telescope-display.js');

test('state labels preserve the original evidence', () => {
  assert.equal(display.state('PENDING'), '等待观测（PENDING）');
  assert.equal(display.state('processed'), '日报标记已处理（processed）');
  assert.equal(display.state('UNRECOGNIZED'), 'UNRECOGNIZED');
  assert.equal(display.state(null), '未提供');
});
test('converts explicit UTC and offsets, not timezone-free source strings', () => {
  assert.match(display.timestamp('2099-01-01T20:00:00Z'), /2099.01.02.*04:00:00 北京时间/);
  assert.equal(display.timestamp('2099-01-01T20:00:00Z'), display.timestamp('2099-01-02T04:00:00+08:00'));
  assert.equal(display.timestamp('2099-01-01 20:00:00'), '2099-01-01 20:00:00（时区未确认）');
  assert.equal(display.timestamp(null), '未提供');
});
test('rejects mixed snapshots and unversioned pagination', () => {
  assert.equal(display.sameSnapshot('a', [{snapshot_sha256: 'a'}, {snapshot_sha256: 'a'}]), true);
  assert.equal(display.sameSnapshot('a', [{snapshot_sha256: 'a'}, {snapshot_sha256: 'b'}]), false);
  assert.equal(display.sameSnapshot('a', [{}]), false);
  assert.equal(display.sameSnapshot('', [{}]), false);
});
