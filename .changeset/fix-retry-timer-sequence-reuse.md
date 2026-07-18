---
"zencontrol-tpi-node": patch
---

Guarded the retry timer against reused sequence numbers so a stale timer cannot fail an unrelated request, and the sequence counter now wraps at 256
