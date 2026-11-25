import styles from '@/pages/userGuide/tooltip/tooltip.module.scss';
import { TooltipRenderProps } from 'react-joyride';
import { useEffect, useState } from 'react';
import { PillButton, RoundIconButton } from '@/component/button/button';
import { useTranslateUI } from '@/locale';

const RangeIndicator = ({ value, label }: { value: number; label?: string }) => {
    return (
        <div className={styles.indicatorContainer}>
            <div className={styles.progressLeft}>
                <span className={styles.progress} style={{ width: `${value}%` }} />
            </div>
            <span className={styles.percentage}>{label ?? `${value}%`}</span>
            <div className={styles.progressRight}>
                <span className={styles.progress} style={{ width: `${value}%` }} />
            </div>
        </div>
    );
};

type HeaderProps = Pick<TooltipRenderProps, 'backProps' | 'primaryProps' | 'skipProps' | 'index' | 'size'> & {
    hideProgress?: boolean;
};

const TooltipHeader = ({ backProps, primaryProps, skipProps, index, size, hideProgress }: HeaderProps) => {
    const t = useTranslateUI();
    const [theme, setTheme] = useState<'light' | 'dark'>('dark');

    useEffect(() => {
        const updateTheme = () => {
            const currentTheme = document.documentElement.getAttribute('data-theme');
            setTheme(currentTheme === 'light' ? 'light' : 'dark');
        };

        updateTheme();

        const observer = new MutationObserver(updateTheme);
        observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['data-theme'],
        });

        return () => observer.disconnect();
    }, []);

    const buttonSchema = theme === 'light' ? 'dark' : 'light';

    if (hideProgress) {
        return (
            <div className={`${styles.header} ${styles.introHeader}`}>
                <div className={styles.introLabel}>{t('guide.tip')}</div>
                <div className={styles.buttonContainer}>
                    <PillButton onClick={primaryProps.onClick} schema={buttonSchema}>
                        {t('common.close')}
                    </PillButton>
                </div>
            </div>
        );
    }

    return (
        <div className={styles.header}>
            <div className={styles.textContainer}>
                <div className={styles.index}>{index + 1}</div>
                <div className={styles.size}>{`/${size}`}</div>
            </div>
            <div className={styles.buttonContainer}>
                <RoundIconButton
                    label={backProps['aria-label']}
                    icon='prev'
                    onClick={backProps.onClick}
                    size='1.5rem'
                    schema={buttonSchema}
                    disabled={index === 0}
                />
                <RoundIconButton
                    label={primaryProps['aria-label']}
                    icon='next'
                    onClick={primaryProps.onClick}
                    size='1.5rem'
                    schema={buttonSchema}
                />
                <PillButton onClick={skipProps.onClick} schema={buttonSchema}>
                    {t('common.skip')}
                </PillButton>
            </div>
        </div>
    );
};

export const GuideTooltip = ({
    index,
    step,
    backProps,
    primaryProps,
    skipProps,
    size,
}: TooltipRenderProps) => {
    const hideProgress = Boolean((step as unknown as { hideProgress?: boolean }).hideProgress);

    return (
        <div className={styles.wrapper}>
            <div className={styles.container}>
                <TooltipHeader
                    backProps={backProps}
                    primaryProps={primaryProps}
                    skipProps={skipProps}
                    index={index}
                    size={size}
                    hideProgress={hideProgress}
                />
                <div className={styles.contentBase}>
                    {step.content}
                </div>
                <RangeIndicator
                    value={hideProgress ? 100 : Math.round(((index + 1) / size) * 100)}
                    label={hideProgress ? 'OEM' : undefined}
                />
            </div>
        </div>
    );
};
