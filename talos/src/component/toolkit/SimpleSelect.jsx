import React, { useCallback, useState } from 'react';
import useGlobalStore from '../../context';
import MARKER_TYPE_DATA from "../mapContainer/Map/markerType.json"
import { clearMarker, collectMarkerData } from '../mapContainer/Map/marker';
import { downloadObjectAsJson } from '../../utils/download';

const OPTIONS = Object.values(MARKER_TYPE_DATA).map((type) => ({ label: type.name, value: type.key }))

const SimpleSelect = () => {
    const { markerTypeKey: selectedOption, currentRegion } = useGlobalStore()

    const handleSelectChange = (event) => {
        const value = event.target.value;
        useGlobalStore.setState({ markerTypeKey: value });
    };
    const handleClear = useCallback(() => {
        clearMarker(currentRegion)
    }, [currentRegion])
    const handleClearAll = useCallback(() => {
        clearMarker("")
    }, [])
    const handleExport = useCallback(() => {
        const markerInfo = collectMarkerData(currentRegion)
        downloadObjectAsJson(markerInfo, `markers_${currentRegion}`)
    }, [currentRegion])
    const handleExportAll = useCallback(() => {
        const markerInfo = collectMarkerData("")
        downloadObjectAsJson(markerInfo, `markers_all`)
    }, [])

    return (
        <>
            <div style={{ position: "fixed", left: "10px", top: "80px" }}>
                <select value={selectedOption} onChange={handleSelectChange}>
                    {OPTIONS.map((option, index) => (
                        <option
                            key={index}
                            value={option.value}
                            style={{ color: selectedOption === option.value ? 'blue' : 'black' }}
                        >
                            {option.label}
                        </option>
                    ))}
                </select>
                <button style={{ display: "block", marginTop: "10px" }} onClick={handleExport}>导出当前地图数据</button>
                <button style={{ display: "block", marginTop: "10px" }} onClick={handleExportAll}>导出所有数据</button>


            </div>
            <div style={{ position: "fixed", right: "10px", top: "80px" }}>
                <button style={{ display: "block", marginTop: "10px" }} onClick={handleClear}>清除当前地图标点</button>
                <button style={{ display: "block", marginTop: "10px" }} onClick={handleClearAll}>清除所有标点</button>
            </div>
        </>


    );
};

export default SimpleSelect;