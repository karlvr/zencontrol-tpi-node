/**
 * Base exception for Zen protocol errors
 */
export class ZenError extends Error {
	constructor(message?: string) {
		super(message)
		this.name = 'ZenError'
	}
}

/**
 * Raised when a command times out
 */
export class ZenTimeoutError extends ZenError {
	constructor(message?: string) {
		super(message)
		this.name = 'ZenTimeoutError'
	}
}

/**
 * Raised when receiving an invalid response
 */
export class ZenResponseError extends ZenError {
	constructor(message?: string) {
		super(message)
		this.name = 'ZenResponseError'
	}
}

export const ZenErrorCode = {
	/** Checksum Error */
	CHECKSUM: 0x01,
	/** A short on the DALI line was detected */
	SHORT_CIRCUIT: 0x02,
	/** Receive error */
	RECEIVE_ERROR: 0x03,
	/** The command in the request is unrecognised */
	UNKNOWN_CMD: 0x04,
	/** The command requires a paid feature not purchased or enabled */
	PAID_FEATURE: 0xB0,
	/** Invalid arguments */
	INVALID_ARGS: 0xB1,
	/** The command couldn't be processed */
	CMD_REFUSED: 0xB2,
	/** A queue or buffer required to process the command is full or broken */
	QUEUE_FAILURE: 0xB3,
	/** Some feature isn't available for some reason, refer to docs */
	RESPONSE_UNAVAIL: 0xB4,
	/** The DALI related request couldn't be processed due to an error */
	OTHER_DALI_ERROR: 0xB5,
	/** A resource limit was reached on the controller */
	MAX_LIMIT: 0xB6,
	/** An unexpected result occurred */
	UNEXPECTED_RESULT: 0xB7,
	/** Device doesn't exist */
	UNKNOWN_TARGET: 0xB8,
} as const
