---
"zencontrol-tpi-node": patch
---

Restarting event monitoring no longer triggers an endless cycle of restarts caused by the deliberate close of the previous event socket being mistaken for an unexpected close
