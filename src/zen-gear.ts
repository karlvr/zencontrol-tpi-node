export const ZenControlGearType = {
	/** A fluorescent light */
	DALI_HW_FLUORESCENT: 0,
	/** An emergency light */
	DALI_HW_EMERGENCY: 1,
	DALI_HW_DISCHARGE: 2,
	/** A halogen light */
	DALI_HW_HALOGEN: 3,
	/** An incandescent light */
	DALI_HW_INCANDESCENT: 4,
	/** Device uses DC power */
	DALI_HW_DC: 5,
	/** A LED Light */
	DALI_HW_LED: 6,
	/** A relay device */
	DALI_HW_RELAY: 7,
	/** Device has colour control/Type 8 capability */
	DALI_HW_COLOUR_CONTROL: 8,
	DALI_HW_LOAD_REFERENCING: 15,
	DALI_HW_THERMAL_GEAR_PROTECTION: 16,
	DALI_HW_DIMMING_CURVE_SELECTION: 17,
} as const

export type ZenControlGearType = (typeof ZenControlGearType)[keyof typeof ZenControlGearType]
