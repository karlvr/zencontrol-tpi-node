import { describe, expect, it } from 'vitest'
import { isIpv4Address } from '../src/networking.js'

describe('isIpv4Address', () => {
	it('accepts valid dotted-quad addresses', () => {
		expect(isIpv4Address('192.168.1.10')).toBe(true)
		expect(isIpv4Address('0.0.0.0')).toBe(true)
		expect(isIpv4Address('255.255.255.255')).toBe(true)
	})

	it('rejects addresses with missing or empty octets', () => {
		expect(isIpv4Address('1.2.3')).toBe(false)
		expect(isIpv4Address('1.2.3.')).toBe(false)
		expect(isIpv4Address('.1.2.3')).toBe(false)
		expect(isIpv4Address('1.2.3.4.5')).toBe(false)
		expect(isIpv4Address('')).toBe(false)
	})

	it('rejects out-of-range octets', () => {
		expect(isIpv4Address('256.1.1.1')).toBe(false)
		expect(isIpv4Address('1.1.1.999')).toBe(false)
	})

	it('rejects hex, whitespace and signed octet forms that Number() would coerce', () => {
		expect(isIpv4Address('0x10.1.1.1')).toBe(false)
		expect(isIpv4Address(' 1.2.3.4')).toBe(false)
		expect(isIpv4Address('1.2.3. 4')).toBe(false)
		expect(isIpv4Address('-1.2.3.4')).toBe(false)
	})

	it('rejects hostnames and IPv6 addresses', () => {
		expect(isIpv4Address('example.com')).toBe(false)
		expect(isIpv4Address('::1')).toBe(false)
		expect(isIpv4Address('fe80::1%en0')).toBe(false)
	})
})
