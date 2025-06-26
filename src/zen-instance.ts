import { ZenAddress } from './zen-address.js'
import { ZenConst } from './zen-const.js'

export enum ZenInstanceType {
	/** Push button - generates short/long press events */
	PUSH_BUTTON = 0x01,
	/** Absolute input (slider/dial) - generates integer values */
	ABSOLUTE_INPUT = 0x02,
	/** Occupancy/motion sensor - generates occupied events */
	OCCUPANCY_SENSOR = 0x03,
	/** Light sensor - events not currently forwarded */
	LIGHT_SENSOR = 0x04,
	/** General sensor (water flow, power etc) - events not currently forwarded */
	GENERAL_SENSOR = 0x06,
}

export class ZenInstance {
	address: ZenAddress
	type: ZenInstanceType
	instance: number

	constructor(address: ZenAddress, type: ZenInstanceType, instance: number) {
		this.address = address
		this.type = type
		this.instance = instance
		this.validate()
	}

	validate(): void {
		if (this.instance < 0 || this.instance >= ZenConst.MAX_INSTANCE) {
			throw new Error(`Instance out of range: ${this.instance}`)
		}
	}

	toString(): string {
		return `ZenInstance(${this.address.toString()}, ${ZenInstanceType[this.type]}, ${this.instance})`
	}
}
