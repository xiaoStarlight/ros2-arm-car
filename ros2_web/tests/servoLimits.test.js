import assert from 'node:assert/strict'
import test from 'node:test'
import { HOME_ANGLES, getServoCommandError, fitServoAngle, getServoDraftAngle, publishServoCommand, isValidHomeSequence } from '../src/config/servoLimits.js'

const measuredRanges = [[1, 20, 180], [2, 0, 170], [3, 0, 180], [4, 40, 180], [5, 120, 180]]

test('measured joint endpoints are accepted and out-of-range commands never publish', () => {
  for (const [channel, min, max] of measuredRanges) {
    const sent = []
    const publish = (id, message) => sent.push({ id, message })
    for (const angle of [min - 1, max + 1, NaN, Infinity, -Infinity, '', null, undefined, true]) {
      assert.equal(publishServoCommand(publish, 7, channel, angle), false)
    }
    assert.equal(sent.length, 0)
    for (const angle of [min, (min + max) / 2, max]) {
      assert.equal(publishServoCommand(publish, 7, channel, angle), true)
      assert.deepEqual(sent.at(-1), { id: 7, message: { x: channel, y: angle, z: 0 } })
    }
  }
})

test('gripper rejects over-opening and only publishes 120–180 degrees', () => {
  const sent = []
  for (const angle of [-1, 0, 75, 90, 119, 119.9, 181, NaN, '120', null]) {
    assert.equal(publishServoCommand((...args) => sent.push(args), 7, 5, angle), false)
  }
  assert.equal(sent.length, 0)
  for (const angle of [120, 120.1, 150, 179.9, 180]) {
    assert.equal(publishServoCommand((...args) => sent.push(args), 7, 5, angle), true)
  }
  assert.deepEqual(sent.map(([, message]) => message.y), [120, 120.1, 150, 179.9, 180])
})

test('invalid channels cannot publish', () => {
  for (const channel of [0, 6, 1.5, NaN, '1', null, undefined]) {
    assert.equal(publishServoCommand(() => assert.fail('Unexpected publish'), 7, channel, 90), false)
  }
})

test('reference values are fitted to each channel range', () => {
  assert.equal(fitServoAngle(1, 0), 20)
  assert.equal(fitServoAngle(2, 180), 170)
  assert.equal(fitServoAngle(4, 20), 40)
  assert.equal(fitServoAngle(5, 90), 120)
  assert.equal(fitServoAngle(5, 170), 170)
  for (const channel of [1, 2, 3, 4, 5]) {
    for (const previous of [-10, 0, 20, 40, 90, 170, 180, 200, '', NaN]) {
      assert.equal(getServoCommandError(channel, fitServoAngle(channel, previous)), '')
    }
  }
})

test('home sequence is fully validated before scheduling any joint', () => {
  assert.equal(isValidHomeSequence(HOME_ANGLES), true)
  for (const angles of [[0, 0, 180, 180, 180], [90, 180, 180, 180, 180], [90, 0, 180, 20, 180], [90, 0, 180, 180, 181], [90], new Array(5), null]) {
    assert.equal(isValidHomeSequence(angles), false)
  }
})

test('each channel remembers only its last successful target', () => {
  const remembered = {}
  assert.equal(publishServoCommand(() => true, 7, 1, 50, remembered), true)
  assert.equal(publishServoCommand(() => true, 7, 2, 120, remembered), true)
  assert.equal(publishServoCommand(() => true, 7, 5, 150, remembered), true)
  assert.equal(getServoDraftAngle(1, remembered), 50)
  assert.equal(getServoDraftAngle(2, remembered), 120)
  assert.equal(getServoDraftAngle(5, remembered), 150)
  assert.equal(getServoDraftAngle(3, remembered), 90)
  assert.equal(getServoDraftAngle(4, remembered), 90)
  assert.equal(getServoDraftAngle(5, {}), 120)
  assert.equal(getServoDraftAngle(5, { 5: 75 }), 120)
})

test('invalid, disconnected and throwing sends do not overwrite remembered targets', () => {
  const remembered = { 1: 50 }
  assert.equal(publishServoCommand(() => true, 7, 1, 19, remembered), false)
  assert.equal(publishServoCommand(() => false, 7, 1, 100, remembered), false)
  assert.throws(() => publishServoCommand(() => { throw new Error('closed socket') }, 7, 1, 120, remembered))
  assert.deepEqual(remembered, { 1: 50 })
})

test('the home sequence updates memory only as each command is sent', () => {
  const remembered = { 1: 50, 2: 120 }
  HOME_ANGLES.forEach((angle, index) => {
    assert.equal(publishServoCommand(() => index !== 1, 7, index + 1, angle, remembered), index !== 1)
  })
  assert.deepEqual(remembered, { 1: 90, 2: 120, 3: 180, 4: 180, 5: 180 })
})
