/** Converts a DALI arc level between 0 and 254 to a percentage between 0 and 100. */
export function arcLevelToPercentage(arcLevel: number): number {
	if (arcLevel < 0 || arcLevel > 254) {
		throw new Error(`Invalid arc level: ${arcLevel}`)
	}
	if (arcLevel === 0) {
		return 0
	}

	return Math.pow(10, 3 * (arcLevel - 1) / 253 - 1)
}

/** Converts a percentage brightness between 0 and 100 to a DALI arc level between 0 and 254. */
export function percentageToArcLevel(percentage: number): number {
	if (percentage < 0 || percentage > 100) {
		throw new Error(`Invalid percentage brightness: ${percentage}`)
	}
	if (percentage === 0) {
		return 0
	}

	return Math.round((Math.log10(percentage) + 1) * 253 / 3 + 1)
}
