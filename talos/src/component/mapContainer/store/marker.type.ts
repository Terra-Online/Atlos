export interface IMarkerData {
    "id": string,
    "position": [
        number, number
    ],
    "subregionId": string,
    "type": string
}

export interface IMarkerType {
    "key": string,
    "name": string,
    "category": {
        "main": string,
        "sub": string
    }
}