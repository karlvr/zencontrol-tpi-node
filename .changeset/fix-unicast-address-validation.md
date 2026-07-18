---
"zencontrol-tpi-node": patch
---

setTpiEventUnicastAddress now rejects addresses that are not IPv4 dotted-quad, instead of silently sending a malformed payload to the controller
