import type { FC } from 'react';
import SearchShared from '@/pages/search/search.shared';

interface SearchMobileProps {
  width?: number | string; // allow parent to control width flexibly
}

const SearchMobile: FC<SearchMobileProps> = ({ width = '100%' }) => {
  return <SearchShared width={width} mobile />;
};

export default SearchMobile;
