import styles from './UserGuideTooltip.module.scss';
import { TooltipRenderProps } from 'react-joyride';
import { MouseEventHandler } from 'react';
import Button from '@/component/button/button';

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
    onComplete?: MouseEventHandler<HTMLElement>;
    index: number;
    size: number;
}

const TooltipHeader = (prop: TooltipHeaderInterface) => {
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
                />
                <Button
                    text=''
                    buttonType='next'
                    buttonStyle='icon'
                    onClick={
                        prop.index !== prop.size - 1
                            ? prop.onClickNext
                            : prop.onComplete
                    }
                    size={'1.5rem'}
                />
                <Button text={'SKIP'} onClick={prop.onClickSkip} />
            </div>
        </div>
    );
};

export const UserGuideTooltip = ({
    index,
    step,
    backProps,
    closeProps,
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
                    onComplete={closeProps.onClick}
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
