import { ZenConst } from './zen-const.js'

export enum ZenColourType {
	XY = 0x10,
	TC = 0x20,
	RGBWAF = 0x80,
}

export interface ZenColourXY {
	type: ZenColourType.XY
	x: number
	y: number
}

export interface ZenColourTC {
	type: ZenColourType.TC
	kelvin?: number
}

export interface ZenColourRGBWAF {
	type: ZenColourType.RGBWAF
	r: number
	g: number
	b: number
	w: number
	a: number
	f: number
}

export type ZenColourOptions = ZenColourXY | ZenColourTC | ZenColourRGBWAF

// ZenColour
export class ZenColour {
	type: ZenColourType
	kelvin?: number
	r?: number
	g?: number
	b?: number
	w?: number
	a?: number
	f?: number
	x?: number
	y?: number

	constructor(init: ZenColourOptions) {
		this.type = init.type
		Object.assign(this, init)
		this._postInit()
	}

	/**
	 * Create a new ZenColour from HSV.
	 * @param h hue between 0 and 360 inclusive
	 * @param s saturation between 0 and 1 inclusive
	 * @param v brightness between 0 and 1 inclusive
	 * @returns 
	 */
	static fromHsv(h: number, s: number, v: number): ZenColour {
		let { r, g, b } = hsvToRgb(h, s, v)

		let w = Math.min(r, g, b)
		r -= w
		g -= w
		b -= w

		const intensity_factor = 0.3

		let a: number
		/* Amber boost for ~20°-50° */
		if (h >= 20 && h <= 50) {
			a = (1 - Math.abs(h - 35) / 15) * intensity_factor
		} else {
			a = 0
		}

		let f: number
		/* Far-Red boost for <30° or >330° */
		if (h >= 330 || h <= 30) {
			const hNorm = h > 330 ? h - 360 : h // bring >330 into negative range
			const dist = Math.abs(hNorm) // distance from 0°/360°
			f = (1 - dist / 30) * intensity_factor
		} else {
			f = 0
		}

		const clamp = (n: number) => Math.max(0, Math.min(1, n))
		r = clamp(r)
		g = clamp(g)
		b = clamp(b)
		w = clamp(w)
		a = clamp(a)
		f = clamp(f)

		r *= 255
		g *= 255
		b *= 255
		w *= 255
		a *= 255
		f *= 255

		r = Math.round(r)
		g = Math.round(g)
		b = Math.round(b)
		w = Math.round(w)
		a = Math.round(a)
		f = Math.round(f)

		return new ZenColour({
			r,
			g,
			b,
			w,
			a,
			f,
			type: ZenColourType.RGBWAF,
		})
	}

	static fromBytes(bytes: Buffer): ZenColour {
		if (!bytes || bytes.length === 0) {
			throw new Error('Invalid colour: no bytes')
		}
		const type = bytes[0]
		switch (type) {
		case ZenColourType.RGBWAF:
			if (bytes.length === 7) {
				return new ZenColour({
					type,
					r: bytes[1], g: bytes[2], b: bytes[3],
					w: bytes[4], a: bytes[5], f: bytes[6],
				})
			}
			break
		case ZenColourType.TC:
			if (bytes.length === 3 || bytes.length === 7) {
				const kelvin = (bytes[1] << 8) | bytes[2]
				return new ZenColour({ type, kelvin })
			}
			break
		case ZenColourType.XY:
			if (bytes.length === 5 || bytes.length === 7) {
				const x = (bytes[1] << 8) | bytes[2]
				const y = (bytes[3] << 8) | bytes[4]
				return new ZenColour({ type, x, y })
			}
			break
		}
		throw new Error(`Invalid colour. Unsupported type: ${type}`)
	}

	/**
	 * Convert this colour into bytes. Note that 0xff indicates an unused byte so
	 * we clamp intentional values to 0xfe.
	 */
	toBytes(): Buffer {
		switch (this.type) {
		case ZenColourType.TC:
			return Buffer.from([
				0x20,
				Math.min(0xfe, (this.kelvin! >> 8) & 0xff), Math.min(0xfe, this.kelvin! & 0xff),
				// Use 0xFF for any unused bytes.
				0xff, 0xff,
				0xff, 0xff,
			])
		case ZenColourType.RGBWAF:
			return Buffer.from([
				0x80,
				Math.min(0xfe, this.r ?? 0), Math.min(0xfe, this.g ?? 0), Math.min(0xfe, this.b ?? 0),
				Math.min(0xfe, this.w ?? 0), Math.min(0xfe, this.a ?? 0), Math.min(0xfe, this.f ?? 0),
			])
		case ZenColourType.XY:
			return Buffer.from([
				0x10,
				Math.min(0xfe, ((this.x ?? 0) >> 8) & 0xff), Math.min(0xfe, (this.x ?? 0) & 0xff),
				Math.min(0xfe, ((this.y ?? 0) >> 8) & 0xff), Math.min(0xfe, (this.y ?? 0) & 0xff),
				// Use 0xFF for any unused bytes.
				0xff, 0xff,
			])
		default:
			return Buffer.alloc(0)
		}
	}

	_postInit() {
		if (this.type === ZenColourType.TC && (this.kelvin! < ZenConst.MIN_KELVIN || this.kelvin! > ZenConst.MAX_KELVIN)) {
			throw new Error(`Kelvin must be between ${ZenConst.MIN_KELVIN} and ${ZenConst.MAX_KELVIN}: ${this.kelvin}`)
		}
		if (this.type === ZenColourType.RGBWAF) {
			for (const [channel, value] of Object.entries({ r: this.r, g: this.g, b: this.b, w: this.w, a: this.a, f: this.f })) {
				if (value != null && (value < 0 || value > 255)) {
					throw new Error(`${channel.toUpperCase()} must be between 0 and 255`)
				}
			}
		}
		if (this.type === ZenColourType.XY) {
			if (this.x! < 0 || this.x! > 65535) {
				throw new Error('X must be between 0 and 65535')
			}
			if (this.y! < 0 || this.y! > 65535) {
				throw new Error('Y must be between 0 and 65535')
			}
		}
	}

	toString(): string {
		if (this.type === ZenColourType.TC) {
			return `ZenColour(kelvin=${this.kelvin})`
		}
		if (this.type === ZenColourType.RGBWAF) {
			return `ZenColour(r=${this.r}, g=${this.g}, b=${this.b}, w=${this.w}, a=${this.a}, f=${this.f})`
		}
		if (this.type === ZenColourType.XY) {
			return `ZenColour(x=${this.x}, y=${this.y})`
		}
		return 'ZenColour(unknown)'
	}

	/**
	 * Convert this colour to HSV
	 * @returns h is hue an integer between 0 and 360 inclusive, s is saturation between 0 and 1 inclusive, v is brightness between 0 and 1 inclusive.
	 */
	toHsv(): { h: number; s: number; v: number } {
		if (this.type === ZenColourType.RGBWAF) {
			let r = (this.r ?? 0) / 255
			let g = (this.g ?? 0) / 255
			let b = (this.b ?? 0) / 255
			const w = (this.w ?? 0) / 255

			r += w
			g += w
			b += w

			r = Math.min(1, r)
			g = Math.min(1, g)
			b = Math.min(1, b)

			return rgbToHsv(r, g, b)
		} else if (this.type === ZenColourType.XY) {
			/* Convert xyY to XYZ */
			const Y = 1.0
			const X = (this.x! * Y) / this.y!
			const Z = ((1 - this.x! - this.y!) * Y) / this.y!

			/* Convert XYZ to linear RGB (sRGB color space) */
			const rLinear =  3.2406*X - 1.5372*Y - 0.4986*Z
			const gLinear = -0.9689*X + 1.8758*Y + 0.0415*Z
			const bLinear =  0.0557*X - 0.2040*Y + 1.0570*Z

			/* Apply gamma correction (linear RGB to sRGB) */
			function correctGamma(c: number) {
				c = Math.max(0.0, c)
				return c <= 0.0031308 ? 12.92 * c : 1.055 * (c ** (1/2.4)) - 0.055
			}
			
			function clamp(c: number) {
				return Math.max(0, Math.min(1, c))
			}

			const [r, g, b] = [clamp(correctGamma(rLinear)), clamp(correctGamma(gLinear)), clamp(correctGamma(bLinear))]
			return rgbToHsv(r, g, b)
		} else {
			throw new Error(`Unsupported ZenColour type for toHsv: ${this.type}`)
		}
	}

	equals(other: ZenColour): boolean {
		return JSON.stringify(this) === JSON.stringify(other)
	}
}

/**
 * Convert HSV to RGB.
 * @param h hue between 0 and 360 inclusive
 * @param s saturation between 0 and 1 inclusive
 * @param v brightness between 0 and 1 inclusive
 * @returns r, g, b between 0 and 1
 */
export function hsvToRgb(h: number, s: number, v: number): { r: number; g: number; b: number } {
	if (h < 0 || h > 360) {
		throw new Error(`Invalid hue: ${h}`)
	}
	if (s < 0 || s > 1) {
		throw new Error(`Invalid saturation: ${s}`)
	}
	if (v < 0 || v > 1) {
		throw new Error(`Invalid brightness: ${v}`)
	}

	const c = v * s
	const x = c * (1 - Math.abs((h / 60) % 2 - 1))
	const m = v - c

	let r, g, b
	if (h < 60) {
		[r, g, b] = [c, x, 0]
	} else if (h < 120) {
		[r, g, b] = [x, c, 0]
	} else if (h < 180) {
		[r, g, b] = [0, c, x]
	} else if (h < 240) {
		[r, g, b] = [0, x, c]
	} else if (h < 300) {
		[r, g, b] = [x, 0, c]
	} else {
		[r, g, b] = [c, 0, x]
	}

	r += m
	g += m
	b += m

	return { r, g, b }
}

/**
 * Convert RGB to HSV
 * @param r red in range 0 to 1
 * @param g green in range 0 to 1
 * @param b blue in range 0 to 1
 * @returns h between 0 and 360, s between 0 and 1, v between 0 and 1
 */
export function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
	const max = Math.max(r, g, b)
	const min = Math.min(r, g, b)
	const delta = max - min

	let h = 0
	if (delta === 0) {
		h = 0
	} else if (max === r) {
		h = 60 * (((g - b) / delta) % 6)
	} else if (max === g) {
		h = 60 * (((b - r) / delta) + 2)
	} else if (max === b) {
		h = 60 * (((r - g) / delta) + 4)
	}

	let s = max === 0 ? 0 : delta / max
	let v = max

	h = Math.round(h % 360)
	s = Math.max(0, Math.min(1, s))
	v = Math.max(0, Math.min(1, v))

	return { h, s, v }
}
