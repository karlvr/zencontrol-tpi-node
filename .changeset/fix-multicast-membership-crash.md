---
"zencontrol-tpi-node": patch
---

A failure to join the multicast group when starting event monitoring is now logged and retried with backoff instead of crashing the process with an uncaught exception
