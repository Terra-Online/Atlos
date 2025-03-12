import fs from "fs-extra"
import sharp from "sharp"

const list = fs.readdirSync("src/asset/images/marker")
const keys = list.map((item) => item.split(".")[0])

const obj = {}

async function main() {
    await Promise.all(keys.map((key) => {
        return sharp("src/asset/images/marker/" + key + ".png").metadata().then((metadata) => {
            obj[key] = {
                "key": key,
                "name": "",
                "category": "",
                "icon": {
                    "iconSize": [
                        metadata.width,
                        metadata.height
                    ],
                    "iconAnchor": [
                        metadata.width / 2,
                        metadata.height / 2
                    ],
                    "popupAnchor": [
                        0,
                        0
                    ]
                }
            }
        })
    }))
    fs.writeFileSync("src/asset/images/marker/index.json", JSON.stringify(obj, null, 2))

}


main()