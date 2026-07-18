# PORTING.md

This file preserves reference Python implementations, taken from the Python `zen-interface` library, for TPI Advanced commands that have not yet been ported to this Node.js library. The corresponding command codes are already defined in `src/zen-commands.ts`; only the calling method and response parsing logic below remain to be translated to TypeScript.

Blocks are listed in roughly the order they appeared in `src/zen-protocol.ts`. Where a TypeScript method already exists for a command (an "alternative implementation"), the Python here documents a different approach to the same command that was also present in the reference source.

## _send_dynamic

```python
def _send_dynamic(self, controller: ZenController, command: int, data: list[int]) -> Optional[bytes]:
# Calculate data length and prepend it to data
response_data, response_code = self._send_packet_retry_and_cache(controller, command, [len(data)] + data)
# Check response type
match response_code:
    case 0xA0: # OK
        pass  # Request processed successfully
    case 0xA1: # ANSWER
        pass  # Answer is in data bytes
    case 0xA2: # NO_ANSWER
        if response_data > 0:
            if self.narration: print(f"No answer with code: {response_data}")
        return None
    case 0xA3: # ERROR
        if response_data:
            error_code = ZenErrorCode(response_data[0]) if response_data[0] in ZenErrorCode else None
            error_label = error_code.name if error_code else f"Unknown error code: {hex(response_data[0])}"
            if self.narration: print(f"Command error code: {error_label}")
        else:
            if self.narration: print("Command error (no error code)")
        return None
    case _:
        if self.narration: print(f"Unknown response type: {response_code}")
        return None
if response_data:
    return response_data
return None
```

## query_profile_label

```python
def query_profile_label(self, controller: ZenController, profile: int) -> Optional[str]:
    """Get the label for a Profile number (0-65535). Returns a string if a label exists, else None."""
    # Profile numbers are 2 bytes long, so check valid range
    if not 0 <= profile <= 65535:
        raise ValueError("Profile number must be between 0 and 65535")
    # Split profile number into upper and lower bytes
    profile_upper = (profile >> 8) & 0xFF
    profile_lower = profile & 0xFF
    # Send request
    return self._send_basic(controller, self.CMD["QUERY_PROFILE_LABEL"], 0x00, [0x00, profile_upper, profile_lower], return_type='str', cacheable=True)
```

## query_current_profile_number

```python
def query_current_profile_number(self, controller: ZenController) -> Optional[int]:
    """Get the current/active Profile number for a controller. Returns int, else None if query fails."""
    response = self._send_basic(controller, self.CMD["QUERY_CURRENT_PROFILE_NUMBER"])
    if response and len(response) >= 2: # Profile number is 2 bytes, combine them into a single integer. First byte is high byte, second is low byte
        return (response[0] << 8) | response[1]
    return None
```

## dali_add_tpi_event_filter

```python
def dali_add_tpi_event_filter(self, address: ZenAddress|ZenInstance, filter: ZenEventMask = ZenEventMask.all_events()) -> bool:
    """Stop specific events from an address/instance from being sent. Events in mask will be muted. Returns true if filter was added successfully."""
    instance_number = 0xFF
    if isinstance(address, ZenInstance):
        instance: ZenInstance = address
        instance_number = instance.number
        address = instance.address
    return self._send_basic(address.controller,
                         self.CMD["DALI_ADD_TPI_EVENT_FILTER"],
                         address.ecg_or_ecd_or_broadcast(),
                         [instance_number, filter.upper(), filter.lower()],
                         return_type='bool')
```

## query_dali_tpi_event_filters

```python
def query_dali_tpi_event_filters(self, address: ZenAddress|ZenInstance) -> list[dict]:
    """Query active event filters for an address (or a specific instance). Returns a list of dictionaries containing filter info, or None if query fails."""
    instance_number = 0xFF
    if isinstance(address, ZenInstance):
        instance: ZenInstance = address
        instance_number = instance.number
        address = instance.address

    # As the data payload can only be up to 64 bytes and there are up to 64 event filters, it may be necessary to query several times.
    # If you have all 64 event filters active, you will receive results 0-14 in the first response.
    results = []
    start_at = 0
    while True:

        response = self._send_basic(address.controller, 
                                self.CMD["QUERY_DALI_TPI_EVENT_FILTERS"],
                                address.ecg_or_ecd_or_broadcast(),
                                [start_at, 0x00, instance_number])

        # Byte 0: TPI event modes active, ignored here.
        # modes_active = response[0]

        if response and len(response) >= 5:  # Need at least modes + one result

            # Starting from the second byte (1), process results in groups of 4 bytes
            for i in range(1, len(response)-3, 4):
                result = {
                    'address': response[i],
                    'instance': response[i+1],
                    'event_mask': ZenEventMask.from_upper_lower(response[i+2], response[i+3])
                }
                results.append(result)

            if len(results) < 60: # 15 results * 4 bytes = 60 bytes. If we received fewer than 15 results, then there are no more.
                break

        else:
            break # If there are no more results, stop querying

        # To complete the set, you would request 15, 30, 45, 60 as starting numbers or until you receive None (NO_ANSWER).
        start_at += 15

    return results
```

## set_tpi_event_unicast_address (alternative implementation)

```python
def set_tpi_event_unicast_address(self, controller: ZenController, ipaddr: Optional[str] = None, port: Optional[int] = None):
    """Configure TPI Events for Unicast mode with IP and port as defined in the ZenController instance."""
    data = [0,0,0,0,0,0]
    if port is not None:
        # Valid port number
        if not 0 <= port <= 65535: raise ValueError("Port must be between 0 and 65535")

        # Split port into upper and lower bytes
        port_upper = (port >> 8) & 0xFF 
        port_lower = port & 0xFF

        # Convert IP string to bytes
        try:
            ip_bytes = [int(x) for x in ipaddr.split('.')]
            if len(ip_bytes) != 4 or not all(0 <= x <= 255 for x in ip_bytes):
                raise ValueError
        except ValueError:
            raise ValueError("Invalid IP address format")

        # Construct data payload: [port_upper, port_lower, ip1, ip2, ip3, ip4]
        data = [port_upper, port_lower] + ip_bytes

    return self._send_dynamic(controller, self.CMD["SET_TPI_EVENT_UNICAST_ADDRESS"], data)
```

## query_tpi_event_unicast_address

```python
def query_tpi_event_unicast_address(self, controller: ZenController) -> Optional[dict]:
    """Query TPI Events state and unicast configuration.
    Sends a Basic frame to query the TPI Event emit state, Unicast Port and Unicast Address.

    Args:
        controller: ZenController instance

    Returns:
        Optional dict containing:
        - bool: Whether TPI Events are enabled
        - bool: Whether Unicast mode is enabled  
        - int: Configured unicast port
        - str: Configured unicast IP address

        Returns None if query fails
    """
    response = self._send_basic(controller, self.CMD["QUERY_TPI_EVENT_UNICAST_ADDRESS"])
    if response and len(response) >= 7:
        return {
            'mode': ZenEventMode.from_byte(response[0]),
            'port': (response[1] << 8) | response[2],
            'ip': f"{response[3]}.{response[4]}.{response[5]}.{response[6]}"
        }
    return None
```

## query_dali_colour

```python
def query_dali_colour(self, address: ZenAddress) -> Optional[ZenColour]:
    """Query colour information from a DALI address."""
    response = self._send_basic(address.controller, self.CMD["QUERY_DALI_COLOUR"], address.ecg())
    return ZenColour.from_bytes(response)
```

## query_profile_information

```python
def query_profile_information(self, controller: ZenController) -> Optional[tuple[dict, dict]]:
    """Query a controller for profile information. Returns a tuple of two dicts, or None if query fails."""
    response = self._send_basic(controller, self.CMD["QUERY_PROFILE_INFORMATION"], cacheable=True)
    # Initial 12 bytes:
    # 0-1 0x00 Current Active Profile Number
    # 2-3 0x00 Last Scheduled Profile Number
    # 4-7 0x22334455 Last Overridden Profile UTC
    # 8-11 0x44556677 Last Scheduled Profile UTC
    unpacked = struct.unpack('>HHII', response[0:12])
    state = {
        'current_active_profile': unpacked[0],
        'last_scheduled_profile': unpacked[1],
        'last_overridden_profile_utc': dt.fromtimestamp(unpacked[2]),
        'last_scheduled_profile_utc': dt.fromtimestamp(unpacked[3])
    }
    # Process profiles in groups of 3 bytes (2 bytes for profile number, 1 byte for profile behaviour)
    profiles: dict[int, int] = {}
    for i in range(12, len(response), 3):
        profile_number = struct.unpack('>H', response[i:i+2])[0]
        profile_behaviour = response[i+2]
        # bit 0: enabled: 0 = disabled, 1 = enabled
        # bit 1-2: priority: two bit int where 0 = scheduled, 1 = medium, 2 = high, 3 = emergency
        enabled = not bool(profile_behaviour & 0x01)
        priority = (profile_behaviour >> 1) & 0x03
        priority_label = ["Scheduled", "Medium", "High", "Emergency"][priority]
        profiles[profile_number] = {"enabled": enabled, "priority": priority, "priority_label": priority_label}
    # Return tuple of state and profiles
    return state, profiles
```

## query_profile_numbers

```python
def query_profile_numbers(self, controller: ZenController) -> Optional[list[int]]:
    """Query a controller for a list of available Profile Numbers. Returns a list of profile numbers, or None if query fails."""
    response = self._send_basic(controller, self.CMD["QUERY_PROFILE_NUMBERS"])
    if response and len(response) >= 2:
        # Response contains pairs of bytes for each profile number
        profile_numbers = []
        for i in range(0, len(response), 2):
            if i + 1 < len(response):
                profile_num = (response[i] << 8) | response[i+1]
                profile_numbers.append(profile_num)
        return profile_numbers
    return None
```

## query_occupancy_instance_timers

```python
def query_occupancy_instance_timers(self, instance: ZenInstance) -> Optional[dict]:
    """Query timer values for a DALI occupancy sensor instance. Returns dict, or None if query fails.

    Returns:
        dict:
            - int: Deadtime in seconds (0-255)
            - int: Hold time in seconds (0-255)
            - int: Report time in seconds (0-255)
            - int: Seconds since last occupied status (0-255)
    """
    response = self._send_basic(instance.address.controller, self.CMD["QUERY_OCCUPANCY_INSTANCE_TIMERS"], instance.address.ecd(), [0x00, 0x00, instance.number])
    if response and len(response) >= 5:
        return {
            'deadtime': response[0],
            'hold': response[1],
            'report': response[2],
            'last_detect': (response[3] << 8) | response[4]
        }
    return None
```

## query_instances_by_address

```python
def query_instances_by_address(self, address: ZenAddress) -> list[ZenInstance]:
    """Query a DALI address (ECD) for associated instances. Returns a list of ZenInstance, or an empty list if nothing found."""
    response = self._send_basic(address.controller, self.CMD["QUERY_INSTANCES_BY_ADDRESS"], address.ecd())
    if response and len(response) >= 4:
        instances = []
        # Process groups of 4 bytes for each instance
        for i in range(0, len(response), 4):
            if i + 3 < len(response):
                instances.append(ZenInstance(
                    address=address,
                    number=response[i], # first byte
                    type=ZenInstanceType(response[i+1]) if response[i+1] in ZenInstanceType._value2member_map_ else None, # second byte
                    active=bool(response[i+2] & 0x02), # third byte, second bit
                    error=bool(response[i+2] & 0x01), # third byte, first bit
                ))
        return instances
    return []
```

## query_operating_mode_by_address

```python
def query_operating_mode_by_address(self, address: ZenAddress) -> Optional[int]:
    """Query a DALI address (ECG or ECD) for its operating mode. Returns an int containing the operating mode value, or None if the query fails."""
    response = self._send_basic(address.controller, self.CMD["QUERY_OPERATING_MODE_BY_ADDRESS"], address.ecg_or_ecd())
    if response and len(response) == 1:
        return response[0]  # Operating mode is in first byte
    return None
```

## query_scene_numbers_by_address

```python
def query_scene_numbers_by_address(self, address: ZenAddress) -> Optional[list[int]]:
    """Query a DALI address (ECG) for associated scenes. Returns a list of scene numbers where levels have been set."""
    return self._send_basic(address.controller, self.CMD["QUERY_SCENE_NUMBERS_BY_ADDRESS"], address.ecg(), return_type='list')
```

## query_scene_levels_by_address

```python
def query_scene_levels_by_address(self, address: ZenAddress) -> list[Optional[int]]:
    """Query a DALI address (ECG) for its DALI scene levels. Returns a list of 16 scene level values (0-254, or None if not part of scene)."""
    response = self._send_basic(address.controller, self.CMD["QUERY_SCENE_LEVELS_BY_ADDRESS"], address.ecg(), return_type='list')
    if response:
        return [None if x == 255 else x for x in response]
    return [None] * Const.MAX_SCENE
```

## query_colour_scene_membership_by_address

```python
def query_colour_scene_membership_by_address(self, address: ZenAddress) -> list[int]:
    """Query a DALI address (ECG) for which scenes have colour change data. Returns a list of scene numbers."""
    response = self._send_basic(address.controller, self.CMD["QUERY_COLOUR_SCENE_MEMBERSHIP_BY_ADDR"], address.ecg(), return_type='list')
    if response:
        return response
    return None
```

## query_scene_colours_by_address

```python
def query_scene_colours_by_address(self, address: ZenAddress) -> list[Optional[ZenColour]]:
    """Query a DALI address (ECG) for its colour scene data. Returns a list of 16 scene level values (0-254, or None if not part of scene)."""
    # Create a list of 12 ZenColour instances
    output: list[Optional[ZenColour]] = [None] * Const.MAX_SCENE
    # Queries
    response = self._send_basic(address.controller, self.CMD["QUERY_COLOUR_SCENE_0_7_DATA_FOR_ADDR"], address.ecg())
    if response is None:
        return output
    response += self._send_basic(address.controller, self.CMD["QUERY_COLOUR_SCENE_8_11_DATA_FOR_ADDR"], address.ecg())
    # Combined result should always be exactly 7*12 = 84 bytes
    if len(response) != 84:
        print(f"Warning: QUERY_COLOUR_SCENE_***_DATA_FOR_ADDR returned {len(response)} bytes, expected 84")
        return output
    # Data is in 7 byte segments
    for i in range(0, Const.MAX_SCENE):
        offset = i*7
        output[i] = ZenColour.from_bytes(response[offset:offset+7])
    return output
```

## query_dali_addresses_with_instances

```python
def query_dali_addresses_with_instances(self, controller: ZenController, start_address: int=0) -> list[ZenAddress]: # TODO: automate iteration over start_address=0, start_address=60, etc.
    """Query for DALI addresses that have instances associated with them.

    Due to payload restrictions, this needs to be called multiple times with different
    start addresses to check all possible devices (e.g. start_address=0, then start_address=60)

    Args:
        controller: ZenController instance
        start_address: Starting DALI address to begin searching from (0-127)

    Returns:
        List of DALI addresses that have instances, or None if query fails
    """
    addresses = self._send_basic(controller, self.CMD["QUERY_DALI_ADDRESSES_WITH_INSTANCES"], 0, [0,0,start_address], return_type='list')
    if not addresses:
        return []
    zen_addresses = []
    for number in addresses:
        if 64 <= number <= 127:  # Only process valid device addresses (64-127)
            zen_addresses.append(ZenAddress(
                controller=controller,
                type=ZenAddressType.ECD,
                number=number-64 # subtract 64 to get actual DALI device address
            ))
    return zen_addresses
```

## dali_on_step_up

```python
def dali_on_step_up(self, address: ZenAddress) -> bool:
    """Send ON AND STEP UP to an address (ECG or group or broadcast). If a device is off, it will turn it on. If a device is on, it will step up. No fade."""
    return self._send_basic(address.controller, self.CMD["DALI_ON_STEP_UP"], address.ecg_or_group_or_broadcast(), return_type='ok')
```

## dali_step_down_off

```python
def dali_step_down_off(self, address: ZenAddress) -> bool:
    """Send STEP DOWN AND OFF to an address (ECG or group or broadcast). If a device is at min, it will turn off. If a device isn't yet at min, it will step down. No fade."""
    return self._send_basic(address.controller, self.CMD["DALI_STEP_DOWN_OFF"], address.ecg_or_group_or_broadcast(), return_type='ok')
```

## dali_up

```python
def dali_up(self, address: ZenAddress) -> bool:
    """Send DALI UP to an address (ECG or group or broadcast). Will fade to the new level. Returns `true` if acknowledged, else `false`."""
    return self._send_basic(address.controller, self.CMD["DALI_UP"], address.ecg_or_group_or_broadcast(), return_type='ok')
```

## dali_down

```python
def dali_down(self, address: ZenAddress) -> bool:
    """Send DALI DOWN to an address (ECG or group or broadcast). Will fade to the new level. Returns `true` if acknowledged, else `false`."""
    return self._send_basic(address.controller, self.CMD["DALI_DOWN"], address.ecg_or_group_or_broadcast(), return_type='ok')
```

## dali_query_control_gear_status

```python
def dali_query_control_gear_status(self, address: ZenAddress) -> Optional[dict]:
    """Query the Status for a DALI address (ECG or group or broadcast). Returns a dictionary of status flags."""
    response = self._send_basic(address.controller, self.CMD["DALI_QUERY_CONTROL_GEAR_STATUS"], address.ecg_or_group_or_broadcast())
    if response and len(response) == 1:
        return {
            "cg_failure": bool(response[0] & 0x01),
            "lamp_failure": bool(response[0] & 0x02),
            "lamp_power_on": bool(response[0] & 0x04),
            "limit_error": bool(response[0] & 0x08), # (an Arc-level > Max or < Min requested)
            "fade_running": bool(response[0] & 0x10),
            "reset": bool(response[0] & 0x20),
            "missing_short_address": bool(response[0] & 0x40),
            "power_failure": bool(response[0] & 0x80)
        }
    return None
```

## dali_query_last_scene

```python
def dali_query_last_scene(self, address: ZenAddress) -> Optional[int]:
    """Query the last heard Scene for a DALI address (ECG or group or broadcast). Returns scene number, or None if query fails.

    Note:
        Changes to a single DALI device done through group or broadcast scene commands
        also change the last heard scene for the individual device address. For example,
        if A10 is member of G0 and we send a scene command to G0, A10 will show the 
        same last heard scene as G0.
    """
    return self._send_basic(address.controller, self.CMD["DALI_QUERY_LAST_SCENE"], address.ecg_or_group_or_broadcast(), return_type='int')
```

## dali_query_last_scene_is_current

```python
def dali_query_last_scene_is_current(self, address: ZenAddress) -> Optional[bool]:
    """Query if the last heard scene is the current active scene for a DALI address (ECG or group or broadcast).
    Returns `true` if still active, False if another command has been issued since, or None if query fails."""
    return self._send_basic(address.controller, self.CMD["DALI_QUERY_LAST_SCENE_IS_CURRENT"], address.ecg_or_group_or_broadcast(), return_type='bool')
```

## dali_query_min_level

```python
def dali_query_min_level(self, address: ZenAddress) -> Optional[int]:
    """Query a DALI address (ECG) for its minimum level (0-254). Returns the minimum level if successful, None if query fails."""
    return self._send_basic(address.controller, self.CMD["DALI_QUERY_MIN_LEVEL"], address.ecg(), return_type='int')
```

## dali_query_max_level

```python
def dali_query_max_level(self, address: ZenAddress) -> Optional[int]:
    """Query a DALI address (ECG) for its maximum level (0-254). Returns the maximum level if successful, None if query fails."""
    return self._send_basic(address.controller, self.CMD["DALI_QUERY_MAX_LEVEL"], address.ecg(), return_type='int')
```

## dali_query_fade_running

```python
def dali_query_fade_running(self, address: ZenAddress) -> Optional[bool]:
    """Query a DALI address (ECG) if a fade is currently running. Returns `true` if a fade is currently running, False if not, None if query fails."""
    return self._send_basic(address.controller, self.CMD["DALI_QUERY_FADE_RUNNING"], address.ecg(), return_type='bool')
```

## query_dali_ean

```python
def query_dali_ean(self, address: ZenAddress) -> Optional[int]:
    """Query a DALI address (ECG or ECD) for its European Article Number (EAN/GTIN). Returns an integer if successful, None if query fails."""
    response = self._send_basic(address.controller, self.CMD["QUERY_DALI_EAN"], address.ecg_or_ecd())
    if response and len(response) == 6:
        ean = 0
        for byte in response:
            ean = (ean << 8) | byte
        return ean
    return None
```

## query_dali_serial (alternative implementation)

```python
def query_dali_serial(self, address: ZenAddress) -> Optional[int]:
    """Query a DALI address (ECG or ECD) for its Serial Number. Returns an integer if successful, None if query fails."""
    response = self._send_basic(address.controller, self.CMD["QUERY_DALI_SERIAL"], address.ecg_or_ecd())
    if response and len(response) == 8:
        # Convert 8 bytes to decimal integer
        serial = 0
        for byte in response:
            serial = (serial << 8) | byte
        return serial
    return None
```

## dali_custom_fade

```python
def dali_custom_fade(self, address: ZenAddress, level: int, seconds: int) -> bool:
    """Fade a DALI address (ECG or group) to a level (0-254) with a custom fade time in seconds (0-65535). Returns `true` if successful, else `false`."""
    if not 0 <= level < Const.MAX_LEVEL:
        raise ValueError("Target level must be between 0 and 254")
    if not 0 <= seconds <= 65535:
        raise ValueError("Fade time must be between 0 and 65535 seconds")

    # Convert fade time to integer seconds and split into high/low bytes
    seconds_hi = (seconds >> 8) & 0xFF
    seconds_lo = seconds & 0xFF

    return self._send_basic(
        address.controller,
        self.CMD["DALI_CUSTOM_FADE"],
        address.ecg_or_group(),
        [level, seconds_hi, seconds_lo],
        return_type='ok'
    )
```

## dali_go_to_last_active_level

```python
def dali_go_to_last_active_level(self, address: ZenAddress) -> bool:
    """Command a DALI Address (ECG or group) to go to its "Last Active" level. Returns `true` if successful, else `false`."""
    return self._send_basic(address.controller, self.CMD["DALI_GO_TO_LAST_ACTIVE_LEVEL"], address.ecg_or_group(), return_type='ok')
```

## query_dali_instance_label

```python
def query_dali_instance_label(self, instance: ZenInstance, generic_if_none: bool=False) -> Optional[str]:
    """Query the label for a DALI Instance. Returns a string, or None if not set. Optionally, returns a generic label if the instance label is not set."""
    label = self._send_basic(instance.address.controller, self.CMD["QUERY_DALI_INSTANCE_LABEL"], instance.address.ecd(), [0x00, 0x00, instance.number], return_type='str', cacheable=True)
    if label is None and generic_if_none:
        label = instance.type.name.title().replace("_", " ")  + " " + str(instance.number)
    return label
```

## change_profile_number

```python
def change_profile_number(self, controller: ZenController, profile: int) -> bool:
    """Change the active profile number (0-65535). Returns `true` if successful, else `false`."""
    if not 0 <= profile <= 0xFFFF: raise ValueError("Profile number must be between 0 and 65535")
    profile_hi = (profile >> 8) & 0xFF
    profile_lo = profile & 0xFF
    return self._send_basic(controller, self.CMD["CHANGE_PROFILE_NUMBER"], 0x00, [0x00, profile_hi, profile_lo], return_type='ok')
```

## return_to_scheduled_profile

```python
def return_to_scheduled_profile(self, controller: ZenController) -> bool:
    """Return to the scheduled profile. Returns `true` if successful, else `false`."""
    return self.change_profile_number(controller, 0xFFFF) # See docs page 91, 0xFFFF returns to scheduled profile
```

## query_instance_groups

```python
def query_instance_groups(self, instance: ZenInstance) -> Optional[tuple[int, int, int]]: # TODO: replace Tuple with dict
    """Query the group targets associated with a DALI instance.

    Returns:
        Optional tuple containing:
        - int: Primary group number (0-15, or 255 if not configured)
        - int: First group number (0-15, or 255 if not configured) 
        - int: Second group number (0-15, or 255 if not configured)

        Returns None if query fails

    The Primary group typically represents where the physical device resides.
    A group number of 255 (0xFF) indicates that no group has been configured.
    """
    response = self._send_basic(
        instance.address.controller,
        self.CMD["QUERY_INSTANCE_GROUPS"], 
        instance.address.ecd(),
        [0x00, 0x00, instance.number],
        return_type='list'
    )
    if response and len(response) == 3:
        return (
            response[0] if response[0] != 0xFF else None,
            response[1] if response[1] != 0xFF else None,
            response[2] if response[2] != 0xFF else None
        )
    return None
```

## query_dali_fitting_number

```python
def query_dali_fitting_number(self, address: ZenAddress) -> Optional[str]:
    """Query a DALI address (ECG or ECD) for its fitting number. Returns the fitting number (e.g. '1.2') or a generic identifier if the address doesn't exist, or None if the query fails."""
    return self._send_basic(address.controller, self.CMD["QUERY_DALI_FITTING_NUMBER"], address.ecg_or_ecd(), return_type='str', cacheable=True)
```

## query_dali_instance_fitting_number

```python
def query_dali_instance_fitting_number(self, instance: ZenInstance) -> Optional[str]:
    """Query a DALI instance for its fitting number. Returns a string (e.g. '1.2.0') or None if query fails."""
    return self._send_basic(instance.address.controller, self.CMD["QUERY_DALI_INSTANCE_FITTING_NUMBER"], instance.address.ecd(), [0x00, 0x00, instance.number], return_type='str')
```

## query_controller_label

```python
def query_controller_label(self, controller: ZenController) -> Optional[str]:
    """Request the label for the controller. Returns the controller's label string, or None if query fails."""
    return self._send_basic(controller, self.CMD["QUERY_CONTROLLER_LABEL"], return_type='str', cacheable=True)
```

## query_controller_fitting_number

```python
def query_controller_fitting_number(self, controller: ZenController) -> Optional[str]:
    """Request the fitting number string for the controller itself. Returns the controller's fitting number (e.g. '1'), or None if query fails."""
    return self._send_basic(controller, self.CMD["QUERY_CONTROLLER_FITTING_NUMBER"], return_type='str')
```

## query_is_dali_ready

```python
def query_is_dali_ready(self, controller: ZenController) -> bool:
    """Query whether the DALI line is ready or has a fault. Returns `true` if DALI line is ready, False if there is a fault."""
    return self._send_basic(controller, self.CMD["QUERY_IS_DALI_READY"], return_type='ok')
```

## query_controller_startup_complete

```python
def query_controller_startup_complete(self, controller: ZenController) -> bool:
    """Query whether the controller has finished its startup sequence. Returns `true` if startup is complete, False if still in progress.

    The startup sequence performs DALI queries such as device type, current arc-level, GTIN, 
    serial number, etc. The more devices on a DALI line, the longer startup will take to complete.
    For a line with only a handful of devices, expect it to take approximately 1 minute.
    Waiting for the startup sequence to complete is particularly important if you wish to 
    perform queries about DALI.
    """
    return self._send_basic(controller, self.CMD["QUERY_CONTROLLER_STARTUP_COMPLETE"], return_type='ok')
```

## override_dali_button_led_state

```python
def override_dali_button_led_state(self, instance: ZenInstance, led_state: bool) -> bool:
    """Override the LED state for a DALI push button. State is True for LED on, False for LED off. Returns true if command succeeded, else `false`."""
    return self._send_basic(instance.address.controller,
                           self.CMD["OVERRIDE_DALI_BUTTON_LED_STATE"],
                           instance.address.ecd(),
                           [0x00, 0x02 if led_state else 0x01, instance.number],
                           return_type='ok')
```

## query_last_known_dali_button_led_state

```python
def query_last_known_dali_button_led_state(self, instance: ZenInstance) -> Optional[bool]:
    """Query the last known LED state for a DALI push button. Returns `true` if LED is on, False if LED is off, None if query failed

    Note: The "last known" LED state may not be the actual physical LED state.
    This only works for LED modes where the controller or TPI caller is managing
    the LED state. In many cases, the control device itself manages its own LED.
    """
    response = self._send_basic(instance.address.controller,
                               self.CMD["QUERY_LAST_KNOWN_DALI_BUTTON_LED_STATE"],
                               instance.address.ecd(),
                               [0x00, 0x00, instance.number])
    if response and len(response) == 1:
        match response[0]:
            case 0x01: return False
            case 0x02: return True
    return None
```

## dali_stop_fade

```python
def dali_stop_fade(self, address: ZenAddress) -> bool:
    """Tell a DALI address (ECG or ECD) to stop running a fade. Returns `true` if command succeeded, else `false`.

    Caution: this literally stops the fade. It doesn't jump to the target level.

    Note: For custom fades started via DALI_CUSTOM_FADE, this can only stop
    fades that were started with the same target address. For example, you 
    cannot stop a custom fade on a single address if it was started as part
    of a group or broadcast fade.
    """
    return self._send_basic(address.controller, self.CMD["DALI_STOP_FADE"], address.ecg_or_group_or_broadcast(), return_type='ok')
```

## query_dali_colour_features

```python
def query_dali_colour_features(self, address: ZenAddress) -> Optional[dict]:
    """Query the colour features/capabilities of a DALI device.

    Args:
        address: ZenAddress

    Returns:
        Dictionary containing colour capabilities, or None if query failed:
        {
            'supports_xy': bool,          # Supports CIE 1931 XY coordinates
            'primary_count': int,         # Number of primaries (0-7)
            'rgbwaf_channels': int,      # Number of RGBWAF channels (0-7)
        }
    """
    response = self._send_basic(address.controller, self.CMD["QUERY_DALI_COLOUR_FEATURES"], address.ecg(), cacheable=True)
    if response and len(response) == 1:
        features = response[0]
        return {
            'supports_xy': bool(features & 0x01),      # Bit 0
            'supports_tunable': bool(features & 0x02), # Bit 1
            'primary_count': (features & 0x1C) >> 2,   # Bits 2-4
            'rgbwaf_channels': (features & 0xE0) >> 5, # Bits 5-7
        }
    elif response is None:
        return {
            'supports_xy': False,
            'supports_tunable': False,
            'primary_count': 0,
            'rgbwaf_channels': 0,
        }
    return None
```

## query_dali_colour_temp_limits

```python
def query_dali_colour_temp_limits(self, address: ZenAddress) -> Optional[dict]:
    """Query the colour temperature limits of a DALI device.

    Args:
        controller: ZenController instance
        gear: DALI address (0-63)

    Returns:
        Dictionary containing colour temperature limits in Kelvin, or None if query failed:
        {
            'physical_warmest': int,  # Physical warmest temp limit (K)
            'physical_coolest': int,  # Physical coolest temp limit (K) 
            'soft_warmest': int,      # Configured warmest temp limit (K)
            'soft_coolest': int,      # Configured coolest temp limit (K)
            'step_value': int         # Step value (K)
        }
    """
    response = self._send_basic(address.controller, self.CMD["QUERY_DALI_COLOUR_TEMP_LIMITS"], address.ecg(), cacheable=True)
    if response and len(response) == 10:
        return {
            'physical_warmest': (response[0] << 8) | response[1],
            'physical_coolest': (response[2] << 8) | response[3],
            'soft_warmest': (response[4] << 8) | response[5],
            'soft_coolest': (response[6] << 8) | response[7],
            'step_value': (response[8] << 8) | response[9]
        }
    return None
```
