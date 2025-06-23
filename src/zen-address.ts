import { Const } from './zen-const.js'
import { ZenController } from './zen-controller.js'

export enum ZenAddressType {
	BROADCAST = 0,
	ECG = 1,
	ECD = 2,
	GROUP = 3,
}

// ZenAddress
export class ZenAddress {
	controller: ZenController
	type: ZenAddressType
	target: number
	label?: string
	serial?: string

	constructor(controller: ZenController, type: ZenAddressType, target: number) {
		this.controller = controller
		this.type = type
		this.target = target
		this._postInit()
	}

	public static broadcast(controller: ZenController) {
		return new ZenAddress(controller, ZenAddressType.BROADCAST, 255)
	}

	public ecg() {
		if (this.type === ZenAddressType.ECG) {
			return this.target
		} else {
			throw new Error('Address is not a Control Gear')
		}
	}

	public ecgOrGroup() {
		if (this.type === ZenAddressType.ECG) {
			return this.target
		} else if (this.type === ZenAddressType.GROUP) {
			return this.target + 64
		} else {
			throw new Error('Address is not a Control Gear or Group')
		}
	}

	public ecgOrGroupOrBroadcast() {
		if (this.type === ZenAddressType.ECG) {
			return this.target
		} else if (this.type === ZenAddressType.GROUP) {
			return this.target + 64
		} else if (this.type === ZenAddressType.BROADCAST) {
			return 255
		} else {
			throw new Error('Address is not a Control Gear, Group or Broadcast')
		}
	}

	public ecgOrEcd() {
		if (this.type === ZenAddressType.ECG) {
			return this.target
		} else if (this.type === ZenAddressType.ECD) {
			return this.target + 64
		} else {
			throw new Error('Address is not a Control Gear or Control Device')
		}
	}

	public ecgOrEcdOrBroadcast() {
		if (this.type === ZenAddressType.ECG) {
			return this.target
		} else if (this.type === ZenAddressType.ECD) {
			return this.target + 64
		} else if (this.type === ZenAddressType.BROADCAST) {
			return 255
		} else {
			throw new Error('Address is not a Control Gear, Control Device or Broadcast')
		}
	}

	public ecd() {
		if (this.type === ZenAddressType.ECD) {
			return this.target + 64
		} else {
			throw new Error('Address is not a Control Device')
		}
	}

	public group() {
		if (this.type === ZenAddressType.GROUP) {
			return this.target
		} else {
			throw new Error('Address is not a Group')
		}
	}

	private _postInit(): void {
		switch (this.type) {
		case ZenAddressType.BROADCAST:
			this.target = 255
			break
		case ZenAddressType.ECG:
			if (this.target < 0 || this.target >= Const.MAX_ECG) {
				throw new Error(`Control Gear address must be between 0 and ${Const.MAX_ECG-1}, received ${this.target}`)
			}
			break
		case ZenAddressType.ECD:
			if (this.target < 0 || this.target >= Const.MAX_ECD) {
				throw new Error(`Control Device address must be between 0 and ${Const.MAX_ECD-1}, received ${this.target}`)
			}
			break
		case ZenAddressType.GROUP:
			if (this.target < 0 || this.target >= Const.MAX_GROUP) {
				throw new Error(`Group number must be between 0 and ${Const.MAX_GROUP-1}, received ${this.target}`)
			}
			break
		}
	}

	public toString(): string {
		return `ZenAddress(${ZenAddressType[this.type]}, ${this.controller.id}.${this.target})`
	}
}
