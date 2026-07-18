import { describe, expect, it } from 'vitest'
import { ZenColour, ZenColourType, hsvToRgb, rgbToHsv } from '../src/zen-colour.js'

describe('ZenColour TC (tuneable white)', () => {
	it('round-trips a kelvin value with a 0xFF low byte through toBytes/fromBytes', () => {
		// 4351 === 0x10FF, so the low byte of the 16-bit word is 0xFF. This must
		// survive because the word as a whole is clamped, not each byte.
		const colour = new ZenColour({ type: ZenColourType.TC, kelvin: 4351 })
		const bytes = colour.toBytes()
		const roundTripped = ZenColour.fromBytes(bytes)
		expect(roundTripped.kelvin).toBe(4351)
	})

	it('clamps kelvin below the minimum in the constructor', () => {
		const colour = new ZenColour({ type: ZenColourType.TC, kelvin: 500 })
		expect(colour.kelvin).toBe(1000)
	})

	it('clamps kelvin above the maximum in the constructor', () => {
		const colour = new ZenColour({ type: ZenColourType.TC, kelvin: 25000 })
		expect(colour.kelvin).toBe(20000)
	})
})

describe('ZenColour XY', () => {
	it('round-trips x/y values with 0xFF low bytes through toBytes/fromBytes', () => {
		const colour = new ZenColour({ type: ZenColourType.XY, x: 0x12ff, y: 0x34ff })
		const bytes = colour.toBytes()
		const roundTripped = ZenColour.fromBytes(bytes)
		expect(roundTripped.x).toBe(0x12ff)
		expect(roundTripped.y).toBe(0x34ff)
	})

	it('returns black when y is 0 for toHsv', () => {
		const colour = new ZenColour({ type: ZenColourType.XY, x: 0, y: 0 })
		expect(colour.toHsv()).toEqual({ h: 0, s: 0, v: 0 })
	})
})

describe('ZenColour RGBWAF', () => {
	it('round-trips channel values through toBytes/fromBytes', () => {
		const colour = new ZenColour({ type: ZenColourType.RGBWAF, r: 10, g: 20, b: 30, w: 40, a: 50, f: 60 })
		const bytes = colour.toBytes()
		const roundTripped = ZenColour.fromBytes(bytes)
		expect(roundTripped).toEqual(
			expect.objectContaining({ r: 10, g: 20, b: 30, w: 40, a: 50, f: 60 }),
		)
	})

	it('clamps channel value 255 to 254 in toBytes, since 0xFF means unused', () => {
		const colour = new ZenColour({ type: ZenColourType.RGBWAF, r: 255, g: 255, b: 255, w: 255, a: 255, f: 255 })
		const bytes = colour.toBytes()
		expect(Array.from(bytes.subarray(1))).toEqual([254, 254, 254, 254, 254, 254])
	})

	it('throws in the constructor for channel values outside 0-255', () => {
		expect(() => new ZenColour({ type: ZenColourType.RGBWAF, r: 256, g: 0, b: 0, w: 0, a: 0, f: 0 })).toThrow()
		expect(() => new ZenColour({ type: ZenColourType.RGBWAF, r: -1, g: 0, b: 0, w: 0, a: 0, f: 0 })).toThrow()
	})
})

describe('ZenColour equals', () => {
	it('considers two separately-constructed identical colours equal', () => {
		const a = new ZenColour({ type: ZenColourType.TC, kelvin: 4000 })
		const b = new ZenColour({ type: ZenColourType.TC, kelvin: 4000 })
		expect(a.equals(b)).toBe(true)
	})

	it('considers colours with differing values unequal', () => {
		const a = new ZenColour({ type: ZenColourType.TC, kelvin: 4000 })
		const b = new ZenColour({ type: ZenColourType.TC, kelvin: 5000 })
		expect(a.equals(b)).toBe(false)
	})

	it('considers colours of differing types unequal', () => {
		const a = new ZenColour({ type: ZenColourType.XY, x: 100, y: 100 })
		const b = new ZenColour({ type: ZenColourType.TC, kelvin: 4000 })
		expect(a.equals(b)).toBe(false)
	})
})

describe('ZenColour HSV round trip', () => {
	it('round-trips fully saturated primary and secondary hues through fromHsv/toHsv', () => {
		for (const hue of [0, 90, 120, 180, 240, 270]) {
			const colour = ZenColour.fromHsv(hue, 1, 1)
			const hsv = colour.toHsv()
			expect(hsv.h).toBeCloseTo(hue, 0)
			expect(hsv.s).toBeCloseTo(1, 1)
			expect(hsv.v).toBeCloseTo(1, 1)
		}
	})
})

describe('rgbToHsv/hsvToRgb inverses', () => {
	it('round-trips full-brightness, fully-saturated primary and secondary colours', () => {
		for (const hue of [0, 60, 120, 180, 240, 300]) {
			const rgb = hsvToRgb(hue, 1, 1)
			const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b)
			expect(hsv.h).toBe(hue)
			expect(hsv.s).toBeCloseTo(1, 5)
			expect(hsv.v).toBeCloseTo(1, 5)
		}
	})

	it('converts pure red, green and blue correctly', () => {
		expect(hsvToRgb(0, 1, 1)).toEqual({ r: 1, g: 0, b: 0 })
		expect(hsvToRgb(120, 1, 1)).toEqual({ r: 0, g: 1, b: 0 })
		expect(hsvToRgb(240, 1, 1)).toEqual({ r: 0, g: 0, b: 1 })
	})
})
