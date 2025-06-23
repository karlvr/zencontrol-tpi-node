import { Const } from './zen-const.js'

export enum ZenColourType {
	XY = 0x10,
	TC = 0x20,
	RGBWAF = 0x80,
}

// ZenColour
export class ZenColour {
	type?: ZenColourType
	kelvin?: number
	r?: number
	g?: number
	b?: number
	w?: number
	a?: number
	f?: number
	x?: number
	y?: number

	constructor(init?: Partial<ZenColour>) {
		Object.assign(this, init)
		this._postInit()
	}

	static fromBytes(bytes: Buffer): ZenColour | null {
		if (!bytes || bytes.length === 0) {
			return null
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
		return null
	}

	toBytes(level = 255): Buffer {
		switch (this.type) {
		case ZenColourType.TC:
			return Buffer.from([level, 0x20, (this.kelvin! >> 8) & 0xff, this.kelvin! & 0xff])
		case ZenColourType.RGBWAF:
			return Buffer.from([
				level, 0x80,
				this.r ?? 0, this.g ?? 0, this.b ?? 0,
				this.w ?? 0, this.a ?? 0, this.f ?? 0,
			])
		case ZenColourType.XY:
			return Buffer.from([
				level, 0x10,
				(this.x! >> 8) & 0xff, this.x! & 0xff,
				(this.y! >> 8) & 0xff, this.y! & 0xff,
			])
		default:
			return Buffer.alloc(0)
		}
	}

	_postInit() {
		if (this.type === ZenColourType.TC && (this.kelvin! < Const.MIN_KELVIN || this.kelvin! > Const.MAX_KELVIN)) {
			throw new Error(`Kelvin must be between ${Const.MIN_KELVIN} and ${Const.MAX_KELVIN}`)
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

	equals(other: ZenColour): boolean {
		return JSON.stringify(this) === JSON.stringify(other)
	}
}
