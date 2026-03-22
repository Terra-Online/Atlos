import type { FC } from 'react';
import SearchShared from './search.shared';

interface SearchMobileProps {
  width?: number | string; // allow parent to control width flexibly
}

const SearchMobile: FC<SearchMobileProps> = ({ width = '100%' }) => {
  return <SearchShared width={width} />;
};

export default SearchMobile;
