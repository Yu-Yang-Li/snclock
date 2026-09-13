import assert from 'node:assert/strict'
import test from 'node:test'

import { buildAsassnRequest } from './asassnRequest.ts'

test('builds the manual ASAS-SN request from the current candidate coordinates', () => {
  assert.deepEqual(buildAsassnRequest(339.2734083333333, 34.409825), {
    url: 'https://asas-sn.osu.edu/',
    clipboardText: 'RA: 339.2734083333333\nDec: 34.409825',
    guidance:
      '已复制 RA/Dec；请设置 30 天并选择 Image Subtraction Photometry (No reference flux added)，完成人机验证后点击 Compute。',
  })
})

test('rejects invalid coordinates before opening the ASAS-SN request page', () => {
  assert.throws(
    () => buildAsassnRequest(10, 91),
    /declination must be between -90 and 90 degrees/,
  )
})
