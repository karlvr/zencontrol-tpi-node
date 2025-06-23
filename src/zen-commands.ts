export const CMD = {
	// Controller
	'QUERY_CONTROLLER_VERSION_NUMBER': 0x1C,    // Query ZenController Version Number
	'QUERY_CONTROLLER_LABEL': 0x24,             // Query the label of the controller
	'QUERY_CONTROLLER_FITTING_NUMBER': 0x25,    // Query the fitting number of the controller itself
	'QUERY_CONTROLLER_STARTUP_COMPLETE': 0x27,  // Query whether controller startup is complete
	'QUERY_IS_DALI_READY': 0x26,                // Query whether DALI bus is ready (or has a fault)
	// System variables
	'SET_SYSTEM_VARIABLE': 0x36,                // Set a system variable value
	'QUERY_SYSTEM_VARIABLE': 0x37,              // Query system variable
	'QUERY_SYSTEM_VARIABLE_NAME': 0x42,         // Query the name of a system variable
	// TPI settings
	'ENABLE_TPI_EVENT_EMIT': 0x08,              // Enable or disable TPI Events
	'QUERY_TPI_EVENT_EMIT_STATE': 0x07,         // Query whether TPI Events are enabled or disabled
	'DALI_ADD_TPI_EVENT_FILTER': 0x31,          // Request that filters be added for DALI TPI Events
	'QUERY_DALI_TPI_EVENT_FILTERS': 0x32,       // Query DALI TPI Event filters on a address
	'DALI_CLEAR_TPI_EVENT_FILTERS': 0x33,       // Request that DALI TPI Event filters be cleared
	'SET_TPI_EVENT_UNICAST_ADDRESS': 0x40,      // Set a TPI Events unicast address and port
	'QUERY_TPI_EVENT_UNICAST_ADDRESS': 0x41,    // Query TPI Events State, unicast address and port
	// Any address
	'QUERY_OPERATING_MODE_BY_ADDRESS': 0x28,    // Query the operating mode for a device
	'QUERY_DALI_DEVICE_LABEL': 0x03,            // Query the label for a DALI ECD or ECG by address
	'QUERY_DALI_SERIAL': 0xB9,                  // Query the Serial Number at a address
	'QUERY_DALI_FITTING_NUMBER': 0x22,          // Query the fitting number for control gear/devices
	'QUERY_DALI_EAN': 0xB8,                     // Query the DALI European Article Number at an address
	// Groups / Group-scenes
	'QUERY_GROUP_MEMBERSHIP_BY_ADDRESS': 0x15,  // Query DALI Group membership by address
	'QUERY_GROUP_NUMBERS': 0x09,                // Query the DALI Group numbers
	'QUERY_GROUP_LABEL': 0x01,                  // Query the label for a DALI Group by Group Number
	'QUERY_SCENE_NUMBERS_FOR_GROUP': 0x1A,      // Query Scene Numbers attributed to a group
	'QUERY_SCENE_LABEL_FOR_GROUP': 0x1B,        // Query Scene Labels attributed to a group scene
	'QUERY_GROUP_BY_NUMBER': 0x12,              // Query DALI Group information by Group Number
	// Profiles
	'QUERY_PROFILE_INFORMATION': 0x43,          // Query profile numbers, behaviours etc
	'QUERY_PROFILE_NUMBERS': 0x0B,              // Query all available Profile numbers (superseded by QUERY_PROFILE_INFORMATION)
	'QUERY_PROFILE_LABEL': 0x04,                // Query the label for a controller profile
	'QUERY_CURRENT_PROFILE_NUMBER': 0x05,       // Query the current profile number
	'CHANGE_PROFILE_NUMBER': 0xC0,              // Request a Profile Change on the controller
	// Instances
	'QUERY_DALI_ADDRESSES_WITH_INSTANCES': 0x16, // Query DALI addresses that have instances
	'QUERY_INSTANCES_BY_ADDRESS': 0x0D,         // Query information of instances
	'QUERY_DALI_INSTANCE_FITTING_NUMBER': 0x23, // Query the fitting number for an instance
	'QUERY_DALI_INSTANCE_LABEL': 0xB7,          // Query DALI Instance for its label
	'QUERY_INSTANCE_GROUPS': 0x21,              // Query group targets related to an instance
	'QUERY_OCCUPANCY_INSTANCE_TIMERS': 0x0C,    // Query an occupancy instance for its timer values
	// ECG (Lights)
	'QUERY_CONTROL_GEAR_DALI_ADDRESSES': 0x1D,  // Query Control Gear present in database
	'DALI_QUERY_LEVEL': 0xAA,                   // Query the the level on a address
	'DALI_QUERY_CG_TYPE': 0xAC,                 // Query Control Gear type data on a address
	'QUERY_DALI_COLOUR_FEATURES': 0x35,         // Query the DALI colour features/capabilities
	'QUERY_DALI_COLOUR_TEMP_LIMITS': 0x38,      // Query Colour Temperature max/min + step in Kelvin
	'DALI_QUERY_CONTROL_GEAR_STATUS': 0xAB,     // Query status data on a address, group or broadcast
	'QUERY_DALI_COLOUR': 0x34,                  // Query the Colour information on a DALI target
	'DALI_COLOUR': 0x0E,                        // Set a DALI target to a colour
	'DALI_INHIBIT': 0xA0,                       // Inhibit sensors from affecting a target for n seconds
	'DALI_ARC_LEVEL': 0xA2,                     // Set an Arc-Level on a address
	'DALI_ON_STEP_UP': 0xA3,                    // On-if-Off and Step Up on a address
	'DALI_STEP_DOWN_OFF': 0xA4,                 // Step Down and off-at-min on a address
	'DALI_UP': 0xA5,                            // Step Up on a address
	'DALI_DOWN': 0xA6,                          // Step Down on a address
	'DALI_RECALL_MAX': 0xA7,                    // Recall the max level on a address
	'DALI_RECALL_MIN': 0xA8,                    // Recall the min level on a address
	'DALI_OFF': 0xA9,                           // Set a address to Off
	'DALI_QUERY_MIN_LEVEL': 0xAF,               // Query the min level for a DALI device
	'DALI_QUERY_MAX_LEVEL': 0xB0,               // Query the max level for a DALI device
	'DALI_QUERY_FADE_RUNNING': 0xB1,            // Query whether a fade is running on a address
	'DALI_ENABLE_DAPC_SEQ': 0xB2,               // Begin a DALI DAPC sequence
	'DALI_CUSTOM_FADE': 0xB4,                   // Call a DALI Arc Level with a custom fade-length
	'DALI_GO_TO_LAST_ACTIVE_LEVEL': 0xB5,       // Command DALI addresses to go to last active level
	'DALI_STOP_FADE': 0xC1,                     // Request a running DALI fade be stopped
	// Scenes
	'QUERY_SCENE_NUMBERS_BY_ADDRESS': 0x14,     // Query for DALI Scenes an address has levels for
	'QUERY_SCENE_LEVELS_BY_ADDRESS': 0x1E,      // Query Scene level values for a given address
	'DALI_SCENE': 0xA1,                         // Call a DALI Scene on a address
	'DALI_QUERY_LAST_SCENE': 0xAD,              // Query Last heard DALI Scene
	'DALI_QUERY_LAST_SCENE_IS_CURRENT': 0xAE,   // Query if last heard Scene is current scene
	'QUERY_COLOUR_SCENE_MEMBERSHIP_BY_ADDR': 0x44, // Query a list of scenes with colour change data for an address
	'QUERY_COLOUR_SCENE_0_7_DATA_FOR_ADDR': 0x45, // Query the colour control data for scenes 0-7
	'QUERY_COLOUR_SCENE_8_11_DATA_FOR_ADDR': 0x46, // Query the colour control data for scenes 8-11

	// Implemented but not tested
	'OVERRIDE_DALI_BUTTON_LED_STATE': 0x29,     // Override a button LED state
	'QUERY_LAST_KNOWN_DALI_BUTTON_LED_STATE': 0x30, // Query button last known button LED state

	// Won't implement (because I can't test)
	'TRIGGER_SDDP_IDENTIFY': 0x06,              // Trigger a Control4 SDDP Identify
	'DMX_COLOUR': 0x10,                         // Send values to a set of DMX channels and configure fading
	'QUERY_DMX_DEVICE_NUMBERS': 0x17,           // Query DMX Device information
	'QUERY_DMX_DEVICE_BY_NUMBER': 0x18,         // Query for DMX Device information by channel number
	'QUERY_DMX_LEVEL_BY_CHANNEL': 0x19,         // Query DMX Channel value by Channel number
	'QUERY_DMX_DEVICE_LABEL_BY_NUMBER': 0x20,   // Query DMX Device for its label
	'VIRTUAL_INSTANCE': 0xB3,                   // Perform an action on a Virtual Instance
	'QUERY_VIRTUAL_INSTANCES': 0xB6,            // Query for virtual instances and their types

	// Deprecated (described as a legacy command in docs)
	'QUERY_SCENE_LABEL': 0x02,
	'QUERY_SCENE_NUMBERS': 0x0A,
	'QUERY_SCENE_BY_NUMBER': 0x13,
} as const

export type ZenCommand = keyof typeof CMD
