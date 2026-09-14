import type { KeyboardEvent } from 'react';
import type { ArchiveCategory } from '@intel/data/types';
import styles from './categoryFilter.module.scss';

interface CategoryFilterProps {
  categoryId: ArchiveCategory;
  label: string;
  statusLabel: string;
  collected: number;
  total: number;
  active: boolean;
  onToggle: (categoryId: ArchiveCategory) => void;
}

const CategoryFilter = ({
  categoryId,
  label,
  statusLabel,
  collected,
  total,
  active,
  onToggle,
}: CategoryFilterProps) => {
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onToggle(categoryId);
  };

  return (
    <button
      type="button"
      className={`${styles.filterItem} ${active ? styles.active : ''}`}
      onClick={() => onToggle(categoryId)}
      onKeyDown={handleKeyDown}
      aria-pressed={active}
      data-active={active ? 'true' : 'false'}
      data-category={categoryId}
      data-intel-category={categoryId}
    >
      <div className={styles.filterMain}>{label}</div>
      <div
        className={styles.filterDesc}
        data-complete={collected === total ? 'true' : 'false'}
      >
        {statusLabel} {collected}/{total}
      </div>
    </button>
  );
};

export default CategoryFilter;
