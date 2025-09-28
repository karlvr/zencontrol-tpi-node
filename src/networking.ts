import os from 'node:os'
import { isInSubnet } from 'is-in-subnet'

/**
 * Find the host interface address that is on the same network as the given target address.
 * @param targetAddress the ip address we are targeting
 * @returns 
 */
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
