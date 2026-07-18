---
"zencontrol-tpi-node": patch
---

Fixed group occupancy events failing to decode: the event target is the group number plus 64, so the callback previously never fired
