import { describe, expect, it } from 'vitest'
import { arcLevelToPercentage, percentageToArcLevel } from '../src/dali-arc-levels.js'

describe('arcLevelToPercentage', () => {
	it('maps 0 to 0', () => {
		expect(arcLevelToPercentage(0)).toBe(0)
	})

	it('maps 1 to the bottom of the exponential curve', () => {
		expect(arcLevelToPercentage(1)).toBeCloseTo(0.1, 5)
	})

	it('maps 254 to 100', () => {
		expect(arcLevelToPercentage(254)).toBeCloseTo(100, 5)
	})

	it('throws for out-of-range values', () => {
		expect(() => arcLevelToPercentage(-1)).toThrow()
		expect(() => arcLevelToPercentage(255)).toThrow()
	})
})

describe('percentageToArcLevel', () => {
	it('maps 0 to 0', () => {
		expect(percentageToArcLevel(0)).toBe(0)
	})

	it('maps 100 to 254', () => {
		expect(percentageToArcLevel(100)).toBe(254)
	})

	it('clamps tiny non-zero percentages to 1, never 0 or negative', () => {
		expect(percentageToArcLevel(0.01)).toBe(1)
		expect(percentageToArcLevel(0.05)).toBe(1)
	})

	it('throws for out-of-range values', () => {
		expect(() => percentageToArcLevel(-1)).toThrow()
		expect(() => percentageToArcLevel(101)).toThrow()
	})

	it('round-trips percentage -> arc level -> percentage within a reasonable tolerance', () => {
		for (const percentage of [1, 5, 10, 25, 50, 75, 99]) {
			const arcLevel = percentageToArcLevel(percentage)
			const roundTripped = arcLevelToPercentage(arcLevel)
			// The DALI curve is logarithmic and arc levels are integers, so we
			// can't expect an exact round trip, only that it lands close by.
			expect(Math.abs(roundTripped - percentage)).toBeLessThan(percentage * 0.1 + 1)
		}
	})
})
