import React, { useCallback } from 'react';
import Modal from '@/component/modal/modal';
import GroupIcon from '../../assets/logos/group.svg?react';
import styles from './group.module.scss';

import GitHubLogo from '../../assets/images/UI/media/github.svg?react';
import DiscordLogo from '../../assets/images/UI/media/discord-light.svg?react';
import SklandLogo from '../../assets/images/UI/media/skland.svg?react';
import SkportLogo from '../../assets/images/UI/media/skport.svg?react';
// import BilibiliLogo from '../../assets/images/UI/media/bilibili.svg?react';

import { useTranslateUI } from '@/locale';
export interface GroupsProps {
  open: boolean;
  onClose: () => void;
  onChange?: (open: boolean) => void;
  onSelected?: (platform: string) => void;
}

interface SocialLink {
  icon: React.FC<React.SVGProps<SVGSVGElement>>;
  url: string;
  name: string;
}

const SOCIAL_LINKS: SocialLink[] = [
  {
    icon: DiscordLogo,
    url: 'https://discord.gg/9zDwGe9Sht',
    name: 'Discord'
  },
  {
    icon: GitHubLogo,
    url: 'https://github.com/Terra-Online/Atlos',
    name: 'GitHub'
  },
  {
    icon: SklandLogo,
    url: 'https://www.skland.com/profile?id=2730585909766',
    name: 'Skland'
  },
  {
    icon: SkportLogo,
    url: 'https://www.skport.com/profile?id=3182563593139&cate=2',
    name: 'Skport'
  },
  /*
  {
    icon: BilibiliLogo,
    url: 'https://space.bilibili.com/your-id',
    name: 'Bilibili'
  },
  */
];

const GroupsModal: React.FC<GroupsProps> = ({ open, onClose, onChange, onSelected }) => {
    const t: (k: string) => string = useTranslateUI();

    const handleClick = useCallback((platform: string, url: string) => {
      onSelected?.(platform);
      window.open(url, '_blank', 'noopener,noreferrer');
    }, [onSelected]);

    return (
    <Modal
      open={open}
      size="m"
      onClose={onClose}
      onChange={onChange}
      title={t('group.title')}
      icon={<GroupIcon aria-hidden="true" />}
    >
      <div className={styles.groupList}>
        {SOCIAL_LINKS.map((link) => {
          const IconComponent = link.icon;
          return (
            <a
              key={link.name}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.groupItem}
              onClick={(e) => {
                e.preventDefault();
                handleClick(link.name, link.url);
              }}
              aria-label={`${t('group.visit')} ${link.name}`}
            >
              <IconComponent aria-hidden="true" />
            </a>
          );
        })}
      </div>
    </Modal>
  );
};

export default React.memo(GroupsModal);