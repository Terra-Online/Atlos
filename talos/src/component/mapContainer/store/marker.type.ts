export interface IMarkerData {
    "id": string,
    "position": [
        number, number
    ],
    "region": {
        "main": string,
        "sub": string,
    },
    "type": {
        "main": string,
        "sub": string,
        "key": string,
    }
}