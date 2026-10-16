// Physical limits measured on this arm. Below 120 degrees the gripper can stall.
export const SERVO_LIMITS = Object.freeze({
  1: Object.freeze({ min: 20, max: 180 }),
  2: Object.freeze({ min: 0, max: 170 }),
  3: Object.freeze({ min: 0, max: 180 }),
  4: Object.freeze({ min: 40, max: 180 }),
  5: Object.freeze({ min: 120, max: 180 })
})

export const HOME_ANGLES = Object.freeze([90, 0, 180, 180, 180])

export function getServoLimits(channel) {
  return Number.isInteger(channel) ? SERVO_LIMITS[channel] : undefined
}

export function getServoRangeLabel(channel) {
  const limits = getServoLimits(channel)
  if (!limits) return '通道必须为 1–5'
  return `${limits.min}–${limits.max}°`
}

export function getServoCommandError(channel, angle) {
  const limits = getServoLimits(channel)
  if (!limits) return '舵机通道必须为 1–5 的整数'
  if (!Number.isFinite(angle)) return '请输入有效的舵机角度'
  return angle >= limits.min && angle <= limits.max
    ? '' : `通道 ${channel} 的角度必须在 ${limits.min}–${limits.max}° 之间`
}

// Used only to adjust the draft when changing channels; never publishes a command.
export function fitServoAngle(channel, angle) {
  const limits = getServoLimits(channel)
  if (!limits) return angle
  if (!Number.isFinite(angle)) return limits.min
  return Math.min(limits.max, Math.max(limits.min, angle))
}

// Both manual commands and the home sequence pass through this publish boundary.
export function publishServoCommand(publish, channelId, channel, angle, lastSentAngles) {
  if (getServoCommandError(channel, angle)) return false
  if (publish(channelId, { x: channel, y: angle, z: 0.0 }) === false) return false
  if (lastSentAngles) lastSentAngles[channel] = angle
  return true
}

// Only successful sends are remembered. Unsent edits never become the next draft.
export function getServoDraftAngle(channel, lastSentAngles) {
  const remembered = lastSentAngles?.[channel]
  if (!getServoCommandError(channel, remembered)) return remembered
  return fitServoAngle(channel, channel === 5 ? 120 : 90)
}

export function isValidHomeSequence(angles) {
  return Array.isArray(angles) && angles.length === 5 &&
    Array.from(angles).every((angle, index) => !getServoCommandError(index + 1, angle))
}
