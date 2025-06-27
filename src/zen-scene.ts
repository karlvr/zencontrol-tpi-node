import { ZenAddress } from './zen-address.js'

export class ZenScene {
	group: ZenAddress
	scene: number
	label: string | null

	constructor(group: ZenAddress, scene: number, label: string | null) {
		this.group = group
		this.scene = scene
		this.label = label
	}

	public toString(): string {
		return `ZenScene(${this.group}, ${this.scene}, ${this.label})`
	}
}
