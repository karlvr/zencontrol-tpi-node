# zencontrol-tpi-node

## 1.3.0

### Minor Changes

- 1a459ef: Added group_occupancy and level_change_v2 to ZenEventMask so the newest event types can be filtered
- 4a212fe: Replaced the broken querySceneLevel method with spec-compliant querySceneNumbersByAddress and querySceneLevelsByAddress

### Patch Changes

- dd4b2fd: Moved unported Python reference code out of zen-protocol.ts into PORTING.md
- 4c1a04c: Added a lint script to package.json
- ea50018: Removed unused imports from zen-protocol
- d6fe8d6: Corrected queryTpiEventEmitState documentation to match its ZenEventMode return type
- e58acd9: Absolute input events now report instances with the ABSOLUTE_INPUT type instead of PUSH_BUTTON
- 58ed515: Fixed colour change events for group targets reported in the 128-143 alias range throwing instead of invoking the callback
- fe6fa65: Colour temperature and XY values are now clamped as 16-bit words rather than per byte, fixing corruption of values with a 0xFF low byte
- 4d6e300: Fixed a race that could admit more than maxRequestsPerController concurrent requests to a controller
- 5586fc5: The event monitoring health check no longer produces an unhandled rejection when a controller query times out, and correctly triggers a restart instead
- 08eaeb2: The event monitoring health check now restarts event monitoring when a controller fails to answer the emit state query, instead of only when it answers with an unexpected state
- cdd3dd8: Event monitoring now backs off (1s doubling to 60s) before restarting after socket failures instead of restarting in a tight loop
- b459650: Restarting event monitoring no longer triggers an endless cycle of restarts caused by the deliberate close of the previous event socket being mistaken for an unexpected close
- 75cf5a2: Fixed group occupancy events failing to decode: the event target is the group number plus 64, so the callback previously never fired
- e2daa5c: ZenColour.fromHsv no longer switches on the amber and far-red channels for dark or desaturated colours; the boosts now scale with saturation and brightness, so black converts to all channels off
- 08ac727: Corrupt or mis-sourced response datagrams are now ignored so the retry mechanism can recover, instead of immediately failing the pending request
- b2d6986: A failure to join the multicast group when starting event monitoring is now logged and retried with backoff instead of crashing the process with an uncaught exception
- 85c284c: listenIp is now used as the multicast membership interface when set, for multi-homed hosts
- dec4ab4: DALI lighting commands (daliScene, daliArcLevel, daliOff, daliRecallMax/Min, daliEnableDAPCSequence, etc.) now return true on the spec-documented NO_ANSWER success response instead of false
- cf72045: Group and scene number lists are now sorted numerically rather than lexicographically
- b683b38: percentageToArcLevel now clamps its output to valid DALI arc levels, fixing invalid results for small non-zero percentages
- ccad3e3: Errors thrown by the profile change callback are now caught and logged like other event callbacks
- cc56a1a: Guarded the retry timer against reused sequence numbers so a stale timer cannot fail an unrelated request, and the sequence counter now wraps at 256
- b31e5a2: Aligned scene number validation with the spec: user scenes are 0-12, and DALI scenes 13-15 reported in group bitmasks no longer cause queryScenesForGroup to throw
- 45aa17b: sendBasicFrame no longer mutates the caller's data array when padding it
- fe6255d: IPv4 address validation is now shared and strict: setTpiEventUnicastAddress rejects malformed addresses such as trailing-dot quads or hex octets that previously coerced to valid-looking octets
- 961289e: querySystemVariable now returns signed 16-bit values to match setSystemVariable, so negative values round-trip correctly
- 492dbb7: A send error reported after a request has already completed no longer removes an unrelated request that reused the sequence number, which could leave that request's promise unsettled forever and corrupt the per-controller concurrency accounting
- 515a329: System variable change events now read the magnitude from the correct payload byte, so values with a non-zero magnitude are no longer scaled incorrectly
- 2c4cf4d: ZenColour.fromBytes now decodes a colour temperature of 0xFFFF as an unset kelvin value instead of clamping it to 20000 K, mirroring toBytes
- 7906471: tpiEventEmit no longer disables events before enabling, removing a window where events could be dropped
- 911c064: setTpiEventUnicastAddress now rejects addresses that are not IPv4 dotted-quad, instead of silently sending a malformed payload to the controller
- 14a390e: A tuneable white ZenColour with no kelvin value now serialises as 0xFFFF ("leave at current value") instead of 0 K
- 756ca54: ZenColour.equals now compares fields explicitly instead of relying on JSON serialisation order
- d2cddd1: Added regression tests for unset kelvin serialisation, chroma-scaled HSV amber/far-red boosts, and IPv4 address validation
- 57ba6eb: Added a vitest unit test suite covering the pure protocol modules

## 1.2.2

### Patch Changes

- be965f8: Fix operator precedence in absolute input event value parsing
- ac92db5: Fix ZenEventMask.upper() using multiplication instead of bitwise AND
- 6e85749: Close existing event socket before starting new event monitoring to prevent socket leak
- 9c92438: Fix event socket not being closed when stopping event monitoring
- fc70984: Close event socket on error to trigger reconnection via the close handler
- e4c391f: Add scene number validation in ZenScene constructor
- 0112a94: Fix setSystemVariable missing await, which caused it to always return true
- c42afce: Await unicast address cleanup in stopEventMonitoring to prevent dangling promises
- 0c89647: Fix race condition between response handler and timeout callback
- 9439683: Fix division by zero in XY colour toHsv() when y is 0

## 1.2.1

### Patch Changes

- Support node 24

## 1.2.0

### Minor Changes

- 6a2434f: Add `setSystemVariable`

## 1.1.0

### Minor Changes

- ff2a9ea: Query system variable result for unused variable is now `null` instead of 65535

## 1.0.0

### Major Changes

- 545b8d9: Initial release
