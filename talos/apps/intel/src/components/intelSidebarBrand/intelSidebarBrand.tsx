import { useTranslateUI } from '@main/locale';
import BrandImage from '@intel/assets/E&A.webp';
import styles from './intelSidebarBrand.module.scss';

const IntelSidebarBrand = () => {
  const tUI = useTranslateUI();
  return (
    <div className={styles.brand}>
      <img src={BrandImage} alt={tUI('sidebar.alt.supportedBy')} draggable="false" />
    </div>
  );
};

export default IntelSidebarBrand;
