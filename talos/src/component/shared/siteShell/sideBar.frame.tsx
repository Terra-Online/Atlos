import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode, type Ref } from 'react';
import { useRetryImport } from '@/lib/dom/useRetryImport';
import ErrorBoundary from '@/component/shared/ErrorBoundary';
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
import SupportModal from '@/component/shared/support/support';
import Icon from '@/assets/images/UI/observator_6.webp';
import SidebarIcon from '@/assets/logos/sideCollap.svg?react';
import GithubIcon from '@/assets/images/UI/media/ghicon.svg?react';
import DiscordIcon from '@/assets/images/UI/media/discordicon.svg?react';
import QQIcon from '@/assets/images/UI/media/qqicon.svg?react';
import BskyIcon from '@/assets/images/UI/media/bluesky.svg?react';
import XIcon from '@/assets/images/UI/media/x.svg?react';
import styles from '@/component/shared/siteShell/sideBar.module.scss';
import mobileStyles from '@/component/shared/siteShell/sideBar.mobile.module.scss';

const loadIDCard = () => import('@/component/shared/account/idcard');

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

export const SidebarFooter = ({ mobile = false }: { mobile?: boolean }) => {
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

export const AccountCard = ({ mobile = false }: { mobile?: boolean }) => {
  const frameStyles = mobile ? mobileStyles : styles;
  const IDCard = useRetryImport(loadIDCard, true)?.default;
  return (
    <div className={frameStyles.idCardContainer}>
      {IDCard && <ErrorBoundary><IDCard /></ErrorBoundary>}
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
  const drag = useRef<{ id: number; handle: HTMLElement; app: HTMLElement | null; width: string } | null>(null);
  const effectiveOpen = lockedOpen || isOpen;

  const finishResize = useCallback((cancelled: boolean) => {
    const current = drag.current;
    if (!current) return;
    // Release ownership before capture can emit lostpointercapture, so a
    // completed drag is not subsequently treated as a cancellation.
    drag.current = null;
    if (cancelled && current.app) {
      if (current.width) current.app.style.setProperty('--sidebar-width', current.width);
      else current.app.style.removeProperty('--sidebar-width');
    }
    if (current.handle.hasPointerCapture(current.id)) current.handle.releasePointerCapture(current.id);
  }, []);

  useEffect(() => () => finishResize(true), [finishResize]);
  useEffect(() => {
    if (effectiveOpen && visible) return;
    finishResize(true);
    setIsResizing(false);
  }, [effectiveOpen, finishResize, visible]);

  const toggle = () => {
    const next = !isOpen;
    setIsOpen(next);
    onToggle?.(next);
  };
  const resize = useCallback((event: PointerEvent) => {
    const next = clampSidebarWidth(startWidth.current + event.clientX - startX.current, maxWidth);
    drag.current?.app?.style.setProperty('--sidebar-width', `${next}px`);
    return next;
  }, [maxWidth]);

  return (
    <div
      className={`${styles.sidebarContainer} ${effectiveOpen ? styles.open : ''} ${!visible ? styles.hidden : ''}`}
      data-font-region="sidebar"
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
            if (drag.current || !event.isPrimary || event.button !== 0) return;
            event.preventDefault();
            const app = document.querySelector<HTMLElement>('.app');
            drag.current = { id: event.pointerId, handle: event.currentTarget, app, width: app?.style.getPropertyValue('--sidebar-width') ?? '' };
            setIsResizing(true);
            startX.current = event.clientX;
            startWidth.current = sidebarWidth;
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => { if (drag.current?.id === event.pointerId) resize(event); }}
          onPointerUp={(event) => {
            if (drag.current?.id !== event.pointerId) return;
            const nextWidth = resize(event);
            finishResize(false);
            setIsResizing(false);
            setSidebarWidth(nextWidth, maxWidth);
            requestAnimationFrame(incrementLayoutVersion);
          }}
          onPointerCancel={(event) => {
            if (drag.current?.id !== event.pointerId) return;
            finishResize(true);
            setIsResizing(false);
          }}
          onLostPointerCapture={(event) => {
            if (drag.current?.id !== event.pointerId) return;
            finishResize(true);
            setIsResizing(false);
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
        <SidebarFooter />
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
    <div className={`${mobileStyles.sidebarContainer} ${!visible ? mobileStyles.hidden : ''}`} data-font-region="sidebar" data-sidebar-layout="mobile" aria-hidden={!visible} inert={!visible}>
      <Drawer
        side="bottom"
        initialSize={snaps[0]}
        snap={snaps}
        snapThreshold={[50, 50, 50]}
        handleSize="1rem"
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
          <SidebarFooter mobile />
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
