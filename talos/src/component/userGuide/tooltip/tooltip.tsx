import styles from './tooltip.module.scss';
import { TooltipRenderProps } from 'react-joyride';
import { MouseEventHandler, useEffect, useState } from 'react';
import Button from '@/component/button/button';
import { useTranslateUI } from '@/locale';

const RangeIndicator = ({ value }: { value: number }) => {
    return (
        <div className={styles.indicatorContainer}>
            <div className={styles.progressLeft}>
                <span className={styles.progress} style={{ width: `${value}%` }} />
            </div>
            <span className={styles.percentage}>{value}%</span>
            <div className={styles.progressRight}>
                <span className={styles.progress} style={{ width: `${value}%` }} />
            </div>
        </div>
    );
};

interface TooltipHeaderInterface {
    onClickBack?: MouseEventHandler<HTMLElement>;
    onClickNext?: MouseEventHandler<HTMLElement>;
    onClickSkip?: MouseEventHandler<HTMLElement>;
    index: number;
    size: number;
}

const TooltipHeader = (prop: TooltipHeaderInterface) => {
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

    return (
        <div className={styles.header}>
            <div className={styles.textContainer}>
                <div className={styles.index}>{`${prop.index + 1}`}</div>
                <div className={styles.size}>{`/${prop.size}`}</div>
            </div>
            <div className={styles.buttonContainer}>
                <Button
                    text=''
                    buttonType='prev'
                    buttonStyle='icon'
                    onClick={prop.onClickBack}
                    size={'1.5rem'}
                    schema={buttonSchema}
                    disabled={prop.index === 0}
                />
                <Button
                    text=''
                    buttonType='next'
                    buttonStyle='icon'
                    onClick={prop.onClickNext}
                    size={'1.5rem'}
                    schema={buttonSchema}
                />
                <Button text={t('common.skip')} onClick={prop.onClickSkip} schema={buttonSchema} />
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
    return (
        <div className={styles.wrapper}>
            <div className={styles.container}>
                <TooltipHeader
                    onClickBack={backProps.onClick}
                    onClickNext={primaryProps.onClick}
                    onClickSkip={skipProps.onClick}
                    index={index}
                    size={size}
                />
                <div className={styles.contentBase}>
                    {step.content}
                </div>
                <RangeIndicator value={Math.round(((index + 1) / size) * 100)} />
            </div>
        </div>
    );
};
