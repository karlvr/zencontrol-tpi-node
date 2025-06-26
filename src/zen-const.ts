export const ZenConst = {
	// UDP protocol
	MAGIC_BYTE: 0x04,
	RESPONSE_TIMEOUT: 1000, // In rare circumstances 0.5 seconds can be too short. 1 second is sufficient. Any longer is a cure worse than the disease
	DEFAULT_MAX_REQUESTS_PER_CONTROLLER: 8,
	DEFAULT_MAX_RETRIES: 5,

	// DALI limits
	MAX_ECG: 64, // 0-63
	MAX_ECD: 64, // 0-63
	MAX_INSTANCE: 32, // 0-31
	MAX_GROUP: 16, // 0-15
	MAX_SCENE: 12, // 0-11
	MAX_SYSVAR: 148, // 0-147
	MAX_LEVEL: 254, // 255 is mask value (i.e. no change)
	MIN_KELVIN: 1000,
	MAX_KELVIN: 20000,

	// Multicast
	MULTICAST_GROUP: '239.255.90.67',
	MULTICAST_PORT: 6969,

	// Unicast
	DEFAULT_UNICAST_PORT: 5108,

	// Cache
	CACHE_TIMEOUT: 3600,
} as const
