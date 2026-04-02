# zencontrol-tpi-node

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
