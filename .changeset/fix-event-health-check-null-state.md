---
"zencontrol-tpi-node": patch
---

The event monitoring health check now restarts event monitoring when a controller fails to answer the emit state query, instead of only when it answers with an unexpected state
