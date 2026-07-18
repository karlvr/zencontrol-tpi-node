import { describe, expect, it } from 'vitest'
import { ZenEventMask, ZenEventMode } from '../src/zen-events.js'

describe('ZenEventMask', () => {
	it('round-trips allEvents() through upper()/lower() and fromUpperLower', () => {
		const all = ZenEventMask.allEvents()
		const roundTripped = ZenEventMask.fromUpperLower(all.upper(), all.lower())
		expect(roundTripped).toEqual(all)
	})

	it('includes group_occupancy (bit 10) and level_change_v2 (bit 11) in the bitmask', () => {
		const all = ZenEventMask.allEvents()
		expect(all.bitmask() & (1 << 10)).not.toBe(0)
		expect(all.bitmask() & (1 << 11)).not.toBe(0)
	})

	it('round-trips group_occupancy and level_change_v2 individually', () => {
		const mask = new ZenEventMask()
		mask.group_occupancy = true
		const roundTripped = ZenEventMask.fromDoubleByte(mask.bitmask())
		expect(roundTripped.group_occupancy).toBe(true)
		expect(roundTripped.level_change_v2).toBe(false)

		const mask2 = new ZenEventMask()
		mask2.level_change_v2 = true
		const roundTripped2 = ZenEventMask.fromDoubleByte(mask2.bitmask())
		expect(roundTripped2.level_change_v2).toBe(true)
		expect(roundTripped2.group_occupancy).toBe(false)
	})

	it('produces an all-zero bitmask for a fresh mask', () => {
		expect(new ZenEventMask().bitmask()).toBe(0)
	})
})

describe('ZenEventMode', () => {
	it('round-trips bitmask()/fromByte(), including the inverted multicast bit', () => {
		const mode = new ZenEventMode({ enabled: true, filtering: true, unicast: true, multicast: true })
		const roundTripped = ZenEventMode.fromByte(mode.bitmask())
		expect(roundTripped).toEqual(mode)
	})

	it('sets 0x80 when multicast is disabled (inverted bit)', () => {
		const mode = new ZenEventMode({ enabled: false, filtering: false, unicast: false, multicast: false })
		expect(mode.bitmask() & 0x80).toBe(0x80)
	})

	it('clears 0x80 when multicast is enabled (inverted bit)', () => {
		const mode = new ZenEventMode({ enabled: false, filtering: false, unicast: false, multicast: true })
		expect(mode.bitmask() & 0x80).toBe(0)
	})

	it('decodes 0x80 set as multicast disabled via fromByte', () => {
		const mode = ZenEventMode.fromByte(0x80)
		expect(mode.multicast).toBe(false)
	})

	it('decodes 0x80 clear as multicast enabled via fromByte', () => {
		const mode = ZenEventMode.fromByte(0x00)
		expect(mode.multicast).toBe(true)
	})
})
