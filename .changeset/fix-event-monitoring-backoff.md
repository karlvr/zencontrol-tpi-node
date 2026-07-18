---
"zencontrol-tpi-node": patch
---

Event monitoring now backs off (1s doubling to 60s) before restarting after socket failures instead of restarting in a tight loop
