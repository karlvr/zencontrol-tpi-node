---
"zencontrol-tpi-node": patch
---

ZenColour.fromBytes now decodes a colour temperature of 0xFFFF as an unset kelvin value instead of clamping it to 20000 K, mirroring toBytes
