---
"zencontrol-tpi-node": patch
---

System variable change events now read the magnitude from the correct payload byte, so values with a non-zero magnitude are no longer scaled incorrectly
