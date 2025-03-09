const prefix = __ASSETS_HOST ?? ""

export const getTileResourceUrl = (path) => {
    return `${prefix}${path}`
}