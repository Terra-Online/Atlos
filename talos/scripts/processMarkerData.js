import fs from "fs-extra"
import path from "path"

const VA_Sub = JSON.parse(fs.readFileSync("./src/component/mapContainer/VA_Sub.json", "utf-8"))
const TYPE_JSON = JSON.parse(fs.readFileSync("./src/data/types.json", "utf-8"))

const TYPE_MAP = {
    "campfire": "growth_chamber",
    "HUB": "hub",
    "settlement": "control_nexus"
}

const TYPE_DICT = {}
const type_p = TYPE_JSON.types[0]
Object.entries(type_p).forEach(([key1, value1]) => {
    Object.entries(value1).forEach(([key2, value2]) => {
        Object.keys(value2).forEach(key3 => {
            TYPE_DICT[key3] = {
                main: key1,
                sub: key2,
                key: key3
            }
        })
    })
})

const GEO_SCALE = 8
const TILE_SIZE = 200

function isInTile(x, y, tileX, TileY) {
    const tileLeft = tileX * TILE_SIZE
    const tileTop = TileY * TILE_SIZE
    const tileRight = tileLeft + TILE_SIZE
    const tileBottom = tileTop + TILE_SIZE
    return x > tileLeft && x <= tileRight && y > tileTop && y <= tileBottom
}

function getTileByPosition(latLng) {
    const [lat, lng] = latLng
    const x = lng * GEO_SCALE
    const y = - lat * GEO_SCALE

    const tileX = Math.floor(x / TILE_SIZE)
    const tileY = Math.floor(y / TILE_SIZE)

    return [tileX, tileY]
}

function getSubRegion(LatLng) {
    const tile = getTileByPosition(LatLng)
    for (const subRegion of VA_Sub.subregions.subregions) {
        if (subRegion.tileCoords.some((t) => t[0] === tile[0] && t[1] === tile[1])) {
            return subRegion
        }
    }
    return null
}

function getMarkerType(key) {


}

const LOG_LEVEL = "debug" // debug or info

const DATA_SRC = "./originData/marker"
const DEST_SRC = "./src/data/marker.json"

const main = () => {
    /**
     * @type {import("../src/component/mapContainer/Map/type").IMapMarkerData[]}
     */
    let PointList = []
    const files = fs.readdirSync(DATA_SRC)
    files.forEach((f) => {
        const filePath = path.resolve(DATA_SRC, f)
        const stat = fs.statSync(filePath)
        if (!stat.isFile()) return
        const str = fs.readFileSync(filePath)
        const data = JSON.parse(str)
        PointList.push(...data)
    })

    // 基础去重
    const dropList = []
    PointList.forEach((point, index) => {
        if (dropList.includes(index)) return
        PointList.forEach((p, i) => {
            if (index === i) return
            if (point.type !== p.type) return
            if (Math.abs(p.pos[0] - point.pos[0]) < 0.5 && Math.abs(p.pos[1] - point.pos[1]) < 0.5) {
                dropList.push(i)
                if (LOG_LEVEL === "debug") {
                    console.log("------------------------------------------------")
                    console.log(`point ${index} is dropped`)
                    console.log("point dropped:", p)
                    console.log("point origin: ", point)
                }

            }
        })
    })
    console.log("drop point", dropList.length)
    const processedPointList = PointList.filter((_, index) => !dropList.includes(index))



    const processedDataList = processedPointList.map((p, index) => {
        const type = TYPE_DICT[TYPE_MAP[p.type] ?? ""]
        if (!type) {
            console.log("cannot find type for point", p)
            return undefined
        }
        const regionId = p.regionId
        // 子区域bug处理，额外判断当前点处于哪个子区域
        if (regionId === "Valley_4") {
            const subRegion = getSubRegion(p.pos)
            if (subRegion) {
                return {
                    id: index.toString(),
                    position: p.pos,
                    region: {
                        "main": regionId,
                        "sub": subRegion.id
                    },
                    type,
                }
            } else {
                console.log("cannot find subRegion for point", p)
                return undefined
            }
        }
        const subRegion = p.subRegionId
        return {
            id: index.toString(),
            position: p.pos,
            region: {
                "main": regionId,
                "sub": subRegion.id
            },
            type,
        }
    }).filter(t => !!t)

    fs.writeFileSync(DEST_SRC, JSON.stringify(processedDataList))
}

main()