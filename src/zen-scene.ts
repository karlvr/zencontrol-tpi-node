import { ZenAddress } from './zen-address.js'
import { ZenConst } from './zen-const.js'

export class ZenScene {
	group: ZenAddress
	scene: number
	label: string | null

	constructor(group: ZenAddress, scene: number, label: string | null) {
		if (scene < 0 || scene >= ZenConst.MAX_SCENE) {
			throw new Error(`Scene number out of range: ${scene}`)
		}
		this.group = group
		this.scene = scene
		this.label = label
	}

	public toString(): string {
		return `ZenScene(${this.group}, ${this.scene}, ${this.label})`
	}
}
