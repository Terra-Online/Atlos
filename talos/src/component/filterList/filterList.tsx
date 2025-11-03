import { useDevice } from '@/utils/device';
import FilterListDesktop from './filterList.desktop';
import FilterListMobile from './filterList.mobile';

const FilterList = ({ isSidebarOpen }: { isSidebarOpen: boolean }) => {
  const { isMobile } = useDevice();
  // For mobile, default full width; in SideBarMobile we import mobile variant directly to control width.
  return isMobile ? <FilterListMobile width={'100%'} /> : <FilterListDesktop isSidebarOpen={isSidebarOpen} />;
};

export default FilterList;