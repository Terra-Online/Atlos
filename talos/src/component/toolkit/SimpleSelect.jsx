import React, { useCallback } from 'react';
import useGlobalStore from '../../context';
import MARKER_TYPE_DATA from "../mapContainer/Map/markerType.json";
import { clearMarker, collectMarkerData } from '../mapContainer/Map/marker';
import { downloadObjectAsJson } from '../../utils/download';
import './SimpleSelect.scss';

const OPTIONS = Object.values(MARKER_TYPE_DATA).map((type) => ({ label: type.name, value: type.key }));

const SimpleSelect = () => {
    const { markerTypeKey: selectedOption, currentRegion } = useGlobalStore();

    const handleSelectChange = (event) => {
        const value = event.target.value;
        useGlobalStore.setState({ markerTypeKey: value });
    };

    const handleClear = useCallback(() => {
        clearMarker(currentRegion);
    }, [currentRegion]);

    const handleClearAll = useCallback(() => {
        clearMarker("");
    }, []);

    const handleExport = useCallback(() => {
        const markerInfo = collectMarkerData(currentRegion);
        downloadObjectAsJson(markerInfo, `markers_${currentRegion}`);
    }, [currentRegion]);

    const handleExportAll = useCallback(() => {
        const markerInfo = collectMarkerData("");
        downloadObjectAsJson(markerInfo, `markers_all`);
    }, []);

    return (
        <div className="simple-select-container">
            <select value={selectedOption} onChange={handleSelectChange}>
                {OPTIONS.map((option, index) => (
                    <option
                        key={index}
                        value={option.value}
                        className={selectedOption === option.value ? 'selected' : ''}
                    >
                        {option.label}
                    </option>
                ))}
            </select>
            <div className="button-group">
                <button className="export" onClick={handleExport}>导出当前地图数据</button>
                <button className="export" onClick={handleExportAll}>导出所有数据</button>
                <button className="clear" onClick={handleClear}>清除当前地图标点</button>
                <button className="clear" onClick={handleClearAll}>清除所有标点</button>
            </div>
        </div>
    );
};

export default SimpleSelect;