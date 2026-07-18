---
"zencontrol-tpi-node": patch
---

IPv4 address validation is now shared and strict: setTpiEventUnicastAddress rejects malformed addresses such as trailing-dot quads or hex octets that previously coerced to valid-looking octets
