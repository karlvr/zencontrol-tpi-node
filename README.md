# Zencontrol TPI for Node

A node interface for using the Zencontrol Third-Party Interface (TPI).

This is extensively based on https://github.com/sjwright/zencontrol-python.

## Usage

```typescript
const controller = new ZenController({ host: '192.168.1.1', id: 0, macAddress: 'FFFFFFFFFFFF' }),
const zc = new ZenProtocol({
	controllers: [controller],
})

await zc.daliArcLevel(new ZenAddress(controller, ZenAddressType.GROUP, 7), 254)
await zc.daliOff(new ZenAddress(controller, ZenAddressType.GROUP, 8))

// Enable events
zc.startEventMonitoring()

zc.groupLevelChangeCallback = (address, arcLevel) => {
	console.log('Group level changed', address.toString(), 'to arc level', arcLevel)
}
```
