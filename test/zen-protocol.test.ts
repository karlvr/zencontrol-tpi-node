import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import dgram, { RemoteInfo } from 'node:dgram'
import { ZenController } from '../src/zen-controller.js'
import { ZenProtocol } from '../src/zen-protocol.js'

const RESPONSE_TIMEOUT = 1000
const RESPONSE_CODE_OK = 0xA0

/**
 * A ZenProtocol with one controller whose command socket records outgoing packets instead of
 * sending them. Use `respond` to deliver a controller response as if it arrived from the network.
 */
function createHarness() {
	const controller = new ZenController({ id: 1, host: '192.168.0.1' })
	const protocol = new ZenProtocol({ controllers: [controller], responseTimeout: RESPONSE_TIMEOUT })
	const socket = (protocol as unknown as { commandSocket: dgram.Socket }).commandSocket

	const sent: Buffer[] = []
	socket.send = ((msg: Buffer, _offset: number, length: number, _port: number, _address: string, callback: (error: Error | null, bytes: number) => void) => {
		sent.push(Buffer.from(msg))
		callback(null, length)
	}) as unknown as typeof socket.send

	/** Deliver an OK response, with no data, to the given request packet. */
	function respond(request: Buffer) {
		const payload = [RESPONSE_CODE_OK, request[1], 0]
		const checksum = payload.reduce((acc, byte) => acc ^ byte, 0)
		const msg = Buffer.from([...payload, checksum])
		const rinfo: RemoteInfo = { address: controller.host, family: 'IPv4', port: controller.port, size: msg.length }
		socket.emit('message', msg, rinfo)
	}

	return { controller, protocol, sent, respond }
}

/** Resolve after the current event-loop iteration, including its poll and check phases. */
function nextLoopIteration(): Promise<void> {
	return new Promise(resolve => setImmediate(resolve))
}

describe('ZenProtocol.sendPacket', () => {
	beforeEach(() => {
		/* setImmediate stays real, so the order of timers, socket delivery and immediates is the real one */
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it('resends the same packet when no response arrives before the timeout', async () => {
		const { controller, protocol, sent, respond } = createHarness()
		const result = protocol.sendPacket(controller, 'QUERY_GROUP_NUMBERS', [0, 0, 0, 0])
		await nextLoopIteration()
		expect(sent).toHaveLength(1)

		vi.advanceTimersByTime(RESPONSE_TIMEOUT)
		await nextLoopIteration()
		expect(sent).toHaveLength(2)
		expect(sent[1]).toEqual(sent[0])

		respond(sent[1])
		await expect(result).resolves.toMatchObject({ responseCode: RESPONSE_CODE_OK })
	})

	it('matches a response that waited unread while the timeout expired, instead of resending', async () => {
		const { controller, protocol, sent, respond } = createHarness()
		const result = protocol.sendPacket(controller, 'QUERY_GROUP_NUMBERS', [0, 0, 0, 0])
		await nextLoopIteration()
		expect(sent).toHaveLength(1)

		/* After an event-loop stall, the expired timer runs first, then the poll phase delivers the waiting response */
		vi.advanceTimersByTime(RESPONSE_TIMEOUT)
		respond(sent[0])
		await nextLoopIteration()

		await expect(result).resolves.toMatchObject({ responseCode: RESPONSE_CODE_OK })
		expect(sent).toHaveLength(1)
	})
})
