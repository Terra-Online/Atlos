import { lazy, Suspense, useCallback, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode, type Ref } from 'react';
import { useDevice, useAppViewport } from '@/platform/device';
import { useTranslateUI } from '@/locale';
import {
  SIDEBAR_MIN_WIDTH,
  clampSidebarWidth,
  getSidebarMaxWidth,
  useIncrementLayoutVersion,
  useMobileDrawerSnapIndex,
  useSetMobileDrawerSnapIndex,
  useSetSidebarOpen,
  useSetSidebarWidth,
  useSidebarOpen,
  useSidebarWidth,
} from '@/store/uiPrefs';
import Drawer from '@/component/drawer/drawer';
import SupportModal from '@/component/support/support';
import Icon from '@/assets/images/UI/observator_6.webp';
import SidebarIcon from '@/assets/logos/sideCollap.svg?react';
import GithubIcon from '@/assets/images/UI/media/ghicon.svg?react';
import DiscordIcon from '@/assets/images/UI/media/discordicon.svg?react';
import QQIcon from '@/assets/images/UI/media/qqicon.svg?react';
import BskyIcon from '@/assets/images/UI/media/bluesky.svg?react';
import XIcon from '@/assets/images/UI/media/x.svg?react';
import styles from './sideBar.module.scss';
import mobileStyles from './sideBar.mobile.module.scss';

const IDCard = lazy(() => import('@/component/login/idcard'));

interface SideBarFrameProps {
  children: ReactNode;
  contentRef?: Ref<HTMLDivElement>;
  bottomTools?: ReactNode;
  headIcon?: ReactNode;
  onToggle?: (isOpen: boolean) => void;
  visible?: boolean;
  lockedOpen?: boolean;
  fixedWidth?: number;
}

const SocialBar = ({ mobile = false }: { mobile?: boolean }) => {
  const t = useTranslateUI();
  const [supportOpen, setSupportOpen] = useState(false);
  const frameStyles = mobile ? mobileStyles : styles;
  return (
    <>
      <div className={frameStyles.copyright}>
        <a href="https://beian.miit.gov.cn/">{t('footer.icp')}</a>
      </div>
      <div className={frameStyles.socialBar}>
        <a href="https://github.com/Terra-Online/Atlos" target="_blank" rel="noopener noreferrer" className={frameStyles.socialLink} data-platform="github" aria-label="GitHub"><GithubIcon /></a>
        <a href="https://discord.gg/SJCEjH9hmr" target="_blank" rel="noopener noreferrer" className={frameStyles.socialLink} data-platform="discord" aria-label="Discord"><DiscordIcon /></a>
        <a href="https://bsky.app/profile/opendfieldmap.bsky.social" target="_blank" rel="noopener noreferrer" className={frameStyles.socialLink} data-platform="bluesky" aria-label="Bluesky"><BskyIcon /></a>
        <a href="https://x.com/OpenEndfieldMap" target="_blank" rel="noopener noreferrer" className={frameStyles.socialLink} data-platform="X/Twitter" aria-label="X/Twitter"><XIcon /></a>
        <a href="https://qm.qq.com/q/BVsCJgzBL2" target="_blank" rel="noopener noreferrer" className={frameStyles.socialLink} data-platform="qq" aria-label="QQ"><QQIcon /></a>
        <span className={frameStyles.divide} />
        <button className={frameStyles.supportBtn} type="button" onClick={() => setSupportOpen(true)}>{t('support.title')}</button>
      </div>
      <SupportModal open={supportOpen} onClose={() => setSupportOpen(false)} onChange={setSupportOpen} />
    </>
  );
};

const AccountCard = ({ mobile = false }: { mobile?: boolean }) => {
  const frameStyles = mobile ? mobileStyles : styles;
  return (
    <div className={frameStyles.idCardContainer}>
      <Suspense fallback={null}><IDCard /></Suspense>
    </div>
  );
};

const DesktopFrame = ({ children, contentRef, bottomTools, headIcon, onToggle, visible = true, lockedOpen = false, fixedWidth }: SideBarFrameProps) => {
  const t = useTranslateUI();
  const isOpen = useSidebarOpen();
  const setIsOpen = useSetSidebarOpen();
  const sidebarWidth = useSidebarWidth();
  const setSidebarWidth = useSetSidebarWidth();
  const incrementLayoutVersion = useIncrementLayoutVersion();
  const { width } = useDevice();
  const maxWidth = getSidebarMaxWidth(width);
  const [isResizing, setIsResizing] = useState(false);
  const startX = useRef(0);
  const startWidth = useRef(SIDEBAR_MIN_WIDTH);
  const effectiveOpen = lockedOpen || isOpen;

  const toggle = () => {
    const next = !isOpen;
    setIsOpen(next);
    onToggle?.(next);
  };
  const resize = useCallback((event: PointerEvent) => {
    const next = clampSidebarWidth(startWidth.current + event.clientX - startX.current, maxWidth);
    document.querySelector<HTMLElement>('.app')?.style.setProperty('--sidebar-width', `${next}px`);
    return next;
  }, [maxWidth]);

  return (
    <div
      className={`${styles.sidebarContainer} ${effectiveOpen ? styles.open : ''} ${!visible ? styles.hidden : ''}`}
      data-sidebar-layout="desktop"
      aria-hidden={!visible}
      inert={!visible}
      style={fixedWidth === undefined ? undefined : { '--sidebar-width': `${fixedWidth}px` } as CSSProperties}
    >
      {!lockedOpen && <button className={`${styles.sidebarToggle} ${isOpen ? styles.open : ''}`} onClick={toggle} aria-label={isOpen ? t('common.collapse') : t('common.expand')}><SidebarIcon /></button>}
      <div className={`${styles.sidebar} ${effectiveOpen ? styles.open : ''}`}>
        {effectiveOpen && !lockedOpen && <div
          className={`${styles.resizeHandle} ${isResizing ? styles.dragging : ''}`}
          onPointerDown={(event) => {
            event.preventDefault();
            setIsResizing(true);
            startX.current = event.clientX;
            startWidth.current = sidebarWidth;
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => { if (isResizing) resize(event); }}
          onPointerUp={(event) => {
            if (!isResizing) return;
            setIsResizing(false);
            event.currentTarget.releasePointerCapture(event.pointerId);
            setSidebarWidth(resize(event), maxWidth);
            requestAnimationFrame(incrementLayoutVersion);
          }}
        />}
        <div className={styles.headIcon}>
          {headIcon ?? <img src={Icon} alt={t('sidebar.alt.supportedBy')} draggable="false" />}
        </div>
        <div ref={contentRef} className={styles.sidebarContent} data-sidescroll="true" data-sidebar-scroll="true" data-sidebar-content="true">
          {children}
          <AccountCard />
        </div>
        {bottomTools}
        <SocialBar />
      </div>
    </div>
  );
};

const MobileFrame = ({ children, contentRef, bottomTools, onToggle, visible = true }: SideBarFrameProps) => {
  const { height } = useAppViewport();
  const snapIndex = useMobileDrawerSnapIndex();
  const setSnapIndex = useSetMobileDrawerSnapIndex();
  const snaps = [64, Math.max(64, Math.round(height * 0.55)), Math.max(64, Math.round(height * 0.85))];

  return (
    <div className={`${mobileStyles.sidebarContainer} ${!visible ? mobileStyles.hidden : ''}`} data-sidebar-layout="mobile" aria-hidden={!visible} inert={!visible}>
      <Drawer
        side="bottom"
        initialSize={snaps[0]}
        snap={snaps}
        snapThreshold={[50, 50, 50]}
        handleSize={16}
        fullWidth
        className={mobileStyles.mobileDrawer}
        handleClassName={mobileStyles.mobileDrawerHandle}
        contentClassName={mobileStyles.mobileDrawerContent}
        backdropClassName={mobileStyles.mobileDrawerBackdrop}
        snapToIndex={snapIndex}
        onSnapChange={(index) => {
          setSnapIndex(index);
          onToggle?.(index === snaps.length - 1);
        }}
      >
        <div className={mobileStyles.contentWrapper} data-sidebar-scroll="true">
          <div ref={contentRef} className={mobileStyles.sidebarContent} data-sidebar-content="true">
            {children}
            {bottomTools}
            <AccountCard mobile />
          </div>
          <SocialBar mobile />
        </div>
      </Drawer>
    </div>
  );
};

const SideBarFrame = (props: SideBarFrameProps) => {
  const { isMobile } = useDevice();
  return isMobile ? <MobileFrame {...props} /> : <DesktopFrame {...props} />;
};

export default SideBarFrame;
