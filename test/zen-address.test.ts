import { describe, expect, it } from 'vitest'
import { ZenAddress, ZenAddressType } from '../src/zen-address.js'
import { ZenController } from '../src/zen-controller.js'

const controller = new ZenController({ host: '192.168.1.100', id: 1 })

describe('ZenAddress accessors', () => {
	it('group() returns the target for a GROUP address, 0-15', () => {
		const address = new ZenAddress(controller, ZenAddressType.GROUP, 0)
		expect(address.group()).toBe(0)

		const maxGroup = new ZenAddress(controller, ZenAddressType.GROUP, 15)
		expect(maxGroup.group()).toBe(15)
	})

	it('ecgOrGroup() returns target+64 for a GROUP address', () => {
		const address = new ZenAddress(controller, ZenAddressType.GROUP, 5)
		expect(address.ecgOrGroup()).toBe(5 + 64)
	})

	it('ecgOrGroup() returns the target for an ECG address', () => {
		const address = new ZenAddress(controller, ZenAddressType.ECG, 5)
		expect(address.ecgOrGroup()).toBe(5)
	})

	it('ecd() returns target+64 for an ECD address', () => {
		const address = new ZenAddress(controller, ZenAddressType.ECD, 10)
		expect(address.ecd()).toBe(10 + 64)
	})

	it('broadcast() creates an address with wire value 255', () => {
		const address = ZenAddress.broadcast(controller)
		expect(address.ecgOrGroupOrBroadcast()).toBe(255)
		expect(address.ecgOrEcdOrBroadcast()).toBe(255)
	})
})

describe('ZenAddress constructor validation', () => {
	it('throws for out-of-range ECG targets', () => {
		expect(() => new ZenAddress(controller, ZenAddressType.ECG, -1)).toThrow()
		expect(() => new ZenAddress(controller, ZenAddressType.ECG, 64)).toThrow()
	})

	it('accepts the boundary ECG targets', () => {
		expect(() => new ZenAddress(controller, ZenAddressType.ECG, 0)).not.toThrow()
		expect(() => new ZenAddress(controller, ZenAddressType.ECG, 63)).not.toThrow()
	})

	it('throws for out-of-range ECD targets', () => {
		expect(() => new ZenAddress(controller, ZenAddressType.ECD, -1)).toThrow()
		expect(() => new ZenAddress(controller, ZenAddressType.ECD, 64)).toThrow()
	})

	it('throws for out-of-range GROUP targets', () => {
		expect(() => new ZenAddress(controller, ZenAddressType.GROUP, -1)).toThrow()
		expect(() => new ZenAddress(controller, ZenAddressType.GROUP, 16)).toThrow()
	})
})

describe('ZenAddress wrong-type accessors', () => {
	it('throws calling group() on a non-GROUP address', () => {
		const address = new ZenAddress(controller, ZenAddressType.ECG, 0)
		expect(() => address.group()).toThrow()
	})

	it('throws calling ecd() on a non-ECD address', () => {
		const address = new ZenAddress(controller, ZenAddressType.ECG, 0)
		expect(() => address.ecd()).toThrow()
	})

	it('throws calling ecg() on a non-ECG address', () => {
		const address = new ZenAddress(controller, ZenAddressType.GROUP, 0)
		expect(() => address.ecg()).toThrow()
	})

	it('throws calling ecgOrGroup() on a BROADCAST address', () => {
		const address = ZenAddress.broadcast(controller)
		expect(() => address.ecgOrGroup()).toThrow()
	})
})
