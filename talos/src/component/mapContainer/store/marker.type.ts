export interface IMarkerData {
    "id": string,
    "position": [
        number, number
    ],
    "subregionId": string,
    "type": string
    meta?: Record<string, any>
}

export interface IMarkerType {
    "key": string,
    "name": string,
    "noFrame"?: boolean
    "subIcon"? : string
    "category": {
        "main": string,
        "sub": string
    }
}