export enum ZenEventType {
	BUTTON_PRESS_EVENT = 0x00,            // Button has been pressed
	BUTTON_HOLD_EVENT = 0x01,             // Button has been pressed and is being held down
	ABSOLUTE_INPUT_EVENT = 0x02,          // Absolute input has changed.
	LEVEL_CHANGE_EVENT = 0x03,            // Arc Level on an Address target has changed
	GROUP_LEVEL_CHANGE_EVENT = 0x04,      // Arc Level on a Group target has changed
	SCENE_CHANGE_EVENT = 0x05,            // Scene has been recalled
	OCCUPANCY_EVENT = 0x06,               // An occupancy sensor has been triggered, area is occupied.
	SYSTEM_VARIABLE_CHANGED_EVENT = 0x07, // A system variable has changed
	COLOUR_CHANGED_EVENT = 0x08,          // A Tc, RGBWAF or XY colour change has occurred
	PROFILE_CHANGED_EVENT = 0x09,         // The active profile on the controller has changed.
}

export class ZenEventMode {
	enabled = false
	filtering = false
	unicast = false
	multicast = false

	constructor(options: { enabled: boolean, filtering: boolean, unicast: boolean, multicast: boolean }) {
		this.enabled = options.enabled
		this.filtering = options.filtering
		this.unicast = options.unicast
		this.multicast = options.multicast
	}

	bitmask(): number {
		let result = 0x00
		if (this.enabled) {
			result |= 0x01
		}
		if (this.filtering) {
			result |= 0x02
		}
		if (this.unicast) {
			result |= 0x40
		}
		if (!this.multicast) {
			result |= 0x80
		}
		return result
	}

	static fromByte(modeFlag: number): ZenEventMode {
		return new ZenEventMode({
			enabled: (modeFlag & 0x01) !== 0,
			filtering: (modeFlag & 0x02) !== 0,
			unicast: (modeFlag & 0x40) !== 0,
			multicast: (modeFlag & 0x80) === 0,
		})
	}
}

export class ZenEventMask {
	private mask: number

	constructor(mask: number = 0) {
		this.mask = mask
	}

	static fromEvents(events: number[]): ZenEventMask {
		return new ZenEventMask(events.reduce((m, e) => m | (1 << e), 0))
	}

	has(event: number): boolean {
		return (this.mask & (1 << event)) !== 0
	}

	add(event: number): void {
		this.mask |= 1 << event
	}

	remove(event: number): void {
		this.mask &= ~(1 << event)
	}

	toByte(): number {
		return this.mask & 0xff
	}
}
