---
"zencontrol-tpi-node": patch
---

querySystemVariable now returns signed 16-bit values to match setSystemVariable, so negative values round-trip correctly
