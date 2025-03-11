import { create } from 'zustand'

const useGlobalStore = create(() => ({
    markerTypeKey: "campfire",
    currentRegion: "Valley_4"
}))

export default useGlobalStore