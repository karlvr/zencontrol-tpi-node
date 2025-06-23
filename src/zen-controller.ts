import { Const } from './zen-const.js'

export class ZenController {
	host: string
	port: number
	id: number
	macAddress?: string

	constructor(options: { host: string, id: number, port?: number, macAddress?: string }) {
		this.host = options.host
		this.id = options.id
		this.port = options.port ?? Const.DEFAULT_UNICAST_PORT
		this.macAddress = options.macAddress
	}
}
