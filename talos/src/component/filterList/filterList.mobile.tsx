import React from 'react';
import { getItemIconUrl } from '@/utils/resource.ts';
import { useFilter, useSwitchFilter } from '@/store/marker.ts';
import styles from './filterList.module.scss';

interface FilterListMobileProps {
  width?: number | string;
}

const FilterListMobile: React.FC<FilterListMobileProps> = ({ width = '100%' }) => {
  const filterList = useFilter();
  const switchFilter = useSwitchFilter();

  return (
    <div className={styles.mainFilterList} style={{ width }}>
      <div className={styles.mainFilterContentContainer} style={{ overflowX: 'auto' }}>
        <div className={styles.innerContainer} style={{ display: 'flex', gap: 8 }}>
          {[...filterList].reverse().map((item) => (
            <span
              key={item}
              className={styles.mainFilterContentItem}
              style={{ backgroundImage: `url(${getItemIconUrl(item)})` }}
              onClick={() => switchFilter(item)}
            />)
          )}
        </div>
      </div>
    </div>
  );
};

export default FilterListMobile;
