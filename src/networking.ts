import os from 'node:os'
import { isInSubnet } from 'is-in-subnet'

/**
 * Find the host interface address that is on the same network as the given target address.
 * @param targetAddress the ip address we are targeting
 * @returns 
 */
/**
 * Check whether a string is a dotted-quad IPv4 address with all octets in range.
 * Use this before treating a host string as an IPv4 address; hostnames, IPv6
 * addresses and malformed quads (empty, hex or out-of-range octets) return `false`.
 * @param address the string to check
 */
export function isIpv4Address(address: string): boolean {
	if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(address)) {
		return false
	}
	return address.split('.').every(octet => Number(octet) <= 255)
}

export function hostAddressFor(targetAddress: string): string | null {
	const interfaces = os.networkInterfaces()
	for (const iface in interfaces) {
		const addresses = interfaces[iface]
		if (addresses) {
			for (const address of addresses) {
				if (address.cidr && isInSubnet(targetAddress, address.cidr)) {
					return address.address
				}
			}
		}
	}
	return null
}
