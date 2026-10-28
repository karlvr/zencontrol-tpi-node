---
"zencontrol-tpi-node": patch
---

Requests are no longer resent after an event-loop stall when their response has already arrived. Previously the retry timer ran before the waiting response was read, so the controller answered twice and the duplicate logged "Received message with unknown sequence number"
