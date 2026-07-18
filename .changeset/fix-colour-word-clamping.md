---
"zencontrol-tpi-node": patch
---

Colour temperature and XY values are now clamped as 16-bit words rather than per byte, fixing corruption of values with a 0xFF low byte
