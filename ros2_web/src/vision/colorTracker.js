export const CUBE_COLORS = Object.freeze([
  { value: 'red', label: '红色', swatch: '#ef4444', hue: [[0, 14], [345, 360]] },
  { value: 'blue', label: '蓝色', swatch: '#2563eb', hue: [[195, 255]] },
  { value: 'green', label: '绿色', swatch: '#16a34a', hue: [[75, 165]] },
  { value: 'yellow', label: '黄色', swatch: '#eab308', hue: [[43, 72]] },
  { value: 'orange', label: '橙色', swatch: '#f97316', hue: [[15, 42]] }
])

// Fixed-size buffers are reused; at most 320x240 pixels, 8 frames per second.
export class ColorCubeDetector {
  constructor() { this.width = 0; this.height = 0; this.previous = null }
  reset() { this.previous = null }
  detect(image, color, { minPixels = 45, saturation = 0.38, brightness = 0.18 } = {}) {
    const definition = CUBE_COLORS.find(item => item.value === color)
    if (!definition) return null
    const { width, height, data } = image
    const count = width * height
    if (width !== this.width || height !== this.height) {
      this.width = width; this.height = height
      this.mask = new Uint8Array(count)
      this.queue = new Int32Array(count)
      this.reset()
    }
    const mask = this.mask
    for (let i = 0; i < count; i++) {
      const r = data[i * 4] / 255, g = data[i * 4 + 1] / 255, b = data[i * 4 + 2] / 255
      const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min
      if (max < brightness || max === 0 || delta / max < saturation) { mask[i] = 0; continue }
      let hue = max === r ? 60 * ((g - b) / delta) : max === g ? 60 * ((b - r) / delta + 2) : 60 * ((r - g) / delta + 4)
      if (hue < 0) hue += 360
      mask[i] = definition.hue.some(([low, high]) => hue >= low && hue <= high) ? 1 : 0
    }
    const candidates = []
    for (let start = 0; start < count; start++) {
      if (!mask[start]) continue
      let head = 0, tail = 1, pixels = 0, sumX = 0, sumY = 0
      let minX = width, maxX = 0, minY = height, maxY = 0
      this.queue[0] = start; mask[start] = 0
      while (head < tail) {
        const index = this.queue[head++], x = index % width, y = Math.floor(index / width)
        pixels++; sumX += x; sumY += y
        minX = Math.min(minX, x); maxX = Math.max(maxX, x)
        minY = Math.min(minY, y); maxY = Math.max(maxY, y)
        const neighbors = [x > 0 ? index - 1 : -1, x < width - 1 ? index + 1 : -1,
          y > 0 ? index - width : -1, y < height - 1 ? index + width : -1]
        for (const neighbor of neighbors) {
          if (neighbor >= 0 && mask[neighbor]) { mask[neighbor] = 0; this.queue[tail++] = neighbor }
        }
      }
      const boxWidth = maxX - minX + 1, boxHeight = maxY - minY + 1, ratio = boxWidth / boxHeight
      if (pixels < minPixels || pixels > count * 0.45 || ratio < 0.45 || ratio > 2.2 || pixels / (boxWidth * boxHeight) < 0.48) continue
      candidates.push({ x: minX / width, y: minY / height, width: boxWidth / width, height: boxHeight / height,
        cx: sumX / pixels / width, cy: sumY / pixels / height, pixels })
    }
    let target = null
    if (this.previous) {
      // Keep the same blob; do not immediately jump to another same-color object.
      const nearby = candidates.filter(item => Math.hypot(item.cx - this.previous.cx, item.cy - this.previous.cy) < 0.22)
      nearby.sort((a, b) => Math.hypot(a.cx - this.previous.cx, a.cy - this.previous.cy) - Math.hypot(b.cx - this.previous.cx, b.cy - this.previous.cy))
      target = nearby[0] || null
    } else {
      candidates.sort((a, b) => b.pixels - a.pixels)
      target = candidates[0] || null
    }
    this.previous = target
    return target
  }
}
