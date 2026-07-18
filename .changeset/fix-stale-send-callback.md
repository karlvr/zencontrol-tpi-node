---
"zencontrol-tpi-node": patch
---

A send error reported after a request has already completed no longer removes an unrelated request that reused the sequence number, which could leave that request's promise unsettled forever and corrupt the per-controller concurrency accounting
