import React, { useCallback } from 'react';
import useGlobalStore from '../../context';
import MARKER_TYPE_DATA from "../mapContainer/Map/markerType.json";
import { clearMarker, collectMarkerData } from '../mapContainer/Map/marker';
import { downloadObjectAsJson } from '../../utils/download';
import './SimpleSelect.scss';
import useRegion from '../mapContainer/store/region';

const OPTIONS = Object.values(MARKER_TYPE_DATA).map((type) => ({ label: type.name, value: type.key }));

const SimpleSelect = () => {
    const {currentRegion, currentSubregion} = useRegion()
    const { markerTypeKey: selectedOption } = useGlobalStore();

    const handleSelectChange = (event) => {
        const value = event.target.value;
        useGlobalStore.setState({ markerTypeKey: value });
    };

    const handleClear = useCallback(() => {
        clearMarker(currentRegion, currentSubregion?.id ?? currentRegion);
    }, [currentRegion, currentSubregion]);

    const handleClearAll = useCallback(() => {
        clearMarker("");
    }, []);

    const handleExport = useCallback(() => {
        const subRegionId = currentSubregion?.id ?? currentRegion
        const markerInfo = collectMarkerData(currentRegion, subRegionId);
        downloadObjectAsJson(markerInfo, `markers_${currentRegion}_${subRegionId}`);
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
                <button className="export" onClick={handleExport}>导出当前子区域数据</button>
                <button className="export" onClick={handleExportAll}>导出所有数据</button>
                <button className="clear" onClick={handleClear}>清除当前子区域标点</button>
                <button className="clear" onClick={handleClearAll}>清除所有标点</button>
            </div>
        </div>
    );
};

export default SimpleSelect;