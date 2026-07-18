---
"zencontrol-tpi-node": patch
---

ZenColour.fromHsv no longer switches on the amber and far-red channels for dark or desaturated colours; the boosts now scale with saturation and brightness, so black converts to all channels off
