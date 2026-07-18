import { describe, expect, it } from 'vitest'
import { ZenAddress, ZenAddressType } from '../src/zen-address.js'
import { ZenController } from '../src/zen-controller.js'
import { ZenScene } from '../src/zen-scene.js'

const controller = new ZenController({ host: '192.168.1.100', id: 1 })
const group = new ZenAddress(controller, ZenAddressType.GROUP, 0)

describe('ZenScene', () => {
	it('accepts scene numbers 0 through 12', () => {
		for (let scene = 0; scene <= 12; scene++) {
			expect(() => new ZenScene(group, scene, null)).not.toThrow()
		}
	})

	it('rejects a scene number of -1', () => {
		expect(() => new ZenScene(group, -1, null)).toThrow()
	})

	it('rejects a scene number of 13', () => {
		expect(() => new ZenScene(group, 13, null)).toThrow()
	})
})
