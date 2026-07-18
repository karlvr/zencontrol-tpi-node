import dgram, { RemoteInfo } from 'node:dgram'
import { CMD, ZenCommand } from './zen-commands.js'
import { ZenError, ZenErrorCode, ZenResponseError, ZenTimeoutError } from './zen-errors.js'
import { ZenController } from './zen-controller.js'
import { ZenInstance, ZenInstanceType } from './zen-instance.js'
import { ZenAddress, ZenAddressType } from './zen-address.js'
import { ZenColour } from './zen-colour.js'
import { ZenConst } from './zen-const.js'
import { ZenEventMask, ZenEventMode, ZenEventType } from './zen-events.js'
import { ZenScene } from './zen-scene.js'
import { ZenControlGearType } from './zen-gear.js'
import { hostAddressFor } from './networking.js'

interface Logger {
	debug: (message: string) => void
	info: (message: string) => void
	warn: (message: string) => void
}

export interface ZenProtocolOptions {
	unicast?: boolean
	listenIp?: string
	listenPort?: number
	responseTimeout?: number
	controllers?: ZenController[]
	maxRequestsPerController?: number
	maxRetries?: number
	logger?: Logger
}

enum ZenResponseCode {
	OK = 0xA0,
	ANSWER = 0xA1,
	NO_ANSWER = 0xA2,
	ERROR = 0xA3,
}

interface ZenResponse {
	responseCode: number
	data: Buffer
}

interface ZenRequestPromise {
	resolve: (response: ZenResponse) => void
	reject: (error: ZenError) => void
	controller: ZenController
	timeout?: NodeJS.Timeout
}

async function delay(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms)
	})
}

export class ZenProtocol {
	private unicast: boolean
	private listenIp: string
	private listenPort: number
	private responseTimeout: number

	private nextSeq = 0
	private commandSocket: dgram.Socket
	private eventSocket: dgram.Socket | null = null
	private checkEventMonitoringInterval: NodeJS.Timeout | undefined
	private eventRestartDelay = 1000
	private eventRestartTimer: NodeJS.Timeout | undefined

	/** Used to match events to controllers, and include controller objects in callbacks */
	public controllers: ZenController[]
	public maxRequestsPerController: number
	public maxRetries: number

	/** Per-controller concurrency state: number of in-flight requests, and resolvers waiting for a slot to free up. */
	private requestSlots: Record<number, { active: number, waiting: (() => void)[] }> = {}

	public buttonPressCallback?: (instance: ZenInstance) => void
	public buttonHoldCallback?: (instance: ZenInstance) => void
	public absoluteInputCallback?: (instance: ZenInstance, value: number) => void
	public levelChangeCallback?: (address: ZenAddress, arcLevel: number) => void
	public groupLevelChangeCallback?: (address: ZenAddress, arcLevel: number) => void
	public sceneChangeCallback?: (address: ZenAddress, scene: number) => void
	public occupancyCallback?: (instance: ZenInstance) => void
	public systemVariableChangeCallback?: (controller: ZenController, variable: number, value: number) => void
	public colourChangeCallback?: (address: ZenAddress, colour: ZenColour) => void
	public profileChangeCallback?: (controller: ZenController, profile: number) => void
	public groupOccupancyCallback?: (address: ZenAddress, occupied: boolean) => void
	public levelChangeV2Callback?: (address: ZenAddress, arcLevel: number, dimmingTo: number) => void

	private requestsBySeq: ZenRequestPromise[] = []

	private logger: Logger

	constructor(opts: ZenProtocolOptions = {}) {
		this.unicast = opts.unicast ?? false
		this.listenIp = opts.listenIp ?? '0.0.0.0'
		this.listenPort = opts.listenPort ?? ZenConst.DEFAULT_UNICAST_PORT
		this.responseTimeout = opts.responseTimeout ?? ZenConst.RESPONSE_TIMEOUT
		this.controllers = opts.controllers || []
		this.maxRequestsPerController = opts.maxRequestsPerController || ZenConst.DEFAULT_MAX_REQUESTS_PER_CONTROLLER
		this.maxRetries = opts.maxRetries ?? ZenConst.DEFAULT_MAX_RETRIES
		this.logger = opts.logger ?? console

		this.commandSocket = dgram.createSocket('udp4')
		this.commandSocket.on('message', (msg: Buffer, rinfo: RemoteInfo) => {
			if (msg.length < 4) {
				this.logger.warn(`Received invalid message: too short from ${rinfo.address}:${rinfo.port}`)
				return
			}

			const responseCode = msg[0]
			const seq = msg[1]
			const dataLength = msg[2]

			const request = this.requestsBySeq[seq]
			if (!request) {
				this.logger.warn(`Received message with unknown sequence number (${seq}) from ${rinfo.address}:${rinfo.port}`)
				return
			}

			const controllerHost = request.controller.host
			if (/^\d{1,3}(\.\d{1,3}){3}$/.test(controllerHost) && rinfo.address !== controllerHost) {
				this.logger.warn(`Received message for sequence number (${seq}) from unexpected source ${rinfo.address}:${rinfo.port}, expected ${controllerHost}`)
				return
			}

			const responseChecksum = msg[msg.length - 1]
			const expectedChecksum = this.checksumBuffer(msg.subarray(0, msg.length - 1))
			if (responseChecksum !== expectedChecksum) {
				this.logger.warn(`Received message with invalid checksum: expected ${expectedChecksum} received ${responseChecksum} from ${rinfo.address}:${rinfo.port}`)
				return
			}

			const expectedLength = 4 + dataLength // type + seq + len + data + checksum
			if (msg.length !== expectedLength) {
				this.logger.warn(`Received message with length mismatch: expected ${expectedLength} received ${msg.length} from ${rinfo.address}:${rinfo.port}`)
				return
			}

			delete this.requestsBySeq[seq]

			if (request.timeout) {
				clearTimeout(request.timeout)
			}

			this.finishActiveRequest(request.controller)

			if (dataLength) {
				const responseData = msg.subarray(3, msg.length - 1)

				request.resolve({ responseCode, data: responseData })
			} else {
				request.resolve({ responseCode, data: Buffer.of() })
			}
		})
	}

	/**
	 * Wait until fewer than `maxRequestsPerController` requests are active for the given controller,
	 * then reserve a slot for the caller. Pair with `finishActiveRequest` once the request completes.
	 */
	private async acquireRequestSlot(controller: ZenController): Promise<void> {
		if (!this.requestSlots[controller.id]) {
			this.requestSlots[controller.id] = { active: 0, waiting: [] }
		}
		const slots = this.requestSlots[controller.id]

		while (slots.active >= this.maxRequestsPerController) {
			await new Promise<void>(resolve => slots.waiting.push(resolve))
		}

		slots.active++
	}

	private finishActiveRequest(controller: ZenController): void {
		const slots = this.requestSlots[controller.id]
		if (!slots) {
			return
		}

		slots.active--

		const waitingFunc = slots.waiting.shift()
		if (waitingFunc) {
			/* Wake up one waiting request */
			waitingFunc()
		}
	}

	private checksum(packet: number[]): number {
		const sum = packet.reduce((acc, byte) => acc ^ byte, 0)
		return sum & 0xff
	}

	private checksumBuffer(packet: Buffer): number {
		const sum = packet.reduce((acc, byte) => acc ^ byte, 0)
		return sum & 0xff
	}

	async sendPacket(controller: ZenController, command: ZenCommand, data: number[]): Promise<ZenResponse> {
		const commandCode = CMD[command]

		await this.acquireRequestSlot(controller)

		let seq = this.nextSeq
		this.nextSeq = (this.nextSeq + 1) % 256
		let seqLoops = 0
		const originalSeq = seq

		while (this.requestsBySeq[seq]) {
			seq = this.nextSeq
			this.nextSeq = (this.nextSeq + 1) % 256
			if (seq === originalSeq) {
				seqLoops++

				/* We've looped looking for a free sequence number */
				if (seqLoops < 4) {
					this.logger.warn('No free sequence numbers for message. Waiting for a sequence number.')
					await delay(Math.pow(10, seqLoops))
				} else {
					this.logger.warn('Failed to find a free sequence number for message.')
					this.finishActiveRequest(controller)
					throw new ZenTimeoutError('Failed to find a free sequence number for message.')
				}
			}
		}

		return new Promise<ZenResponse>((resolve, reject) => {
			const payload = [ZenConst.MAGIC_BYTE, seq, commandCode, ...data]
			const checksum = this.checksum(payload)
			const packet = Buffer.from([...payload, checksum])

			const req: ZenRequestPromise = {
				resolve,
				reject,
				controller,
			}
			this.requestsBySeq[seq] = req

			let retries = 0

			const handleSend = (err: Error | null) => {
				if (this.requestsBySeq[seq] !== req) {
					return /* Response already received, or sequence number reused by another request */
				}

				if (err) {
					this.logger.warn(`Failed to send message to ${controller.host}:${controller.port}: ${err instanceof Error ? err.message : err}`)

					delete this.requestsBySeq[seq]
					this.finishActiveRequest(controller)
					reject(err)
				} else {
					const timeout = () => {
						if (this.requestsBySeq[seq] !== req) {
							return /* Response already received, or sequence number reused by another request */
						}

						retries++

						if (retries >= this.maxRetries) {
							this.logger.warn(`Failed to send message to ${controller.host}:${controller.port}: too many retries (${retries})`)

							delete this.requestsBySeq[seq]
							this.finishActiveRequest(controller)
							reject(new ZenTimeoutError(`Failed to send message to ${controller.host}:${controller.port}: too many retries (${retries})`))
						} else {
							this.commandSocket.send(packet, 0, packet.length, controller.port, controller.host, handleSend)
						}
					}

					req.timeout = setTimeout(timeout, this.responseTimeout)
				}
			}
			
			this.commandSocket.send(packet, 0, packet.length, controller.port, controller.host, handleSend)
		})
	}

	async sendBasicFrame(controller: ZenController, command: ZenCommand, address: number, data: number[], returnType: 'str'): Promise<string | null>
	async sendBasicFrame(controller: ZenController, command: ZenCommand, address: number, data: number[], returnType: 'bytes'): Promise<Buffer | null>
	async sendBasicFrame(controller: ZenController, command: ZenCommand, address: number, data: number[], returnType: 'int'): Promise<number | null>
	async sendBasicFrame(controller: ZenController, command: ZenCommand, address: number, data: number[], returnType: 'bool'): Promise<boolean | null>
	async sendBasicFrame(controller: ZenController, command: ZenCommand, address: number, data: number[], returnType: 'ok'): Promise<boolean | null>
	async sendBasicFrame(controller: ZenController, command: ZenCommand, address: number, data: number[], returnType: 'list'): Promise<number[] | null>
	async sendBasicFrame(controller: ZenController, command: ZenCommand, address: number, data: number[], returnType: 'str' | 'bytes' | 'int' | 'bool' | 'ok' | 'list'): Promise<string | Buffer | number | boolean | number[] | null> {
		if (data.length > 3) {
			throw new Error('data must be 0-3 bytes')
		}
		// Pad a copy to 3 bytes so we don't mutate the caller's array
		const frameData = [...data]
		while (frameData.length < 3) {
			frameData.push(0)
		}

		const response = await this.sendPacket(controller, command, [address, ...frameData])

		switch (response.responseCode) {
		case ZenResponseCode.OK: {
			if (returnType === 'ok') {
				return true
			} else {
				throw new Error(`Invalid return type '${returnType}' for response code ${response.responseCode.toString(16)}`)
			}
		}
		case ZenResponseCode.ANSWER: {
			switch (returnType) {
			case 'bytes':
				return response.data
			case 'str':
				return response.data.toString('utf-8')
			case 'int':
				if (response.data.length === 1) {
					return response.data[0] 
				} else {
					throw new ZenResponseError(`Invalid response of length ${response.data.length} for return type 'int'`)
				}
			case 'bool':
				if (response.data.length === 1) {
					return !!response.data[0] 
				} else {
					throw new ZenResponseError(`Invalid response of length ${response.data.length} for return type 'bool'`)
				}
			case 'list': {
				const result: number[] = []
				for (const byte of response.data) {
					result.push(byte)
				}
				return result
			}
			default:
				throw new Error(`Invalid return type '${returnType}' for response code ${response.responseCode.toString(16)}`)
			}
		}
		case ZenResponseCode.NO_ANSWER: {
			// NO_ANSWER is the documented success response for DALI lighting commands
			// (e.g. DALI_SCENE, DALI_ARC_LEVEL, DALI_OFF): the controller has no data to
			// return but the command was processed. Kept for backwards compatibility
			// instead of OK. Failures surface as ERROR responses or timeouts.
			if (returnType === 'ok') {
				return true
			} else {
				return null
			}
		}
		case ZenResponseCode.ERROR: {
			if (response.data.length) {
				for (const entry of Object.entries(ZenErrorCode)) {
					if (entry[1] === response.data[0]) {
						throw new ZenResponseError(entry[0])
					}
				}
				throw new ZenResponseError(`Unknown error code: ${response.data[0].toString(16)}`)
			} else {
				// The ERROR response is used to mean "none", e.g. QUERY_DALI_DEVICE_LABEL
				return null
			}
		}
		default:
			throw new ZenResponseError(`Unknown response code: ${response.responseCode.toString(16)}`)
		}
	}

	async sendDynamicFrame(controller: ZenController, command: ZenCommand, data: number[], returnType: 'ok'): Promise<boolean | null>
	async sendDynamicFrame(controller: ZenController, command: ZenCommand, data: number[], returnType: 'bytes'): Promise<Buffer | null>
	async sendDynamicFrame(controller: ZenController, command: ZenCommand, data: number[], returnType: 'ok' | 'bytes'): Promise<boolean | Buffer | null> {
		// Calculate data length and prepend it to data
		const response = await this.sendPacket(controller, command, [data.length, ...data])

		// Check response type
		switch (response.responseCode) {
		case ZenResponseCode.OK:
			// Request processed successfully
			if (returnType === 'ok') {
				return true
			} else {
				return response.data
			}
		case ZenResponseCode.ANSWER:
			// Answer is in data bytes
			if (returnType === 'ok') {
				return true
			} else {
				return response.data
			}
		case ZenResponseCode.NO_ANSWER:
			// NO_ANSWER is the documented success response for DALI lighting commands
			// (kept by the controller for backwards compatibility instead of OK).
			// Failures surface as ERROR responses or timeouts.
			if (returnType === 'ok') {
				return true
			} else if (response.data.length) {
				throw new ZenResponseError(`No answer with code: ${response.data[0]}`)
			} else {
				return null
			}
		case ZenResponseCode.ERROR:
			if (response.data.length) {
				for (const entry of Object.entries(ZenErrorCode)) {
					if (entry[1] === response.data[0]) {
						throw new ZenResponseError(entry[0])
					}
				}
				throw new ZenResponseError(`Unknown error code: ${response.data[0].toString(16)}`)
			} else {
				// The ERROR response is used to mean "none", e.g. QUERY_DALI_DEVICE_LABEL
				return null
			}
		default:
			throw new ZenResponseError(`Unknown response code: ${response.responseCode.toString(16)}`)
		}
	}

	/** Send a DALI colour command. */
	async sendColour(controller: ZenController, command: ZenCommand, address: number, colour: ZenColour, level = 255): Promise<boolean> {
		if (level < 0 || level > 255) {
			throw new Error('Level must be between 0 and 255')
		}

		const result = await this.sendPacket(controller, command, [address, level, ...colour.toBytes()])
		switch (result.responseCode) {
		case ZenResponseCode.OK:
			return true
		case ZenResponseCode.NO_ANSWER:
			return false
		default:
			throw new ZenResponseError(`Unexpected response code: ${result.responseCode.toString(16)}`)
		}
	}

	// ============================
	// API COMMANDS
	// ============================

	/** Get the label for a DALI Group. Returns a string, or `null` if no label is set. */
	async queryGroupLabel(address: ZenAddress, genericIfNone = false): Promise<string | null> {
		const result = await this.sendBasicFrame(address.controller, 'QUERY_GROUP_LABEL', address.group(), [], 'str')
		return result || (genericIfNone ? `Group ${address.group()}` : null)
	}

	/** Query the label for a DALI device (control gear or control device). Returns a string, or `null` if no label is set. */
	async queryDaliDeviceLabel(address: ZenAddress, genericIfNone = false): Promise<string | null> {
		const result = await this.sendBasicFrame(address.controller, 'QUERY_DALI_DEVICE_LABEL', address.ecgOrEcd(), [], 'str')
		return result || (genericIfNone ? `Controller ${address.controller.id} ${address.type === ZenAddressType.ECG ? 'ECG' : 'ECD'} ${address.target}` : null)
	}

	/** Get the current TPI Event emitter state for a controller. Returns the active event mode flags, or `null` if the query fails. */
	async queryTpiEventEmitState(controller: ZenController): Promise<ZenEventMode | null> {
		const modeFlag = await this.sendBasicFrame(controller, 'QUERY_TPI_EVENT_EMIT_STATE', 0, [], 'int')
		if (modeFlag !== null) {
			return ZenEventMode.fromByte(modeFlag)
		} else {
			return null
		}
	}

	/** Allow specific events from an address/instance to be sent again. Events in mask will be unmuted. Returns true if filter was cleared successfully. */
	async clearTpiEventFilter(address: ZenAddress | ZenInstance, unfilter: ZenEventMask = ZenEventMask.allEvents()): Promise<boolean | null> {
		let instance_number = 0xff
		if (address instanceof ZenInstance) {
			instance_number = address.instance
			address = address.address
		}

		return this.sendBasicFrame(address.controller,
			'DALI_CLEAR_TPI_EVENT_FILTERS',
			address.ecgOrEcdOrBroadcast(),
			[ instance_number, unfilter.upper(), unfilter.lower() ],
			'bool',
		)
	}

	/** Enable or disable TPI Event emission. Returns `true` if successful, else `false`. */
	async tpiEventEmit(controller: ZenController, mode: ZenEventMode = new ZenEventMode({ enabled: true, filtering: false, unicast: false, multicast: true })): Promise<boolean> {
		const modeFlag = mode.bitmask()
		const result = await this.sendBasicFrame(controller, 'ENABLE_TPI_EVENT_EMIT', modeFlag, [], 'int')
		return (result === modeFlag)
	}

	/** Configure TPI Events for Unicast mode with IP and port as defined in the ZenController instance. */
	async setTpiEventUnicastAddress(controller: ZenController, ipaddr?: string, port: number = ZenConst.DEFAULT_UNICAST_PORT): Promise<boolean | null> {
		if (ipaddr !== undefined) {
			if (port < 0 || port > 65535) {
				throw new Error('Port must be between 0 and 65535')
			}

			const octets = ipaddr.split('.').map(str => Number(str))
			if (octets.length !== 4 || octets.some(octet => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
				throw new Error(`Address must be an IPv4 dotted-quad address, received ${ipaddr}`)
			}

			// Split port into upper and lower bytes
			const portUpper = (port >> 8) & 0xff
			const portLower = port & 0xff

			// Construct data payload: [port_upper, port_lower, ip1, ip2, ip3, ip4]
			const data = [portUpper, portLower, ...octets]
			return await this.sendDynamicFrame(controller, 'SET_TPI_EVENT_UNICAST_ADDRESS', data, 'ok')
		} else {
			return await this.sendDynamicFrame(controller, 'SET_TPI_EVENT_UNICAST_ADDRESS', [0,0,0,0,0,0], 'ok')
		}
	}

	/** Query a controller for groups. */
	async queryGroupNumbers(controller: ZenController): Promise<ZenAddress[]> {
		const groups = await this.sendBasicFrame(controller, 'QUERY_GROUP_NUMBERS', 0, [], 'list')
		if (!groups) {
			return []
		}

		return groups.sort((a, b) => a - b).map(group => new ZenAddress(controller, ZenAddressType.GROUP, group))
	}
    
	/** Set a DALI address (ECG, group, broadcast) to a colour. Returns `true` if command succeeded, `false` otherwise. */
	async daliColour(address: ZenAddress, colour: ZenColour, level = 255): Promise<boolean> {
		return this.sendColour(address.controller, 'DALI_COLOUR', address.ecgOrGroupOrBroadcast(), colour, level)
	}

	/** Query a DALI group for its occupancy status and level. Returns a tuple containing group number, occupancy status, and actual level.
	 * Returns `null` if the group is empty.
	*/
	async queryGroupByNumber(address: ZenAddress): Promise<{ group: number; occupancy: boolean; level: number} | null> {
		const result = await this.sendBasicFrame(address.controller, 'QUERY_GROUP_BY_NUMBER', address.group(), [], 'bytes')
		if (result) {
			if (result.length === 3) {
				return {
					group: result[0],
					occupancy: result[1] !== 0,
					level: result[2],
				}
			} else {
				throw new ZenResponseError(`Unexpected response length for QUERY_GROUP_BY_NUMBER: ${result.length}`)
			}
		} else {
			return null
		}
	}

	/** Query an address (ECG) for which DALI groups it belongs to. Returns a list of ZenAddress group instances. */
	async queryGroupMembershipByAddress(address: ZenAddress): Promise<ZenAddress[]> {
		const response = await this.sendBasicFrame(address.controller, 'QUERY_GROUP_MEMBERSHIP_BY_ADDRESS', address.ecg(), [], 'bytes')
		if (!response || response.length !== 2) {
			throw new ZenResponseError(`Unexpected response for QUERY_GROUP_MEMBERSHIP_BY_ADDRESS: ${response?.length}`)
		}

		const groups: number[] = []

		// Process high byte (groups 8-15)
		for (let i = 0; i < 8; i++) {
			if (response[0] & (1 << i)) {
				groups.push(i + 8)
			}
		}
		// Process low byte (groups 0-7)
		for (let i = 0; i < 8; i++) {
			if (response[1] & (1 << i)) {
				groups.push(i)
			}
		}

		// Process into ZenAddress instances
		return groups.sort((a, b) => a - b).map(group => new ZenAddress(address.controller, ZenAddressType.GROUP, group))
	}

	/** Query a DALI address (ECG) for the scene numbers it has levels programmed for. Returns a list of scene numbers. */
	async querySceneNumbersByAddress(address: ZenAddress): Promise<number[]> {
		const response = await this.sendBasicFrame(address.controller, 'QUERY_SCENE_NUMBERS_BY_ADDRESS', address.ecg(), [], 'list')
		return response ?? []
	}

	/** Query a DALI address (ECG) for its programmed level in each of the 16 DALI scenes. Returns 16 entries where `null` means the address is not part of that scene. */
	async querySceneLevelsByAddress(address: ZenAddress): Promise<(number | null)[]> {
		const response = await this.sendBasicFrame(address.controller, 'QUERY_SCENE_LEVELS_BY_ADDRESS', address.ecg(), [], 'list')
		if (response) {
			return response.map(level => level === 255 ? null : level)
		} else {
			return new Array(16).fill(null)
		}
	}

	/** Query which DALI scenes are associated with a given group number. Returns list of scene numbers. */
	async querySceneNumbersForGroup(group: ZenAddress): Promise<number[]> {
		const response = await this.sendBasicFrame(group.controller, 'QUERY_SCENE_NUMBERS_FOR_GROUP', group.group(), [], 'bytes')
		if (!response || response.length !== 2) {
			throw new ZenResponseError(`Unexpected response for QUERY_SCENE_NUMBERS_FOR_GROUP: ${response?.length}`)
		}

		const scenes: number[] = []
		
		// Process high byte (scenes 8-15)
		for (let i = 0; i < 8; i++) {
			if (response[0] & (1 << i)) {
				scenes.push(i + 8)
			}
		}
		// Process low byte (scenes 0-7)
		for (let i = 0; i < 8; i++) {
			if (response[1] & (1 << i)) {
				scenes.push(i)
			}
		}

		return scenes.sort((a, b) => a - b)
	}

	/** Query the label for a scene (0-12) and group number combination. Returns string, or `null` if no label is set. */
	async querySceneLabelForGroup(group: ZenAddress, scene: number, genericIfNone = false): Promise<string | null> {
		if (scene < 0 || scene > ZenConst.MAX_SCENE) {
			throw new Error(`Scene must be between 0 and ${ZenConst.MAX_SCENE}`)
		}

		const label = await this.sendBasicFrame(group.controller, 'QUERY_SCENE_LABEL_FOR_GROUP', group.group(), [scene], 'str')
		if (label) {
			return label
		} else if (genericIfNone) {
			return `Scene ${scene}`
		} else {
			return null
		}
	}

	/** Compound command to query the labels for all scenes for a group. Returns list of scene labels, where `null` indicates no label is set. */
	async queryScenesForGroup(group: ZenAddress, genericIfNone = false): Promise<ZenScene[] | null> {
		const scenes = await this.querySceneNumbersForGroup(group)
		if (!scenes) {
			return null
		}

		// Controllers can report DALI scenes 13-15 in the bitmask, which have no user scene labels
		const userScenes = scenes.filter(scene => scene <= ZenConst.MAX_SCENE)

		const result: ZenScene[] = []
		for (const scene of userScenes) {
			const label = await this.querySceneLabelForGroup(group, scene, genericIfNone)
			result.push(new ZenScene(group, scene, label))
		}
		return result
	}

	/** Query the controller's version number. */
	async queryControllerVersionNumber(controller: ZenController): Promise<string> {
		const response = await this.sendBasicFrame(controller, 'QUERY_CONTROLLER_VERSION_NUMBER', 0, [], 'bytes')
		if (response && response.length === 3) {
			return `${response[0]}.${response[1]}.${response[2]}`
		} else {
			throw new ZenResponseError(`Unexpected response for QUERY_CONTROLLER_VERSION_NUMBER: ${response?.length}`)
		}
	}

	/** Query which DALI control gear addresses are present in the database. Returns a list of ZenAddress instances. */
	async queryControlGearDaliAddresses(controller: ZenController): Promise<ZenAddress[]> {
		const response = await this.sendBasicFrame(controller, 'QUERY_CONTROL_GEAR_DALI_ADDRESSES', 0, [], 'bytes')
		if (!response || response.length !== 8) {
			throw new ZenResponseError(`Unexpected response for QUERY_CONTROL_GEAR_DALI_ADDRESSES: ${response?.length}`)
		}

		const addresses: ZenAddress[] = []

		// Process each byte which represents 8 addresses
		for (let index = 0; index < response.length; index++) {
			const byteValue = response[index]

			// Check each bit in the byte
			for (let i = 0; i < 8; i++) {
				if (byteValue & (1 << i)) {
					// Calculate actual address from byte and bit position
					addresses.push(new ZenAddress(controller, ZenAddressType.ECG, index * 8 + i))
				}
			}
		}

		return addresses
	}

	/** Inhibit sensors from changing a DALI address (ECG or group or broadcast) for specified time in seconds (0-65535). Returns `true` if acknowledged, else `false`. */
	async daliInhibit(address: ZenAddress, timeSeconds: number): Promise<boolean> {
		const timeHi = (timeSeconds >> 8) & 0xff // Convert time to 16-bit value
		const timeLo = (timeSeconds & 0xff)
		return !!await this.sendBasicFrame(address.controller, 'DALI_INHIBIT', address.ecgOrGroupOrBroadcast(), [0x00, timeHi, timeLo], 'ok')
	}

	/** Send RECALL SCENE (0-12) to an address (ECG or group or broadcast). Returns `true` if acknowledged, else `false`. */
	async daliScene(address: ZenAddress, scene: number): Promise<boolean> {
		if (scene < 0 || scene > ZenConst.MAX_SCENE) {
			throw new Error(`Scene must be between 0 and ${ZenConst.MAX_SCENE}`)
		}

		return !!await this.sendBasicFrame(address.controller, 'DALI_SCENE', address.ecgOrGroupOrBroadcast(), [0x00, 0x00, scene], 'ok')
	}

	/** Send DIRECT ARC level (0-254) to an address (ECG or group or broadcast). Will fade to the new level. Returns `true` if acknowledged, else `false`. */
	async daliArcLevel(address: ZenAddress, level: number): Promise<boolean> {
		if (level < 0 || level > ZenConst.MAX_LEVEL) {
			throw new Error(`Level must be between 0 and ${ZenConst.MAX_LEVEL}, got ${level}`)
		}
		return !!await this.sendBasicFrame(address.controller, 'DALI_ARC_LEVEL', address.ecgOrGroupOrBroadcast(), [0x00, 0x00, level], 'ok')
	}

	/** Send RECALL MAX to an address (ECG or group or broadcast). No fade. Returns `true` if acknowledged, else `false`. */
	async daliRecallMax(address: ZenAddress): Promise<boolean> {
		return !!await this.sendBasicFrame(address.controller, 'DALI_RECALL_MAX', address.ecgOrGroupOrBroadcast(), [], 'ok')
	}

	/** Send RECALL MIN to an address (ECG or group or broadcast). No fade. Returns `true` if acknowledged, else `false`. */
	async daliRecallMin(address: ZenAddress): Promise<boolean> {
		return !!await this.sendBasicFrame(address.controller, 'DALI_RECALL_MIN', address.ecgOrGroupOrBroadcast(), [], 'ok')
	}

	/** Send OFF to an address (ECG or group or broadcast). No fade. Returns `true` if acknowledged, else `false`. */
	async daliOff(address: ZenAddress): Promise<boolean> {
		return !!await this.sendBasicFrame(address.controller, 'DALI_OFF', address.ecgOrGroupOrBroadcast(), [], 'ok')
	}

	/** Query the Arc Level for a DALI address (ECG or group). Returns arc level as int, or `null` if mixed levels. */
	async daliQueryLevel(address: ZenAddress): Promise<number | null> {
		const result = await this.sendBasicFrame(address.controller, 'DALI_QUERY_LEVEL', address.ecgOrGroup(), [], 'int')
		if (result === 255) {
			return null // 255 indicates mixed levels
		} else {
			return result
		}
	}

	/**
	 * Query device type information for a DALI address (ECG).
	 * 
	 * Returns an array of device types that the control gear belongs to, or an empty array if the device
	 * doesn't exist.
	 */
	async daliQueryCgType(address: ZenAddress): Promise<ZenControlGearType[]> {
		const response = await this.sendBasicFrame(address.controller, 'DALI_QUERY_CG_TYPE', address.ecg(), [], 'bytes')
		if (!response || response.length !== 4) {
			throw new ZenResponseError(`Unexpected response for DALI_QUERY_CG_TYPE: ${response?.length}`)
		}

		const result: ZenControlGearType[] = []
		// Process each byte which represents 8 device types
		for (let i = 0; i < 4; i++) {
			const byteValue = response[i]
			for (let j = 0; j < 8; j++) {
				if (byteValue & (1 << j)) {
					// Calculate actual device type number
					const deviceType = i * 8 + j
					result.push(deviceType as ZenControlGearType)
				}
			}
		}
		return result
	}

	/**
	 * Begin a DALI Direct Arc Power Control (DAPC) Sequence.
	 * 
	 * DAPC allows overriding of the fade rate for immediate level setting. The sequence
	 * continues for 250ms. If no arc levels are received within 250ms, the sequence ends
	 * and normal fade rates resume.
	 * 
	 * Returns `true` if successful, `false` if failed.
	 */
	async daliEnableDAPCSequence(address: ZenAddress): Promise<boolean> {
		return !!await this.sendBasicFrame(address.controller, 'DALI_ENABLE_DAPC_SEQ', address.ecgOrGroupOrBroadcast(), [], 'ok')
	}

	/** Query a DALI address (ECG or ECD) for its Serial Number. Returns a hex string representation of the serial number. */
	async queryDaliSerial(address: ZenAddress): Promise<string> {
		const response = await this.sendBasicFrame(address.controller, 'QUERY_DALI_SERIAL', address.ecgOrEcd(), [], 'bytes')
		if (!response || response.length !== 8) {
			throw new ZenResponseError(`Unexpected response for QUERY_DALI_SERIAL: ${response?.length}`)
		}

		let result = ''
		for (let i = 0; i < 8; i++) {
			let hex = response[i].toString(16)
			while (hex.length < 2) {
				hex = `0${hex}`
			}
			result += hex
		}
		return result
	}

	/** Set a system variable (0-147) value (-32768-32767) on the controller. Returns `true` if successful, else `false`. */
	async setSystemVariable(controller: ZenController, variable: number, value: number): Promise<boolean> {
		if (variable < 0 || variable > ZenConst.MAX_SYSVAR) {
			throw new Error(`Variable number must be between 0 and ${ZenConst.MAX_SYSVAR}, received ${variable}`)
		}
		if (value < -32768 || value > 32767) {
			throw new Error(`Value must be between -32768 and 32767, received ${value}`)
		}

		const buffer = Buffer.alloc(2)
		buffer.writeInt16BE(value)

		/* NB: we need to left-pad our buffer to 3 bytes as we are big endian */
		return !!(await this.sendBasicFrame(controller, 'SET_SYSTEM_VARIABLE', variable, [0, ...buffer], 'ok'))
	}

	/** Query the controller for the value of a system variable (0-147). Returns the variable's value (-32768-32767) if successful
	 * and if the variable has a value, else `null`. Note that a value of -1 (0xFFFF) is indistinguishable from an unset
	 * variable in this legacy command, and is also read as `null`. */
	async querySystemVariable(controller: ZenController, variable: number): Promise<number | null> {
		if (variable < 0 || variable > ZenConst.MAX_SYSVAR) {
			throw new Error(`Variable number must be between 0 and ${ZenConst.MAX_SYSVAR}, received ${variable}`)
		}

		const response = await this.sendBasicFrame(controller, 'QUERY_SYSTEM_VARIABLE', variable, [], 'bytes')
		if (response && response.length === 2) {
			const raw = (response[0] << 8) | (response[1] & 0xff)
			if (raw !== 65535) {
				/* System variables are signed, see https://support.zencontrol.com/hc/en-us/articles/360000741316-What-is-a-system-address-variable */
				return response.readInt16BE(0)
			} else {
				/* 65535 represents an unused system variable in this legacy API, see https://support.zencontrol.com/hc/en-us/articles/360000741316-What-is-a-system-address-variable */
				return null
			}
		} else {
			return null
		}
	}

	/** Query the name of a system variable (0-147). Returns the variable's name, or `null` if query fails. */
	async querySystemVariableName(controller: ZenController, variable: number): Promise<string | null> {
		if (variable < 0 || variable > ZenConst.MAX_SYSVAR) {
			throw new Error(`Variable number must be between 0 and ${ZenConst.MAX_SYSVAR}, received ${variable}`)
		}

		return await this.sendBasicFrame(controller, 'QUERY_SYSTEM_VARIABLE_NAME', variable, [], 'str')
	}

	setCallbacks(callbacks: Partial<ZenProtocol>) {
		Object.assign(this, callbacks)
	}

	async startEventMonitoring(): Promise<void> {
		/* Cancel any pending restart so overlapping restarts can't stack */
		if (this.eventRestartTimer) {
			clearTimeout(this.eventRestartTimer)
			this.eventRestartTimer = undefined
		}

		/* Close any existing event socket before creating a new one */
		const existingSocket = this.eventSocket
		if (existingSocket) {
			this.eventSocket = null
			try {
				existingSocket.close()
			} catch {
				/* Socket may already be closed (e.g. after an error event) */
			}
		}

		const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })
		socket.on('error', (err) => {
			this.logger.warn(`Event socket error: ${err}`)
			socket.close()
		})
		if (this.unicast) {
			const setupControllers = async() => {
				const port = socket.address().port
				for (const controller of this.controllers) {
					const address = this.listenIp !== '0.0.0.0' ? this.listenIp : hostAddressFor(controller.host)
					if (address) {
						this.logger.debug(`Setting unicast address on controller ${controller.host} to address ${address}:${port}`)
						await this.setTpiEventUnicastAddress(controller, address, port)
						this.logger.debug(`Setting unicast event mode on controller ${controller.host}`)
						const result = await this.tpiEventEmit(controller, new ZenEventMode({ enabled: true, filtering: false, unicast: true, multicast: true }))
						if (!result) {
							this.logger.warn(`Controller failed to activate unicast event emit: ${controller.host}`)
						}
					} else {
						this.logger.warn(`Failed to setup controller for unicast as cannot find local address to reach it: ${controller.host}`)
					}
				}
			}
			socket.bind(this.listenPort, this.listenIp, () => {
				setupControllers().catch((reason) => {
					this.logger.warn(`Failed to setup controllers for unicast: ${reason}`)
				})
			})
			
		} else {
			const setupControllers = async () => {
				for (const controller of this.controllers) {
					this.logger.debug(`Disabling unicast on controller ${controller.host}`)
					await this.setTpiEventUnicastAddress(controller)
					this.logger.debug(`Setting multicast event mode on controller ${controller.host}`)
					const result = await this.tpiEventEmit(controller, new ZenEventMode({ enabled: true, filtering: false, unicast: false, multicast: true }))
					if (!result) {
						this.logger.warn(`Controller failed to activate multicast event emit: ${controller.host}`)
					}
				}
			}
			
			socket.bind(ZenConst.MULTICAST_PORT, () => {
				try {
					if (this.listenIp && this.listenIp !== '0.0.0.0') {
						socket.addMembership(ZenConst.MULTICAST_GROUP, this.listenIp)
					} else {
						socket.addMembership(ZenConst.MULTICAST_GROUP)
					}
				} catch (error) {
					/* Throwing from a bind callback would crash the process; close the
					   socket instead so the close handler schedules a restart with backoff */
					this.logger.warn(`Failed to join multicast group ${ZenConst.MULTICAST_GROUP}: ${error instanceof Error ? error.message : error}`)
					socket.close()
					return
				}

				setupControllers().catch((reason) => {
					this.logger.warn(`Failed to setup controllers for multicast: ${reason}`)
				})
			})
		}
		socket.on('message', (msg: Buffer, rinfo: RemoteInfo) => {
			try {
				this._handleEventPacket(msg, rinfo)
			} catch (error) {
				this.logger.warn(`Failed to handle event packet from ${rinfo.address}:${rinfo.port}: ${error instanceof Error ? error.message : error}`)
			}
		})
		socket.on('close', () => {
			/* Only react if this socket is still the active one; a socket closed
			   deliberately by a restart or stop has already been replaced or cleared. */
			if (this.eventSocket === socket) {
				this._handleEventClose()
			}
		})
		this.eventSocket = socket

		if (this.checkEventMonitoringInterval) {
			clearInterval(this.checkEventMonitoringInterval)
		}
		this.checkEventMonitoringInterval = setInterval(() => {
			this._checkEventMonitoring().catch((error) => {
				this.logger.warn(`Event monitoring health check failed: ${error instanceof Error ? error.message : error}`)
			})
		}, 1000 * 60 * 10)
	}

	async stopEventMonitoring(): Promise<void> {
		if (this.checkEventMonitoringInterval) {
			clearInterval(this.checkEventMonitoringInterval)
			this.checkEventMonitoringInterval = undefined
		}

		if (this.eventRestartTimer) {
			clearTimeout(this.eventRestartTimer)
			this.eventRestartTimer = undefined
		}

		if (this.unicast) {
			for (const controller of this.controllers) {
				try {
					await this.setTpiEventUnicastAddress(controller)
				} catch (error) {
					this.logger.warn(`Failed to clear unicast address on controller ${controller.host}: ${error instanceof Error ? error.message : error}`)
				}
			}
		}

		const eventSocket = this.eventSocket
		if (eventSocket) {
			this.eventSocket = null
			eventSocket.close()
		}
	}

	private async _checkEventMonitoring() {
		const states = await Promise.all(this.controllers.map(controller => this.queryTpiEventEmitState(controller).catch(() => null)))

		const expectMulticast = !this.unicast

		const problem = states.some(state => state === null || !state.enabled || (expectMulticast && state.multicast !== expectMulticast) || (this.unicast && !state.unicast))
		if (problem) {
			this.logger.info('Restarting event monitoring as check reveals controller emit state has changed')
			this.startEventMonitoring().catch((error) => {
				this.logger.warn(`Failed to restart event monitoring: ${error instanceof Error ? error.message : error}`)
			})
		} else {
			this.logger.debug('Checked controller event monitoring states: OK')
		}
	}

	private _handleEventClose(): void {
		if (this.eventSocket) {
			this.logger.warn(`Event socket closed unexpectedly, restarting event monitoring in ${this.eventRestartDelay}ms`)
			this.eventRestartTimer = setTimeout(() => {
				this.startEventMonitoring().catch((error) => {
					this.logger.warn(`Failed to restart event monitoring: ${error instanceof Error ? error.message : error}`)
				})
			}, this.eventRestartDelay)
			this.eventRestartDelay = Math.min(this.eventRestartDelay * 2, 60000)
		}
	}

	private _handleEventPacket(packet: Buffer, rinfo: RemoteInfo): void {
		if (packet.length < 2) {
			this.logger.warn(`Invalid event packet from ${rinfo.address}:${rinfo.port}: too short ${packet.length}`)
			return
		}
		if (packet[0] !== 0x5a || packet[1] !== 0x43) {
			this.logger.warn(`Invalid event packet from ${rinfo.address}:${rinfo.port}: invalid magic bytes ${packet[0].toString(16)}${packet[1].toString(16)}`)
			return
		}

		// Extract packet fields
		const macBytes = packet.subarray(2, 8)
		const macAddress = [...macBytes].map(b => b.toString(16).padStart(2, '0')).join(':')
		const target = (packet[8] & 0xff) << 8 | packet[9] & 0xff
		const eventCode = packet[10]
		const payloadLen = packet[11]
		const payload = packet.subarray(12, packet.length - 1)
		const receivedChecksum = packet[packet.length - 1]

		if (payloadLen !== payload.length) {
			this.logger.warn(`Invalid payload length for event packet from ${rinfo.address}:${rinfo.port}`)
		}

		if (this.checksumBuffer(packet.subarray(0, -1)) !== receivedChecksum) {
			this.logger.warn(`Checksum mismatch for event packet from ${rinfo.address}:${rinfo.port}`)
			return
		}

		this.eventRestartDelay = 1000

		const controller = this._findController(macAddress)
		if (!controller) {
			this.logger.warn(`Failed to find controller with MAC address ${macAddress} for event packet from ${rinfo.address}:${rinfo.port}`)
			return
		}

		switch (eventCode) {
		case ZenEventType.BUTTON_PRESS_EVENT:
			// Button Press - Button has been pressed
			if (this.buttonPressCallback) {
				const instance = new ZenInstance(new ZenAddress(controller, ZenAddressType.ECD, target - 64), ZenInstanceType.PUSH_BUTTON, payload[0])
				try {
					this.buttonPressCallback(instance)
				} catch (error) {
					this.logger.warn(`Change callback failed for button press event from ${rinfo.address}:${rinfo.port} for ${instance}: ${error instanceof Error ? error.message : error}`)
				}
			}
			break
		case ZenEventType.BUTTON_HOLD_EVENT:
			// Button Hold - Button has been pressed and is being held down
			if (this.buttonHoldCallback) {
				const instance = new ZenInstance(new ZenAddress(controller, ZenAddressType.ECD, target - 64), ZenInstanceType.PUSH_BUTTON, payload[0])
				try {
					this.buttonHoldCallback(instance)
				} catch (error) {
					this.logger.warn(`Change callback failed for button hold event from ${rinfo.address}:${rinfo.port} for ${instance}: ${error instanceof Error ? error.message : error}`)
				}
			}
			break
		case ZenEventType.ABSOLUTE_INPUT_EVENT:
			// Absolute Input - Absolute input has changed
			if (this.absoluteInputCallback) {
				const value = ((payload[1] & 0xff) << 8) | (payload[2] & 0xff)
				const instance = new ZenInstance(new ZenAddress(controller, ZenAddressType.ECD, target - 64), ZenInstanceType.ABSOLUTE_INPUT, payload[0])
				try {
					this.absoluteInputCallback(instance, value)
				} catch (error) {
					this.logger.warn(`Change callback failed for absolute input change event from ${rinfo.address}:${rinfo.port} for ${instance}: ${error instanceof Error ? error.message : error}`)
				}
			}
			break
		case ZenEventType.LEVEL_CHANGE_EVENT:
			// Level Change - Arc Level on an Address target has changed
			if (this.levelChangeCallback) {
				const address = new ZenAddress(controller, ZenAddressType.ECG, target)
				try {
					this.levelChangeCallback(address, payload[0])
				} catch (error) {
					this.logger.warn(`Change callback failed for level change event from ${rinfo.address}:${rinfo.port} for ${address}: ${error instanceof Error ? error.message : error}`)
				}
			}
			break
		case ZenEventType.GROUP_LEVEL_CHANGE_EVENT:
			// Group Level Change - Arc Level on a Group target has changed	
			if (this.groupLevelChangeCallback) {
				const address = new ZenAddress(controller, ZenAddressType.GROUP, target)
				try {
					this.groupLevelChangeCallback(address, payload[0])
				} catch (error) {
					this.logger.warn(`Change callback failed for group level change event from ${rinfo.address}:${rinfo.port} for ${address}: ${error instanceof Error ? error.message : error}`)
				}
			}
			break
		case ZenEventType.SCENE_CHANGE_EVENT:
			// Scene Change - Scene has been recalled	
			if (this.sceneChangeCallback) {
				if (target <= 63) {
					const address = new ZenAddress(controller, ZenAddressType.ECG, target)
					try {
						this.sceneChangeCallback(address, payload[0])
					} catch (error) {
						this.logger.warn(`Change callback failed for scene change event from ${rinfo.address}:${rinfo.port} for ${address}: ${error instanceof Error ? error.message : error}`)
					}
				} else if (64 <= target && target <= 79) {
					const address = new ZenAddress(controller, ZenAddressType.GROUP, target - 64)
					try {
						this.sceneChangeCallback(address, payload[0])
					} catch (error) {
						this.logger.warn(`Change callback failed for scene change event from ${rinfo.address}:${rinfo.port} for ${address}: ${error instanceof Error ? error.message : error}`)
					}
				} else {
					this.logger.warn(`Invalid scene change event target from ${rinfo.address}:${rinfo.port}: ${target}`)
				}
			}
			break
		case ZenEventType.OCCUPANCY_EVENT:
			// Is Occupied - An occupancy sensor has been triggered, area is occupied
			if (this.occupancyCallback) {
				const instance = new ZenInstance(new ZenAddress(controller, ZenAddressType.ECD, target - 64), ZenInstanceType.OCCUPANCY_SENSOR, payload[0])
				try {
					this.occupancyCallback(instance)
				} catch (error) {
					this.logger.warn(`Change callback failed for occupancy change event from ${rinfo.address}:${rinfo.port} for ${instance}: ${error instanceof Error ? error.message : error}`)
				}
			}
			break
		case ZenEventType.SYSTEM_VARIABLE_CHANGED_EVENT:
			// System Variable Change - A system variable has changed
			if (this.systemVariableChangeCallback) {
				if (target < 0 || target > ZenConst.MAX_SYSVAR) {
					this.logger.warn(`Invalid system variable change event from ${rinfo.address}:${rinfo.port}: ${target}`)
				} else {
					const rawValue = payload.readInt32BE(0)
					const magnitude = payload.readInt8(4)

					const value = rawValue * Math.pow(10, magnitude)
					// this.logger.debug(`Received system variable ${controller.id}.${target} change event with rawValue ${rawValue} and magnitude ${magnitude}, equals ${value}`)

					try {
						this.systemVariableChangeCallback(controller, target, value)
					} catch (error) {
						this.logger.warn(`Change callback failed for system variable change event from ${rinfo.address}:${rinfo.port} for ${target}: ${error instanceof Error ? error.message : error}`)
					}
				}
			}
			break
		case ZenEventType.COLOUR_CHANGED_EVENT:
			// Colour Change - A Tc, RGBWAF or XY colour change has occurred	
			if (this.colourChangeCallback) {
				let colour: ZenColour
				try {
					colour = ZenColour.fromBytes(payload)
				} catch (error) {
					this.logger.warn(`Invalid colour change event from ${rinfo.address}:${rinfo.port}: ${target}: ${error instanceof Error ? error.message : error}`)
					return
				}

				let address: ZenAddress
				if (target < 64) {
					address = new ZenAddress(controller, ZenAddressType.ECG, target)
				} else if (target >= 64 && target <= 79) {
					address = new ZenAddress(controller, ZenAddressType.GROUP, target - 64)
				} else if (target >= 128 && target <= 143) {
					address = new ZenAddress(controller, ZenAddressType.GROUP, target - 128)
					this.logger.warn(`Colour change callback received with target=${target}. Assumed to be group ${target - 128}.`)
				} else {
					this.logger.warn(`Colour change callback received with unsupported target: ${target}`)
					return
				}

				try {
					this.colourChangeCallback(address, colour)
				} catch (error) {
					this.logger.warn(`Change callback failed for colour change event from ${rinfo.address}:${rinfo.port} for ${address}: ${error instanceof Error ? error.message : error}`)
				}
			}
			break
		case ZenEventType.PROFILE_CHANGED_EVENT:
			// Profile Change - The active profile on the controller has changed	
			if (this.profileChangeCallback) {
				const profile = (payload[0] & 0xff) << 8 | (payload[1] & 0xff)
				try {
					this.profileChangeCallback(controller, profile)
				} catch (error) {
					this.logger.warn(`Change callback failed for profile change event from ${rinfo.address}:${rinfo.port} for profile ${profile}: ${error instanceof Error ? error.message : error}`)
				}
			}
			break
		case ZenEventType.GROUP_OCCUPANCY_EVENT:
			// A sensor targeting a group has detected motion
			if (this.groupOccupancyCallback) {
				const address = new ZenAddress(controller, ZenAddressType.GROUP, target - 64)
				try {
					this.groupOccupancyCallback(address, payload[1] !== 0)
				} catch (error) {
					this.logger.warn(`Change callback failed for group occupancy event from ${rinfo.address}:${rinfo.port} for ${address}: ${error instanceof Error ? error.message : error}`)
				}
			}
			break
		case ZenEventType.LEVEL_CHANGE_EVENT_V2:
			// Arc Level of address/group plus if/where it is dimming to
			if (this.levelChangeV2Callback) {
				const address = target < 64 ? new ZenAddress(controller, ZenAddressType.ECG, target) : new ZenAddress(controller, ZenAddressType.GROUP, target - 64)
				try {
					this.levelChangeV2Callback(address, payload[0], payload[1])
				} catch (error) {
					this.logger.warn(`Change callback failed for level change v2 event from ${rinfo.address}:${rinfo.port} for ${address}: ${error instanceof Error ? error.message : error}`)
				}
			}
			break
		default:
			this.logger.warn(`Received unknown event type from ${rinfo.address}:${rinfo.port}: ${eventCode}`)
			break
		}
	}

	_findController(macAddress: string): ZenController | undefined {
		return this.controllers.find(controller => macAddress.toLowerCase().replaceAll(':', '') === controller.macAddress?.toLowerCase().replaceAll(':', ''))
	}
}
