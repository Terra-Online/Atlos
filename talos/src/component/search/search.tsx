import React from 'react';
import { useDevice } from '@/utils/device';
import SearchDesktop from './search.desktop';
import SearchMobile from './search.mobile';

const Search: React.FC = () => {
  const { isMobile } = useDevice();
  return isMobile ? <SearchMobile /> : <SearchDesktop />;
};

export default Search;
