---
"zencontrol-tpi-node": patch
---

Corrupt or mis-sourced response datagrams are now ignored so the retry mechanism can recover, instead of immediately failing the pending request
