import dgram, { RemoteInfo } from 'node:dgram'
import os from 'node:os'
import { log, warn } from 'node:console'
import { CMD, ZenCommand } from './zen-commands.js'
import { ZenError, ZenErrorCode, ZenResponseError, ZenTimeoutError } from './zen-errors.js'
import { ZenController } from './zen-controller.js'
import { ZenInstance, ZenInstanceType } from './zen-instance.js'
import { ZenAddress, ZenAddressType } from './zen-address.js'
import { ZenColour } from './zen-colour.js'
import { ZenConst } from './zen-const.js'
import { ZenEventMode, ZenEventType } from './zen-events.js'

export interface ZenProtocolOptions {
	unicast?: boolean
	listenIp?: string
	listenPort?: number
	responseTimeout?: number
	controllers?: ZenController[]
	maxRequestsPerController?: number
	maxRetries?: number
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
	private listenIp?: string
	private listenPort?: number
	private responseTimeout: number

	private nextSeq = 0
	private commandSocket: dgram.Socket
	private eventSocket: dgram.Socket | null = null

	/** Used to match events to controllers, and include controller objects in callbacks */
	public controllers: ZenController[]
	public maxRequestsPerController: number
	public maxRetries: number

	private waiting: Record<number, (() => void)[]> = {}
	private activeRequests: Record<number, number> = {}

	public buttonPressCallback?: (instance: ZenInstance) => void
	public buttonHoldCallback?: (instance: ZenInstance) => void
	public absoluteInputCallback?: (instance: ZenInstance, value: number) => void
	public levelChangeCallback?: (address: ZenAddress, arcLevel: number) => void
	public groupLevelChangeCallback?: (address: ZenAddress, arcLevel: number) => void
	public sceneChangeCallback?: (address: ZenAddress, scene: number) => void
	public occupancyCallback?: (instance: ZenInstance) => void
	public systemVariableChangeCallback?: (controller: ZenController, target: number, value: number) => void
	public colourChangeCallback?: (address: ZenAddress, colour: ZenColour | null) => void
	public profileChangeCallback?: (controller: ZenController, profile: number) => void

	private localIp?: string
	private requestsBySeq: ZenRequestPromise[] = []

	constructor(opts: ZenProtocolOptions = {}) {
		this.unicast = opts.unicast ?? false
		this.listenIp = this.unicast ? opts.listenIp ?? '0.0.0.0' : undefined
		this.listenPort = this.unicast ? opts.listenPort ?? ZenConst.DEFAULT_UNICAST_PORT : undefined
		this.responseTimeout = opts.responseTimeout ?? ZenConst.RESPONSE_TIMEOUT
		this.controllers = opts.controllers || []
		this.maxRequestsPerController = opts.maxRequestsPerController || ZenConst.DEFAULT_MAX_REQUESTS_PER_CONTROLLER
		this.maxRetries = opts.maxRetries ?? ZenConst.DEFAULT_MAX_RETRIES

		// If unicast, and we're binding to 0.0.0.0, we still need to know our actual IP address
		if (this.unicast) {
			this.localIp = this.resolveLocalIp()
		}

		this.commandSocket = dgram.createSocket('udp4')
		this.commandSocket.on('message', (msg: Buffer, rinfo: RemoteInfo) => {
			if (msg.length < 4) {
				warn(`Received invalid message: too short from ${rinfo.address}:${rinfo.port}`)
				return
			}

			const responseCode = msg[0]
			const seq = msg[1]
			const dataLength = msg[2]

			const request = this.requestsBySeq[seq]
			if (!request) {
				warn(`Received message with unknown sequence number (${seq}) from ${rinfo.address}:${rinfo.port}`)
				return
			}

			delete this.requestsBySeq[seq]

			if (request.timeout) {
				clearTimeout(request.timeout)
			}

			this.finishActiveRequest(request.controller)

			const responseChecksum = msg[msg.length - 1]
			const expectedChecksum = this.checksumBuffer(msg.subarray(0, msg.length - 1))
			if (responseChecksum !== expectedChecksum) {
				request.reject(new ZenResponseError(`Invalid checksum: expected ${expectedChecksum} received ${responseChecksum} from ${rinfo.address}:${rinfo.port}`))
				return
			}

			const expectedLength = 4 + dataLength // type + seq + len + data + checksum
			if (msg.length !== expectedLength) {
				request.reject(new ZenResponseError(`Length mismatch: expected ${expectedLength} received ${msg.length} from ${rinfo.address}:${rinfo.port}`))
				return
			}

			if (dataLength) {
				const responseData = msg.subarray(3, msg.length - 1)

				request.resolve({ responseCode, data: responseData })
			} else {
				request.resolve({ responseCode, data: Buffer.of() })
			}
		})
	}

	private finishActiveRequest(controller: ZenController): void {
		this.activeRequests[controller.id]--

		const waitingFunc = this.waiting[controller.id]?.shift()
		if (waitingFunc) {
			/* Wait up one waiting request */
			waitingFunc()
		}
	}

	private resolveLocalIp(): string {
		const interfaces = os.networkInterfaces()
		for (const name of Object.keys(interfaces)) {
			for (const iface of interfaces[name] ?? []) {
				if (iface.family === 'IPv4' && !iface.internal) {
					return iface.address
				}
			}
		}
		return '127.0.0.1'
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

		const activeRequests = this.activeRequests[controller.id]
		if (activeRequests === undefined) {
			this.activeRequests[controller.id] = 0
		}

		if (activeRequests >= this.maxRequestsPerController) {
			/* Wait for another request to finish */
			await new Promise<void>((resolve) => {
				if (!this.waiting[controller.id]) {
					this.waiting[controller.id] = []
				}
				this.waiting[controller.id].push(resolve)
			})
		}
		
		this.activeRequests[controller.id]++

		let seq = this.nextSeq++ % 256
		let seqLoops = 0
		const originalSeq = seq
		
		while (this.requestsBySeq[seq]) {
			seq = (seq + 1) % 256
			if (seq === originalSeq) {
				seqLoops++

				/* We've looped looking for a free sequence number */
				if (seqLoops < 4) {
					warn('No free sequence numbers for message. Waiting for a sequence number.')
					await delay(Math.pow(10, seqLoops))
				} else {
					warn('Failed to find a free sequence number for message.')
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
				if (err) {
					warn(`Failed to send message to ${controller.host}:${controller.port}`, err)

					delete this.requestsBySeq[seq]
					this.finishActiveRequest(controller)
					reject(err)
				} else {
					const timeout = () => {
						retries++

						if (retries >= this.maxRetries) {
							warn(`Failed to send message to ${controller.host}:${controller.port}: too many retries (${retries})`)

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
	async sendBasicFrame(controller: ZenController, command: ZenCommand, address: number, data: number[], returnType: 'bytes'): Promise<Buffer>
	async sendBasicFrame(controller: ZenController, command: ZenCommand, address: number, data: number[], returnType: 'int'): Promise<number | null>
	async sendBasicFrame(controller: ZenController, command: ZenCommand, address: number, data: number[], returnType: 'bool'): Promise<boolean | null>
	async sendBasicFrame(controller: ZenController, command: ZenCommand, address: number, data: number[], returnType: 'ok'): Promise<boolean | null>
	async sendBasicFrame(controller: ZenController, command: ZenCommand, address: number, data: number[], returnType: 'list'): Promise<number[] | null>
	async sendBasicFrame(controller: ZenController, command: ZenCommand, address: number, data: number[], returnType: 'str' | 'bytes' | 'int' | 'bool' | 'ok' | 'list'): Promise<string | Buffer | number | boolean | number[] | null> {
		if (data.length > 3) {
			throw new Error('data must be 0-3 bytes')
		}
		// Pad data to 3 bytes
		while (data.length < 3) {
			data.push(0)
		}

		const response = await this.sendPacket(controller, command, [address, ...data])

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
			if (returnType === 'ok') {
				return false
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
			if (returnType === 'ok') {
				return false
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

	    // def _send_dynamic(self, controller: ZenController, command: int, data: list[int]) -> Optional[bytes]:
	// # Calculate data length and prepend it to data
	// response_data, response_code = self._send_packet_retry_and_cache(controller, command, [len(data)] + data)
	// # Check response type
	// match response_code:
	//     case 0xA0: # OK
	//         pass  # Request processed successfully
	//     case 0xA1: # ANSWER
	//         pass  # Answer is in data bytes
	//     case 0xA2: # NO_ANSWER
	//         if response_data > 0:
	//             if self.narration: print(f"No answer with code: {response_data}")
	//         return None
	//     case 0xA3: # ERROR
	//         if response_data:
	//             error_code = ZenErrorCode(response_data[0]) if response_data[0] in ZenErrorCode else None
	//             error_label = error_code.name if error_code else f"Unknown error code: {hex(response_data[0])}"
	//             if self.narration: print(f"Command error code: {error_label}")
	//         else:
	//             if self.narration: print("Command error (no error code)")
	//         return None
	//     case _:
	//         if self.narration: print(f"Unknown response type: {response_code}")
	//         return None
	// if response_data:
	//     return response_data
	// return None

	/** Send a DALI colour command. */
	async sendColour(controller: ZenController, command: ZenCommand, address: number, colour: ZenColour, level = 255): Promise<boolean> {
		const result = await this.sendPacket(controller, command, [address, ...colour.toBytes(level)])
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

	// def query_profile_label(self, controller: ZenController, profile: int) -> Optional[str]:
	//     """Get the label for a Profile number (0-65535). Returns a string if a label exists, else None."""
	//     # Profile numbers are 2 bytes long, so check valid range
	//     if not 0 <= profile <= 65535:
	//         raise ValueError("Profile number must be between 0 and 65535")
	//     # Split profile number into upper and lower bytes
	//     profile_upper = (profile >> 8) & 0xFF
	//     profile_lower = profile & 0xFF
	//     # Send request
	//     return self._send_basic(controller, self.CMD["QUERY_PROFILE_LABEL"], 0x00, [0x00, profile_upper, profile_lower], return_type='str', cacheable=True)

	// def query_current_profile_number(self, controller: ZenController) -> Optional[int]:
	//     """Get the current/active Profile number for a controller. Returns int, else None if query fails."""
	//     response = self._send_basic(controller, self.CMD["QUERY_CURRENT_PROFILE_NUMBER"])
	//     if response and len(response) >= 2: # Profile number is 2 bytes, combine them into a single integer. First byte is high byte, second is low byte
	//         return (response[0] << 8) | response[1]
	//     return None

	/** Get the current TPI Event multicast emitter state for a controller. Returns `true` if enabled, `false` if disabled, `null` if query fails. */
	async queryTpiEventEmitState(controller: ZenController): Promise<ZenEventMode | null> {
		const modeFlag = await this.sendBasicFrame(controller, 'QUERY_TPI_EVENT_EMIT_STATE', 0, [], 'int')
		if (modeFlag !== null) {
			return ZenEventMode.fromByte(modeFlag)
		} else {
			return null
		}
	}

	// def dali_add_tpi_event_filter(self, address: ZenAddress|ZenInstance, filter: ZenEventMask = ZenEventMask.all_events()) -> bool:
	//     """Stop specific events from an address/instance from being sent. Events in mask will be muted. Returns true if filter was added successfully."""
	//     instance_number = 0xFF
	//     if isinstance(address, ZenInstance):
	//         instance: ZenInstance = address
	//         instance_number = instance.number
	//         address = instance.address
	//     return self._send_basic(address.controller,
	//                          self.CMD["DALI_ADD_TPI_EVENT_FILTER"],
	//                          address.ecg_or_ecd_or_broadcast(),
	//                          [instance_number, filter.upper(), filter.lower()],
	//                          return_type='bool')

	// def dali_clear_tpi_event_filter(self, address: ZenAddress|ZenInstance, unfilter: ZenEventMask = ZenEventMask.all_events()) -> bool:
	//     """Allow specific events from an address/instance to be sent again. Events in mask will be unmuted. Returns true if filter was cleared successfully."""
	//     instance_number = 0xFF
	//     if isinstance(address, ZenInstance):
	//         instance: ZenInstance = address
	//         instance_number = instance.number
	//         address = instance.address
	//     return self._send_basic(address.controller,
	//                          self.CMD["DALI_CLEAR_TPI_EVENT_FILTERS"],
	//                          address.ecg_or_ecd_or_broadcast(),
	//                          [instance_number, unfilter.upper(), unfilter.lower()],
	//                          return_type='bool')

	// def query_dali_tpi_event_filters(self, address: ZenAddress|ZenInstance) -> list[dict]:
	//     """Query active event filters for an address (or a specific instance). Returns a list of dictionaries containing filter info, or None if query fails."""
	//     instance_number = 0xFF
	//     if isinstance(address, ZenInstance):
	//         instance: ZenInstance = address
	//         instance_number = instance.number
	//         address = instance.address
    
	//     # As the data payload can only be up to 64 bytes and there are up to 64 event filters, it may be necessary to query several times.
	//     # If you have all 64 event filters active, you will receive results 0-14 in the first response.
	//     results = []
	//     start_at = 0
	//     while True:
    
	//         response = self._send_basic(address.controller, 
	//                                 self.CMD["QUERY_DALI_TPI_EVENT_FILTERS"],
	//                                 address.ecg_or_ecd_or_broadcast(),
	//                                 [start_at, 0x00, instance_number])
        
	//         # Byte 0: TPI event modes active, ignored here.
	//         # modes_active = response[0]
                                
	//         if response and len(response) >= 5:  # Need at least modes + one result

	//             # Starting from the second byte (1), process results in groups of 4 bytes
	//             for i in range(1, len(response)-3, 4):
	//                 result = {
	//                     'address': response[i],
	//                     'instance': response[i+1],
	//                     'event_mask': ZenEventMask.from_upper_lower(response[i+2], response[i+3])
	//                 }
	//                 results.append(result)
            
	//             if len(results) < 60: # 15 results * 4 bytes = 60 bytes. If we received fewer than 15 results, then there are no more.
	//                 break
        
	//         else:
	//             break # If there are no more results, stop querying
        
	//         # To complete the set, you would request 15, 30, 45, 60 as starting numbers or until you receive None (NO_ANSWER).
	//         start_at += 15
            
	//     return results

	/** Enable or disable TPI Event emission. Returns `true` if successful, else `false`. */
	async tpiEventEmit(controller: ZenController, mode: ZenEventMode = new ZenEventMode({ enabled: true, filtering: false, unicast: false, multicast: true })): Promise<boolean> {
		const modeFlag = mode.bitmask()
		await this.sendBasicFrame(controller, 'ENABLE_TPI_EVENT_EMIT', 0x00, [], 'int') // disable first to clear any existing state... I think this is a bug?
		const result = await this.sendBasicFrame(controller, 'ENABLE_TPI_EVENT_EMIT', modeFlag, [], 'int')
		return (result === modeFlag)
	}

	/** Configure TPI Events for Unicast mode with IP and port as defined in the ZenController instance. */
	async setTpiEventUnicastAddress(controller: ZenController, ipaddr?: string, port: number = ZenConst.DEFAULT_UNICAST_PORT): Promise<boolean | null> {
		if (ipaddr !== undefined) {
			if (port < 0 || port > 65535) {
				throw new Error('Port must be between 0 and 65535')
			}

			// Split port into upper and lower bytes
			const portUpper = (port >> 8) & 0xff
			const portLower = port & 0xff

			// Construct data payload: [port_upper, port_lower, ip1, ip2, ip3, ip4]
			const data = [portUpper, portLower, ...ipaddr.split('.').map(str => Number(str))]
			return await this.sendDynamicFrame(controller, 'SET_TPI_EVENT_UNICAST_ADDRESS', data, 'ok')
		} else {
			return await this.sendDynamicFrame(controller, 'SET_TPI_EVENT_UNICAST_ADDRESS', [0,0,0,0,0,0], 'ok')
		}
	}
	// def set_tpi_event_unicast_address(self, controller: ZenController, ipaddr: Optional[str] = None, port: Optional[int] = None):
	//     """Configure TPI Events for Unicast mode with IP and port as defined in the ZenController instance."""
	//     data = [0,0,0,0,0,0]
	//     if port is not None:
	//         # Valid port number
	//         if not 0 <= port <= 65535: raise ValueError("Port must be between 0 and 65535")

	//         # Split port into upper and lower bytes
	//         port_upper = (port >> 8) & 0xFF 
	//         port_lower = port & 0xFF
        
	//         # Convert IP string to bytes
	//         try:
	//             ip_bytes = [int(x) for x in ipaddr.split('.')]
	//             if len(ip_bytes) != 4 or not all(0 <= x <= 255 for x in ip_bytes):
	//                 raise ValueError
	//         except ValueError:
	//             raise ValueError("Invalid IP address format")
            
	//         # Construct data payload: [port_upper, port_lower, ip1, ip2, ip3, ip4]
	//         data = [port_upper, port_lower] + ip_bytes
    
	//     return self._send_dynamic(controller, self.CMD["SET_TPI_EVENT_UNICAST_ADDRESS"], data)

	// def query_tpi_event_unicast_address(self, controller: ZenController) -> Optional[dict]:
	//     """Query TPI Events state and unicast configuration.
	//     Sends a Basic frame to query the TPI Event emit state, Unicast Port and Unicast Address.
   
	//     Args:
	//         controller: ZenController instance
        
	//     Returns:
	//         Optional dict containing:
	//         - bool: Whether TPI Events are enabled
	//         - bool: Whether Unicast mode is enabled  
	//         - int: Configured unicast port
	//         - str: Configured unicast IP address
        
	//         Returns None if query fails
	//     """
	//     response = self._send_basic(controller, self.CMD["QUERY_TPI_EVENT_UNICAST_ADDRESS"])
	//     if response and len(response) >= 7:
	//         return {
	//             'mode': ZenEventMode.from_byte(response[0]),
	//             'port': (response[1] << 8) | response[2],
	//             'ip': f"{response[3]}.{response[4]}.{response[5]}.{response[6]}"
	//         }
	//     return None

	/** Query a controller for groups. */
	async queryGroupNumbers(controller: ZenController): Promise<ZenAddress[] | null> {
		const groups = await this.sendBasicFrame(controller, 'QUERY_GROUP_NUMBERS', 0, [], 'list')
		if (!groups) {
			return null
		}

		return groups.sort().map(group => new ZenAddress(controller, ZenAddressType.GROUP, group))
	}
    
	// def query_dali_colour(self, address: ZenAddress) -> Optional[ZenColour]:
	//     """Query colour information from a DALI address."""
	//     response = self._send_basic(address.controller, self.CMD["QUERY_DALI_COLOUR"], address.ecg())
	//     return ZenColour.from_bytes(response)

	// def query_profile_information(self, controller: ZenController) -> Optional[tuple[dict, dict]]:
	//     """Query a controller for profile information. Returns a tuple of two dicts, or None if query fails."""
	//     response = self._send_basic(controller, self.CMD["QUERY_PROFILE_INFORMATION"], cacheable=True)
	//     # Initial 12 bytes:
	//     # 0-1 0x00 Current Active Profile Number
	//     # 2-3 0x00 Last Scheduled Profile Number
	//     # 4-7 0x22334455 Last Overridden Profile UTC
	//     # 8-11 0x44556677 Last Scheduled Profile UTC
	//     unpacked = struct.unpack('>HHII', response[0:12])
	//     state = {
	//         'current_active_profile': unpacked[0],
	//         'last_scheduled_profile': unpacked[1],
	//         'last_overridden_profile_utc': dt.fromtimestamp(unpacked[2]),
	//         'last_scheduled_profile_utc': dt.fromtimestamp(unpacked[3])
	//     }
	//     # Process profiles in groups of 3 bytes (2 bytes for profile number, 1 byte for profile behaviour)
	//     profiles: dict[int, int] = {}
	//     for i in range(12, len(response), 3):
	//         profile_number = struct.unpack('>H', response[i:i+2])[0]
	//         profile_behaviour = response[i+2]
	//         # bit 0: enabled: 0 = disabled, 1 = enabled
	//         # bit 1-2: priority: two bit int where 0 = scheduled, 1 = medium, 2 = high, 3 = emergency
	//         enabled = not bool(profile_behaviour & 0x01)
	//         priority = (profile_behaviour >> 1) & 0x03
	//         priority_label = ["Scheduled", "Medium", "High", "Emergency"][priority]
	//         profiles[profile_number] = {"enabled": enabled, "priority": priority, "priority_label": priority_label}
	//     # Return tuple of state and profiles
	//     return state, profiles

	// def query_profile_numbers(self, controller: ZenController) -> Optional[list[int]]:
	//     """Query a controller for a list of available Profile Numbers. Returns a list of profile numbers, or None if query fails."""
	//     response = self._send_basic(controller, self.CMD["QUERY_PROFILE_NUMBERS"])
	//     if response and len(response) >= 2:
	//         # Response contains pairs of bytes for each profile number
	//         profile_numbers = []
	//         for i in range(0, len(response), 2):
	//             if i + 1 < len(response):
	//                 profile_num = (response[i] << 8) | response[i+1]
	//                 profile_numbers.append(profile_num)
	//         return profile_numbers
	//     return None

	// def query_occupancy_instance_timers(self, instance: ZenInstance) -> Optional[dict]:
	//     """Query timer values for a DALI occupancy sensor instance. Returns dict, or None if query fails.

	//     Returns:
	//         dict:
	//             - int: Deadtime in seconds (0-255)
	//             - int: Hold time in seconds (0-255)
	//             - int: Report time in seconds (0-255)
	//             - int: Seconds since last occupied status (0-255)
	//     """
	//     response = self._send_basic(instance.address.controller, self.CMD["QUERY_OCCUPANCY_INSTANCE_TIMERS"], instance.address.ecd(), [0x00, 0x00, instance.number])
	//     if response and len(response) >= 5:
	//         return {
	//             'deadtime': response[0],
	//             'hold': response[1],
	//             'report': response[2],
	//             'last_detect': (response[3] << 8) | response[4]
	//         }
	//     return None

	// def query_instances_by_address(self, address: ZenAddress) -> list[ZenInstance]:
	//     """Query a DALI address (ECD) for associated instances. Returns a list of ZenInstance, or an empty list if nothing found."""
	//     response = self._send_basic(address.controller, self.CMD["QUERY_INSTANCES_BY_ADDRESS"], address.ecd())
	//     if response and len(response) >= 4:
	//         instances = []
	//         # Process groups of 4 bytes for each instance
	//         for i in range(0, len(response), 4):
	//             if i + 3 < len(response):
	//                 instances.append(ZenInstance(
	//                     address=address,
	//                     number=response[i], # first byte
	//                     type=ZenInstanceType(response[i+1]) if response[i+1] in ZenInstanceType._value2member_map_ else None, # second byte
	//                     active=bool(response[i+2] & 0x02), # third byte, second bit
	//                     error=bool(response[i+2] & 0x01), # third byte, first bit
	//                 ))
	//         return instances
	//     return []

	// def query_operating_mode_by_address(self, address: ZenAddress) -> Optional[int]:
	//     """Query a DALI address (ECG or ECD) for its operating mode. Returns an int containing the operating mode value, or None if the query fails."""
	//     response = self._send_basic(address.controller, self.CMD["QUERY_OPERATING_MODE_BY_ADDRESS"], address.ecg_or_ecd())
	//     if response and len(response) == 1:
	//         return response[0]  # Operating mode is in first byte
	//     return None

	/** Set a DALI address (ECG, group, broadcast) to a colour. Returns `true` if command succeeded, `false` otherwise. */
	async daliColour(address: ZenAddress, colour: ZenColour, level = 255): Promise<boolean> {
		return this.sendColour(address.controller, 'DALI_COLOUR', address.ecgOrGroupOrBroadcast(), colour, level)
	}

	/** Query a DALI group for its occupancy status and level. Returns a tuple containing group number, occupancy status, and actual level. */
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

	// def query_scene_numbers_by_address(self, address: ZenAddress) -> Optional[list[int]]:
	//     """Query a DALI address (ECG) for associated scenes. Returns a list of scene numbers where levels have been set."""
	//     return self._send_basic(address.controller, self.CMD["QUERY_SCENE_NUMBERS_BY_ADDRESS"], address.ecg(), return_type='list')

	// def query_scene_levels_by_address(self, address: ZenAddress) -> list[Optional[int]]:
	//     """Query a DALI address (ECG) for its DALI scene levels. Returns a list of 16 scene level values (0-254, or None if not part of scene)."""
	//     response = self._send_basic(address.controller, self.CMD["QUERY_SCENE_LEVELS_BY_ADDRESS"], address.ecg(), return_type='list')
	//     if response:
	//         return [None if x == 255 else x for x in response]
	//     return [None] * Const.MAX_SCENE

	// def query_colour_scene_membership_by_address(self, address: ZenAddress) -> list[int]:
	//     """Query a DALI address (ECG) for which scenes have colour change data. Returns a list of scene numbers."""
	//     response = self._send_basic(address.controller, self.CMD["QUERY_COLOUR_SCENE_MEMBERSHIP_BY_ADDR"], address.ecg(), return_type='list')
	//     if response:
	//         return response
	//     return None

	// def query_scene_colours_by_address(self, address: ZenAddress) -> list[Optional[ZenColour]]:
	//     """Query a DALI address (ECG) for its colour scene data. Returns a list of 16 scene level values (0-254, or None if not part of scene)."""
	//     # Create a list of 12 ZenColour instances
	//     output: list[Optional[ZenColour]] = [None] * Const.MAX_SCENE
	//     # Queries
	//     response = self._send_basic(address.controller, self.CMD["QUERY_COLOUR_SCENE_0_7_DATA_FOR_ADDR"], address.ecg())
	//     if response is None:
	//         return output
	//     response += self._send_basic(address.controller, self.CMD["QUERY_COLOUR_SCENE_8_11_DATA_FOR_ADDR"], address.ecg())
	//     # Combined result should always be exactly 7*12 = 84 bytes
	//     if len(response) != 84:
	//         print(f"Warning: QUERY_COLOUR_SCENE_***_DATA_FOR_ADDR returned {len(response)} bytes, expected 84")
	//         return output
	//     # Data is in 7 byte segments
	//     for i in range(0, Const.MAX_SCENE):
	//         offset = i*7
	//         output[i] = ZenColour.from_bytes(response[offset:offset+7])
	//     return output

	/** Query an address (ECG) for which DALI groups it belongs to. Returns a list of ZenAddress group instances. */
	async queryGroupMembershipByAddress(address: ZenAddress): Promise<ZenAddress[] | null> {
		const response = await this.sendBasicFrame(address.controller, 'QUERY_GROUP_MEMBERSHIP_BY_ADDRESS', address.ecg(), [], 'bytes')
		if (!response || response.length !== 2) {
			return null
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
		return groups.sort().map(group => new ZenAddress(address.controller, ZenAddressType.GROUP, group))
	}

	// def query_dali_addresses_with_instances(self, controller: ZenController, start_address: int=0) -> list[ZenAddress]: # TODO: automate iteration over start_address=0, start_address=60, etc.
	//     """Query for DALI addresses that have instances associated with them.
    
	//     Due to payload restrictions, this needs to be called multiple times with different
	//     start addresses to check all possible devices (e.g. start_address=0, then start_address=60)
    
	//     Args:
	//         controller: ZenController instance
	//         start_address: Starting DALI address to begin searching from (0-127)
        
	//     Returns:
	//         List of DALI addresses that have instances, or None if query fails
	//     """
	//     addresses = self._send_basic(controller, self.CMD["QUERY_DALI_ADDRESSES_WITH_INSTANCES"], 0, [0,0,start_address], return_type='list')
	//     if not addresses:
	//         return []
	//     zen_addresses = []
	//     for number in addresses:
	//         if 64 <= number <= 127:  # Only process valid device addresses (64-127)
	//             zen_addresses.append(ZenAddress(
	//                 controller=controller,
	//                 type=ZenAddressType.ECD,
	//                 number=number-64 # subtract 64 to get actual DALI device address
	//             ))
	//     return zen_addresses

	/** Query which DALI scenes are associated with a given group number. Returns list of scene numbers. */
	async querySceneNumbersForGroup(group: ZenAddress): Promise<number[] | null> {
		const response = await this.sendBasicFrame(group.controller, 'QUERY_SCENE_NUMBERS_FOR_GROUP', group.group(), [], 'bytes')
		if (!response || response.length !== 2) {
			return null
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

		return scenes.sort()
	}

	/** Query the label for a scene (0-11) and group number combination. Returns string, or `null` if no label is set. */
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

	// def query_scenes_for_group(self, address: ZenAddress, generic_if_none: bool=False) -> list[Optional[str]]:
	//     """Compound command to query the labels for all scenes for a group. Returns list of scene labels, where None indicates no label is set."""
	//     scenes: list[Optional[str]] = [None] * Const.MAX_SCENE
	//     numbers = self.query_scene_numbers_for_group(address)
	//     for scene in numbers:
	//         scenes[scene] = self.query_scene_label_for_group(address, scene, generic_if_none=generic_if_none)
	//     return scenes

	/** Query the controller's version number. Returns string, or None if query fails. */
	async queryControllerVersionNumber(controller: ZenController): Promise<string | null> {
		const response = await this.sendBasicFrame(controller, 'QUERY_CONTROLLER_VERSION_NUMBER', 0, [], 'bytes')
		if (response && response.length === 3) {
			return `${response[0]}.${response[1]}.${response[2]}`
		} else {
			return null
		}
	}

	/** Query which DALI control gear addresses are present in the database. Returns a list of ZenAddress instances. */
	async queryControlGearDaliAddresses(controller: ZenController): Promise<ZenAddress[] | null> {
		const response = await this.sendBasicFrame(controller, 'QUERY_CONTROL_GEAR_DALI_ADDRESSES', 0, [], 'bytes')
		if (!response || response.length !== 8) {
			return null
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

	// def dali_inhibit(self, address: ZenAddress, time_seconds: int) -> bool:
	//     """Inhibit sensors from changing a DALI address (ECG or group or broadcast) for specified time in seconds (0-65535). Returns `true` if acknowledged, else `false`."""
	//     time_hi = (time_seconds >> 8) & 0xFF  # Convert time to 16-bit value
	//     time_lo = time_seconds & 0xFF
	//     return self._send_basic(address.controller, self.CMD["DALI_INHIBIT"], address.ecg_or_group_or_broadcast(), [0x00, time_hi, time_lo], return_type='ok')

	// def dali_scene(self, address: ZenAddress, scene: int) -> bool:
	//     """Send RECALL SCENE (0-11) to an address (ECG or group or broadcast). Returns `true` if acknowledged, else `false`."""
	//     if not 0 <= scene < Const.MAX_SCENE: raise ValueError(f"Scene number must be between 0 and {Const.MAX_SCENE}, got {scene}")
	//     return self._send_basic(address.controller, self.CMD["DALI_SCENE"], address.ecg_or_group_or_broadcast(), [0x00, 0x00, scene], return_type='ok')

	/** Send DIRECT ARC level (0-254) to an address (ECG or group or broadcast). Will fade to the new level. Returns `true` if acknowledged, else `false`. */
	async daliArcLevel(address: ZenAddress, level: number): Promise<boolean> {
		if (level < 0 || level > ZenConst.MAX_LEVEL) {
			throw new Error(`Level must be between 0 and ${ZenConst.MAX_LEVEL}, got ${level}`)
		}
		return !!await this.sendBasicFrame(address.controller, 'DALI_ARC_LEVEL', address.ecgOrGroupOrBroadcast(), [0x00, 0x00, level], 'ok')
	}

	// def dali_on_step_up(self, address: ZenAddress) -> bool:
	//     """Send ON AND STEP UP to an address (ECG or group or broadcast). If a device is off, it will turn it on. If a device is on, it will step up. No fade."""
	//     return self._send_basic(address.controller, self.CMD["DALI_ON_STEP_UP"], address.ecg_or_group_or_broadcast(), return_type='ok')

	// def dali_step_down_off(self, address: ZenAddress) -> bool:
	//     """Send STEP DOWN AND OFF to an address (ECG or group or broadcast). If a device is at min, it will turn off. If a device isn't yet at min, it will step down. No fade."""
	//     return self._send_basic(address.controller, self.CMD["DALI_STEP_DOWN_OFF"], address.ecg_or_group_or_broadcast(), return_type='ok')

	// def dali_up(self, address: ZenAddress) -> bool:
	//     """Send DALI UP to an address (ECG or group or broadcast). Will fade to the new level. Returns `true` if acknowledged, else `false`."""
	//     return self._send_basic(address.controller, self.CMD["DALI_UP"], address.ecg_or_group_or_broadcast(), return_type='ok')

	// def dali_down(self, address: ZenAddress) -> bool:
	//     """Send DALI DOWN to an address (ECG or group or broadcast). Will fade to the new level. Returns `true` if acknowledged, else `false`."""
	//     return self._send_basic(address.controller, self.CMD["DALI_DOWN"], address.ecg_or_group_or_broadcast(), return_type='ok')

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

	// def dali_query_control_gear_status(self, address: ZenAddress) -> Optional[dict]:
	//     """Query the Status for a DALI address (ECG or group or broadcast). Returns a dictionary of status flags."""
	//     response = self._send_basic(address.controller, self.CMD["DALI_QUERY_CONTROL_GEAR_STATUS"], address.ecg_or_group_or_broadcast())
	//     if response and len(response) == 1:
	//         return {
	//             "cg_failure": bool(response[0] & 0x01),
	//             "lamp_failure": bool(response[0] & 0x02),
	//             "lamp_power_on": bool(response[0] & 0x04),
	//             "limit_error": bool(response[0] & 0x08), # (an Arc-level > Max or < Min requested)
	//             "fade_running": bool(response[0] & 0x10),
	//             "reset": bool(response[0] & 0x20),
	//             "missing_short_address": bool(response[0] & 0x40),
	//             "power_failure": bool(response[0] & 0x80)
	//         }
	//     return None

	// def dali_query_cg_type(self, address: ZenAddress) -> Optional[list[int]]:
	//     """Query device type information for a DALI address (ECG).
        
	//     Returns:
	//         Optional[list[int]]: List of device type numbers that the control gear belongs to.
	//                             Returns empty list if device doesn't exist.
	//                             Returns None if query fails.
	//     """
	//     response = self._send_basic(address.controller, self.CMD["DALI_QUERY_CG_TYPE"], address.ecg())
	//     if response and len(response) == 4:
	//         device_types = []
	//         # Process each byte which represents 8 device types
	//         for byte_index, byte_value in enumerate(response):
	//             # Check each bit in the byte
	//             for bit in range(8):
	//                 if byte_value & (1 << bit):
	//                     # Calculate actual device type number
	//                     device_type = byte_index * 8 + bit
	//                     device_types.append(device_type)
	//         return device_types
	//     return None

	// def dali_query_last_scene(self, address: ZenAddress) -> Optional[int]:
	//     """Query the last heard Scene for a DALI address (ECG or group or broadcast). Returns scene number, or None if query fails.
        
	//     Note:
	//         Changes to a single DALI device done through group or broadcast scene commands
	//         also change the last heard scene for the individual device address. For example,
	//         if A10 is member of G0 and we send a scene command to G0, A10 will show the 
	//         same last heard scene as G0.
	//     """
	//     return self._send_basic(address.controller, self.CMD["DALI_QUERY_LAST_SCENE"], address.ecg_or_group_or_broadcast(), return_type='int')

	// def dali_query_last_scene_is_current(self, address: ZenAddress) -> Optional[bool]:
	//     """Query if the last heard scene is the current active scene for a DALI address (ECG or group or broadcast).
	//     Returns `true` if still active, False if another command has been issued since, or None if query fails."""
	//     return self._send_basic(address.controller, self.CMD["DALI_QUERY_LAST_SCENE_IS_CURRENT"], address.ecg_or_group_or_broadcast(), return_type='bool')

	// def dali_query_min_level(self, address: ZenAddress) -> Optional[int]:
	//     """Query a DALI address (ECG) for its minimum level (0-254). Returns the minimum level if successful, None if query fails."""
	//     return self._send_basic(address.controller, self.CMD["DALI_QUERY_MIN_LEVEL"], address.ecg(), return_type='int')

	// def dali_query_max_level(self, address: ZenAddress) -> Optional[int]:
	//     """Query a DALI address (ECG) for its maximum level (0-254). Returns the maximum level if successful, None if query fails."""
	//     return self._send_basic(address.controller, self.CMD["DALI_QUERY_MAX_LEVEL"], address.ecg(), return_type='int')

	// def dali_query_fade_running(self, address: ZenAddress) -> Optional[bool]:
	//     """Query a DALI address (ECG) if a fade is currently running. Returns `true` if a fade is currently running, False if not, None if query fails."""
	//     return self._send_basic(address.controller, self.CMD["DALI_QUERY_FADE_RUNNING"], address.ecg(), return_type='bool')

	/**
	 * Begin a DALI Direct Arc Power Control (DAPC) Sequence.
	 * 
	 * DAPC allows overriding of the fade rate for immediate level setting. The sequence
	 * continues for 250ms. If no arc levels are received within 250ms, the sequence ends
	 * and normal fade rates resume.
	 * 
	 * Returns `true` if successful, `false` if failed, or `null` if an error occurs
	 */
	async daliEnableDAPCSequence(address: ZenAddress): Promise<boolean | null> {
		return this.sendBasicFrame(address.controller, 'DALI_ENABLE_DAPC_SEQ', address.ecgOrGroupOrBroadcast(), [], 'bool')
	}

	// def query_dali_ean(self, address: ZenAddress) -> Optional[int]:
	//     """Query a DALI address (ECG or ECD) for its European Article Number (EAN/GTIN). Returns an integer if successful, None if query fails."""
	//     response = self._send_basic(address.controller, self.CMD["QUERY_DALI_EAN"], address.ecg_or_ecd())
	//     if response and len(response) == 6:
	//         ean = 0
	//         for byte in response:
	//             ean = (ean << 8) | byte
	//         return ean
	//     return None

	// def query_dali_serial(self, address: ZenAddress) -> Optional[int]:
	//     """Query a DALI address (ECG or ECD) for its Serial Number. Returns an integer if successful, None if query fails."""
	//     response = self._send_basic(address.controller, self.CMD["QUERY_DALI_SERIAL"], address.ecg_or_ecd())
	//     if response and len(response) == 8:
	//         # Convert 8 bytes to decimal integer
	//         serial = 0
	//         for byte in response:
	//             serial = (serial << 8) | byte
	//         return serial
	//     return None

	// def dali_custom_fade(self, address: ZenAddress, level: int, seconds: int) -> bool:
	//     """Fade a DALI address (ECG or group) to a level (0-254) with a custom fade time in seconds (0-65535). Returns `true` if successful, else `false`."""
	//     if not 0 <= level < Const.MAX_LEVEL:
	//         raise ValueError("Target level must be between 0 and 254")
	//     if not 0 <= seconds <= 65535:
	//         raise ValueError("Fade time must be between 0 and 65535 seconds")

	//     # Convert fade time to integer seconds and split into high/low bytes
	//     seconds_hi = (seconds >> 8) & 0xFF
	//     seconds_lo = seconds & 0xFF
    
	//     return self._send_basic(
	//         address.controller,
	//         self.CMD["DALI_CUSTOM_FADE"],
	//         address.ecg_or_group(),
	//         [level, seconds_hi, seconds_lo],
	//         return_type='ok'
	//     )

	// def dali_go_to_last_active_level(self, address: ZenAddress) -> bool:
	//     """Command a DALI Address (ECG or group) to go to its "Last Active" level. Returns `true` if successful, else `false`."""
	//     return self._send_basic(address.controller, self.CMD["DALI_GO_TO_LAST_ACTIVE_LEVEL"], address.ecg_or_group(), return_type='ok')

	// def query_dali_instance_label(self, instance: ZenInstance, generic_if_none: bool=False) -> Optional[str]:
	//     """Query the label for a DALI Instance. Returns a string, or None if not set. Optionally, returns a generic label if the instance label is not set."""
	//     label = self._send_basic(instance.address.controller, self.CMD["QUERY_DALI_INSTANCE_LABEL"], instance.address.ecd(), [0x00, 0x00, instance.number], return_type='str', cacheable=True)
	//     if label is None and generic_if_none:
	//         label = instance.type.name.title().replace("_", " ")  + " " + str(instance.number)
	//     return label

	// def change_profile_number(self, controller: ZenController, profile: int) -> bool:
	//     """Change the active profile number (0-65535). Returns `true` if successful, else `false`."""
	//     if not 0 <= profile <= 0xFFFF: raise ValueError("Profile number must be between 0 and 65535")
	//     profile_hi = (profile >> 8) & 0xFF
	//     profile_lo = profile & 0xFF
	//     return self._send_basic(controller, self.CMD["CHANGE_PROFILE_NUMBER"], 0x00, [0x00, profile_hi, profile_lo], return_type='ok')

	// def return_to_scheduled_profile(self, controller: ZenController) -> bool:
	//     """Return to the scheduled profile. Returns `true` if successful, else `false`."""
	//     return self.change_profile_number(controller, 0xFFFF) # See docs page 91, 0xFFFF returns to scheduled profile

	// def query_instance_groups(self, instance: ZenInstance) -> Optional[tuple[int, int, int]]: # TODO: replace Tuple with dict
	//     """Query the group targets associated with a DALI instance.
        
	//     Returns:
	//         Optional tuple containing:
	//         - int: Primary group number (0-15, or 255 if not configured)
	//         - int: First group number (0-15, or 255 if not configured) 
	//         - int: Second group number (0-15, or 255 if not configured)
        
	//         Returns None if query fails
        
	//     The Primary group typically represents where the physical device resides.
	//     A group number of 255 (0xFF) indicates that no group has been configured.
	//     """
	//     response = self._send_basic(
	//         instance.address.controller,
	//         self.CMD["QUERY_INSTANCE_GROUPS"], 
	//         instance.address.ecd(),
	//         [0x00, 0x00, instance.number],
	//         return_type='list'
	//     )
	//     if response and len(response) == 3:
	//         return (
	//             response[0] if response[0] != 0xFF else None,
	//             response[1] if response[1] != 0xFF else None,
	//             response[2] if response[2] != 0xFF else None
	//         )
	//     return None

	// def query_dali_fitting_number(self, address: ZenAddress) -> Optional[str]:
	//     """Query a DALI address (ECG or ECD) for its fitting number. Returns the fitting number (e.g. '1.2') or a generic identifier if the address doesn't exist, or None if the query fails."""
	//     return self._send_basic(address.controller, self.CMD["QUERY_DALI_FITTING_NUMBER"], address.ecg_or_ecd(), return_type='str', cacheable=True)
    
	// def query_dali_instance_fitting_number(self, instance: ZenInstance) -> Optional[str]:
	//     """Query a DALI instance for its fitting number. Returns a string (e.g. '1.2.0') or None if query fails."""
	//     return self._send_basic(instance.address.controller, self.CMD["QUERY_DALI_INSTANCE_FITTING_NUMBER"], instance.address.ecd(), [0x00, 0x00, instance.number], return_type='str')

	// def query_controller_label(self, controller: ZenController) -> Optional[str]:
	//     """Request the label for the controller. Returns the controller's label string, or None if query fails."""
	//     return self._send_basic(controller, self.CMD["QUERY_CONTROLLER_LABEL"], return_type='str', cacheable=True)

	// def query_controller_fitting_number(self, controller: ZenController) -> Optional[str]:
	//     """Request the fitting number string for the controller itself. Returns the controller's fitting number (e.g. '1'), or None if query fails."""
	//     return self._send_basic(controller, self.CMD["QUERY_CONTROLLER_FITTING_NUMBER"], return_type='str')

	// def query_is_dali_ready(self, controller: ZenController) -> bool:
	//     """Query whether the DALI line is ready or has a fault. Returns `true` if DALI line is ready, False if there is a fault."""
	//     return self._send_basic(controller, self.CMD["QUERY_IS_DALI_READY"], return_type='ok')

	// def query_controller_startup_complete(self, controller: ZenController) -> bool:
	//     """Query whether the controller has finished its startup sequence. Returns `true` if startup is complete, False if still in progress.

	//     The startup sequence performs DALI queries such as device type, current arc-level, GTIN, 
	//     serial number, etc. The more devices on a DALI line, the longer startup will take to complete.
	//     For a line with only a handful of devices, expect it to take approximately 1 minute.
	//     Waiting for the startup sequence to complete is particularly important if you wish to 
	//     perform queries about DALI.
	//     """
	//     return self._send_basic(controller, self.CMD["QUERY_CONTROLLER_STARTUP_COMPLETE"], return_type='ok')

	// def override_dali_button_led_state(self, instance: ZenInstance, led_state: bool) -> bool:
	//     """Override the LED state for a DALI push button. State is True for LED on, False for LED off. Returns true if command succeeded, else `false`."""
	//     return self._send_basic(instance.address.controller,
	//                            self.CMD["OVERRIDE_DALI_BUTTON_LED_STATE"],
	//                            instance.address.ecd(),
	//                            [0x00, 0x02 if led_state else 0x01, instance.number],
	//                            return_type='ok')

	// def query_last_known_dali_button_led_state(self, instance: ZenInstance) -> Optional[bool]:
	//     """Query the last known LED state for a DALI push button. Returns `true` if LED is on, False if LED is off, None if query failed
        
	//     Note: The "last known" LED state may not be the actual physical LED state.
	//     This only works for LED modes where the controller or TPI caller is managing
	//     the LED state. In many cases, the control device itself manages its own LED.
	//     """
	//     response = self._send_basic(instance.address.controller,
	//                                self.CMD["QUERY_LAST_KNOWN_DALI_BUTTON_LED_STATE"],
	//                                instance.address.ecd(),
	//                                [0x00, 0x00, instance.number])
	//     if response and len(response) == 1:
	//         match response[0]:
	//             case 0x01: return False
	//             case 0x02: return True
	//     return None

	// def dali_stop_fade(self, address: ZenAddress) -> bool:
	//     """Tell a DALI address (ECG or ECD) to stop running a fade. Returns `true` if command succeeded, else `false`.

	//     Caution: this literally stops the fade. It doesn't jump to the target level.

	//     Note: For custom fades started via DALI_CUSTOM_FADE, this can only stop
	//     fades that were started with the same target address. For example, you 
	//     cannot stop a custom fade on a single address if it was started as part
	//     of a group or broadcast fade.
	//     """
	//     return self._send_basic(address.controller, self.CMD["DALI_STOP_FADE"], address.ecg_or_group_or_broadcast(), return_type='ok')

	// def query_dali_colour_features(self, address: ZenAddress) -> Optional[dict]:
	//     """Query the colour features/capabilities of a DALI device.
    
	//     Args:
	//         address: ZenAddress
        
	//     Returns:
	//         Dictionary containing colour capabilities, or None if query failed:
	//         {
	//             'supports_xy': bool,          # Supports CIE 1931 XY coordinates
	//             'primary_count': int,         # Number of primaries (0-7)
	//             'rgbwaf_channels': int,      # Number of RGBWAF channels (0-7)
	//         }
	//     """
	//     response = self._send_basic(address.controller, self.CMD["QUERY_DALI_COLOUR_FEATURES"], address.ecg(), cacheable=True)
	//     if response and len(response) == 1:
	//         features = response[0]
	//         return {
	//             'supports_xy': bool(features & 0x01),      # Bit 0
	//             'supports_tunable': bool(features & 0x02), # Bit 1
	//             'primary_count': (features & 0x1C) >> 2,   # Bits 2-4
	//             'rgbwaf_channels': (features & 0xE0) >> 5, # Bits 5-7
	//         }
	//     elif response is None:
	//         return {
	//             'supports_xy': False,
	//             'supports_tunable': False,
	//             'primary_count': 0,
	//             'rgbwaf_channels': 0,
	//         }
	//     return None

	// def query_dali_colour_temp_limits(self, address: ZenAddress) -> Optional[dict]:
	//     """Query the colour temperature limits of a DALI device.
    
	//     Args:
	//         controller: ZenController instance
	//         gear: DALI address (0-63)
        
	//     Returns:
	//         Dictionary containing colour temperature limits in Kelvin, or None if query failed:
	//         {
	//             'physical_warmest': int,  # Physical warmest temp limit (K)
	//             'physical_coolest': int,  # Physical coolest temp limit (K) 
	//             'soft_warmest': int,      # Configured warmest temp limit (K)
	//             'soft_coolest': int,      # Configured coolest temp limit (K)
	//             'step_value': int         # Step value (K)
	//         }
	//     """
	//     response = self._send_basic(address.controller, self.CMD["QUERY_DALI_COLOUR_TEMP_LIMITS"], address.ecg(), cacheable=True)
	//     if response and len(response) == 10:
	//         return {
	//             'physical_warmest': (response[0] << 8) | response[1],
	//             'physical_coolest': (response[2] << 8) | response[3],
	//             'soft_warmest': (response[4] << 8) | response[5],
	//             'soft_coolest': (response[6] << 8) | response[7],
	//             'step_value': (response[8] << 8) | response[9]
	//         }
	//     return None

	// def set_system_variable(self, controller: ZenController, variable: int, value: int) -> bool:
	//     """Set a system variable (0-147) value (-32768-32767) on the controller. Returns `true` if successful, else `false`."""
	//     if not 0 <= variable < Const.MAX_SYSVAR:
	//         raise ValueError(f"Variable number must be between 0 and {Const.MAX_SYSVAR}, received {variable}")
	//     if not -32768 <= value <= 32767:
	//         raise ValueError(f"Value must be between -32768 and 32767, received {value}")
	//     bytes = value.to_bytes(length=2, byteorder="big", signed=True)
	//     return self._send_basic(controller, self.CMD["SET_SYSTEM_VARIABLE"], variable, [0x00, bytes[0], bytes[1]], return_type='ok')

	//     # If abs(value) is less than 32760, 
	//     #   If value has 2 decimal places, use magitude -2 (signed 0xfe)
	//     #   Else if value has 1 decimal place, use magitude -1 (signed 0xff)
	//     #   Else use magitude 0 (signed 0x00)
	//     # Else if abs(value) is less than 327600, use magitude 1 (signed 0x01)
	//     # Else if abs(value) is less than 3276000, use magitude 2 (signed 0x02)

	// def query_system_variable(self, controller: ZenController, variable: int) -> Optional[int]:
	//     """Query the controller for the value of a system variable (0-147). Returns the variable's value (-32768-32767) if successful, else None."""
	//     if not 0 <= variable < Const.MAX_SYSVAR:
	//         raise ValueError(f"Variable number must be between 0 and {Const.MAX_SYSVAR}, received {variable}")
	//     response = self._send_basic(controller, self.CMD["QUERY_SYSTEM_VARIABLE"], variable)
	//     if response and len(response) == 2:
	//         return int.from_bytes(response, byteorder="big", signed=True)
	//     else: # Value is unset
	//         return None

	// def query_system_variable_name(self, controller: ZenController, variable: int) -> Optional[str]:
	//     """Query the name of a system variable (0-147). Returns the variable's name, or None if query fails."""
	//     if not 0 <= variable < Const.MAX_SYSVAR:
	//         raise ValueError(f"Variable number must be between 0 and {Const.MAX_SYSVAR}, received {variable}")
	//     return self._send_basic(controller, self.CMD["QUERY_SYSTEM_VARIABLE_NAME"], variable, return_type='str', cacheable=True)

	async querySceneLevel(controller: ZenController, group: number, scene: number): Promise<number | null> {
		try {
			const { data } = await this.sendPacket(controller, 'QUERY_SCENE_BY_NUMBER', [group, scene])
			return data.length > 0 ? data[0] : null
		} catch (_) {
			return null
		}
	}

	// async daliScene(controller: ZenController, address: number, scene: number): Promise<boolean | null> {
	// 	return this.sendBasic(controller, 0x31, [address, scene])
	// }

	// async queryDeviceLevel(controller: ZenController, address: number): Promise<number | null> {
	// 	try {
	// 		const { data } = await this.sendPacket(controller, 0x42, [address])
	// 		return data.length > 0 ? data[0] : null
	// 	} catch (_) {
	// 		return null
	// 	}
	// }

	// async queryGroupLevel(controller: ZenController, group: number): Promise<number | null> {
	// 	try {
	// 		const { data } = await this.sendPacket(controller, 0x43, [group])
	// 		return data.length > 0 ? data[0] : null
	// 	} catch (_) {
	// 		return null
	// 	}
	// }

	// async setDeviceLevel(controller: ZenController, address: number, level: number): Promise<boolean | null> {
	// 	return this.sendBasic(controller, 0x20, [address, level])
	// }

	// async setGroupLevel(controller: ZenController, group: number, level: number): Promise<boolean | null> {
	// 	return this.sendBasic(controller, 0x21, [group, level])
	// }

	// async storeScene(controller: ZenController, address: number, scene: number): Promise<boolean | null> {
	// 	return this.sendBasic(controller, 0x32, [address, scene])
	// }

	// async setSceneFadeTime(controller: ZenController, group: number, scene: number, fadeTime: number): Promise<boolean | null> {
	// 	return this.sendBasic(controller, 0x48, [group, scene, fadeTime])
	// }

	// async setFadeTime(controller: ZenController, address: number, fadeTime: number): Promise<boolean | null> {
	// 	return this.sendBasic(controller, 0x23, [address, fadeTime])
	// }

	// async setColour(controller: ZenController, address: number, colour: ZenColour, level = 255): Promise<boolean | null> {
	// 	return this.sendColour(controller, 0x24, address, colour, level)
	// }

	setCallbacks(callbacks: Partial<ZenProtocol>) {
		Object.assign(this, callbacks)
	}

	startEventMonitoring(): void {
		const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })
		socket.on('error', (err) => {
			warn(`Event socket error: ${err}`)
		})
		if (this.unicast) {
			for (const controller of this.controllers) {
				this.setTpiEventUnicastAddress(controller, this.listenIp, this.listenPort)
				this.tpiEventEmit(controller, new ZenEventMode({ enabled: true, filtering: false, unicast: true, multicast: true }))
			}
			socket.bind(this.listenPort, this.listenIp, () => {
				
			})
		} else {
			for (const controller of this.controllers) {
				this.tpiEventEmit(controller, new ZenEventMode({ enabled: true, filtering: false, unicast: false, multicast: true }))
			}
			socket.bind(ZenConst.MULTICAST_PORT, () => {
				socket.addMembership(ZenConst.MULTICAST_GROUP)
			})
		}
		socket.on('message', (msg: Buffer, rinfo: RemoteInfo) => this._handleEventPacket(msg, rinfo))
		socket.on('close', () => this._handleEventClose())
		this.eventSocket = socket
	}

	stopEventMonitoring(): void {
		if (this.unicast) {
			for (const controller of this.controllers) {
				this.setTpiEventUnicastAddress(controller)
			}
		}

		const eventSocket = this.eventSocket
		if (eventSocket) {
			this.eventSocket = null
			eventSocket.disconnect()
		}
	}

	private _handleEventClose(): void {
		if (this.eventSocket) {
			log('Restarting event monitoring as the event socket closed unexpectedly')
			this.startEventMonitoring()
		}
	}

	private _handleEventPacket(packet: Buffer, rinfo: RemoteInfo): void {
		if (packet.length < 2) {
			warn(`Invalid event packet from ${rinfo.address}:${rinfo.port}: too short ${packet.length}`)
			return
		}
		if (packet[0] !== 0x5a || packet[1] !== 0x43) {
			warn(`Invalid event packet from ${rinfo.address}:${rinfo.port}: invalid magic bytes ${packet[0].toString(16)}${packet[1].toString(16)}`)
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
			warn(`Invalid payload length for event packet from ${rinfo.address}:${rinfo.port}`)
		}

		if (this.checksumBuffer(packet.subarray(0, -1)) !== receivedChecksum) {
			warn(`Checksum mismatch for event packet from ${rinfo.address}:${rinfo.port}`)
			return
		}

		const controller = this._findController(macAddress)
		if (!controller) {
			warn(`Failed to find controller with MAC address ${macAddress} for event packet from ${rinfo.address}:${rinfo.port}`)
			return
		}

		switch (eventCode) {
		case ZenEventType.BUTTON_PRESS_EVENT:
			// Button Press - Button has been pressed
			if (this.buttonPressCallback) {
				this.buttonPressCallback(new ZenInstance(new ZenAddress(controller, ZenAddressType.ECD, target - 64), ZenInstanceType.PUSH_BUTTON, payload[0]))
			}
			break
		case ZenEventType.BUTTON_HOLD_EVENT:
			// Button Hold - Button has been pressed and is being held down
			if (this.buttonHoldCallback) {
				this.buttonHoldCallback(new ZenInstance(new ZenAddress(controller, ZenAddressType.ECD, target - 64), ZenInstanceType.PUSH_BUTTON, payload[0]))
			}
			break
		case ZenEventType.ABSOLUTE_INPUT_EVENT:
			// Absolute Input - Absolute input has changed
			if (this.absoluteInputCallback) {
				const value = (payload[1] & 0xff << 8) | (payload[2] & 0xff)
				this.absoluteInputCallback(new ZenInstance(new ZenAddress(controller, ZenAddressType.ECD, target - 64), ZenInstanceType.PUSH_BUTTON, payload[0]), value)
			}
			break
		case ZenEventType.LEVEL_CHANGE_EVENT:
			// Level Change - Arc Level on an Address target has changed
			if (this.levelChangeCallback) {
				this.levelChangeCallback(new ZenAddress(controller, ZenAddressType.ECG, target), payload[0])
			}
			break
		case ZenEventType.GROUP_LEVEL_CHANGE_EVENT:
			// Group Level Change - Arc Level on a Group target has changed	
			if (this.groupLevelChangeCallback) {
				this.groupLevelChangeCallback(new ZenAddress(controller, ZenAddressType.GROUP, target), payload[0])
			}
			break
		case ZenEventType.SCENE_CHANGE_EVENT:
			// Scene Change - Scene has been recalled	
			if (this.sceneChangeCallback) {
				if (target <= 63) {
					const address = new ZenAddress(controller, ZenAddressType.ECG, target)
					this.sceneChangeCallback(address, payload[0])
				} else if (64 <= target && target <= 79) {
					const address = new ZenAddress(controller, ZenAddressType.GROUP, target - 64)
					this.sceneChangeCallback(address, payload[0])
				} else {
					warn(`Invalid scene change event target from ${rinfo.address}:${rinfo.port}: ${target}`)
				}
			}
			break
		case ZenEventType.OCCUPANCY_EVENT:
			// Is Occupied - An occupancy sensor has been triggered, area is occupied
			if (this.occupancyCallback) {
				this.occupancyCallback(new ZenInstance(new ZenAddress(controller, ZenAddressType.ECD, target - 64), ZenInstanceType.OCCUPANCY_SENSOR, payload[0]))
			}
			break
		case ZenEventType.SYSTEM_VARIABLE_CHANGED_EVENT:
			// System Variable Change - A system variable has changed
			if (this.systemVariableChangeCallback) {
				if (target < 0 || target > ZenConst.MAX_SYSVAR) {
					warn(`Invalid system variable change event from ${rinfo.address}:${rinfo.port}: ${target}`)
				} else {
					const rawValue = (payload[0] & 0xff) << 24 | (payload[1] & 0xff) << 16 | (payload[2] & 0xff) << 8 | (payload[3] & 0xff)
					const magnitude = payload[4] & 0xff
					const value = rawValue * Math.pow(10, magnitude)
					this.systemVariableChangeCallback(controller, target, value)
				}
			}
			break
		case ZenEventType.COLOUR_CHANGED_EVENT:
			// Colour Change - A Tc, RGBWAF or XY colour change has occurred	
			if (this.colourChangeCallback) {
				const colour = ZenColour.fromBytes(payload)
				if (target < 64) {
					const address = new ZenAddress(controller, ZenAddressType.ECG, target)
					this.colourChangeCallback(address, colour)
				} else if (target >= 64 && target <= 79) {
					const address = new ZenAddress(controller, ZenAddressType.GROUP, target - 64)
					this.colourChangeCallback(address, colour)
				} else if (target >= 127 && target <= 143) {
					const address = new ZenAddress(controller, ZenAddressType.GROUP, target)
					warn(`Colour change callback received with target=${target}. Assumed to be group ${target - 128}.`)
					this.colourChangeCallback(address, colour)
				}
			}
			break
		case ZenEventType.PROFILE_CHANGED_EVENT:
			// Profile Change - The active profile on the controller has changed	
			if (this.profileChangeCallback) {
				const profile = (payload[0] & 0xff) << 8 | (payload[1] & 0xff)
				this.profileChangeCallback(controller, profile)
			}
			break
		default:
			warn(`Received unknown event type from ${rinfo.address}:${rinfo.port}: ${eventCode}`)
			break
		}
	}

	_findController(macAddress: string): ZenController | undefined {
		return this.controllers.find(controller => macAddress.toLowerCase().replaceAll(':', '') === controller.macAddress?.toLowerCase().replaceAll(':', ''))
	}
}
