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
	button_press = false
	button_hold = false
	absolute_input = false
	level_change = false
	group_level_change = false
	scene_change = false
	is_occupied = false
	system_variable_change = false
	colour_change = false
	profile_change = false

	constructor() {
		
	}

	static allEvents() {
		const result = new ZenEventMask()
		result.button_press = true
		result.button_hold = true
		result.absolute_input = true
		result.level_change = true
		result.group_level_change = true
		result.scene_change = true
		result.is_occupied = true
		result.system_variable_change = true
		result.colour_change = true
		result.profile_change = true
		return result
	}

	static fromUpperLower(upper: number, lower: number) {
		return ZenEventMask.fromDoubleByte((upper << 8) | lower)
	}

	static fromDoubleByte(eventMask: number) {
		const result = new ZenEventMask()
		result.button_press = (eventMask & (1 << 0)) !== 0
		result.button_hold = (eventMask & (1 << 1)) !== 0
		result.absolute_input = (eventMask & (1 << 2)) !== 0
		result.level_change = (eventMask & (1 << 3)) !== 0
		result.group_level_change = (eventMask & (1 << 4)) !== 0
		result.scene_change = (eventMask & (1 << 5)) !== 0
		result.is_occupied = (eventMask & (1 << 6)) !== 0
		result.system_variable_change = (eventMask & (1 << 7)) !== 0
		result.colour_change = (eventMask & (1 << 8)) !== 0
		result.profile_change = (eventMask & (1 << 9)) !== 0
		return result
	}

	bitmask() {
		let result = 0x00
		if (this.button_press) {
			result |= (1 << 0)
		}
		if (this.button_hold) {
			result |= (1 << 1)
		}
		if (this.absolute_input) {
			result |= (1 << 2)
		}
		if (this.level_change) {
			result |= (1 << 3)
		}
		if (this.group_level_change) {
			result |= (1 << 4)
		}
		if (this.scene_change) {
			result |= (1 << 5)
		}
		if (this.is_occupied) {
			result |= (1 << 6)
		}
		if (this.system_variable_change) {
			result |= (1 << 7)
		}
		if (this.colour_change) {
			result |= (1 << 8)
		}
		if (this.profile_change) {
			result |= (1 << 9)
		}
		return result
	}

	upper() {
		return (this.bitmask() >> 8) * 0xff
	}

	lower() {
		return (this.bitmask() & 0xff)
	}

}
