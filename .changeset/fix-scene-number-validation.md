---
"zencontrol-tpi-node": patch
---

Aligned scene number validation with the spec: user scenes are 0-12, and DALI scenes 13-15 reported in group bitmasks no longer cause queryScenesForGroup to throw
