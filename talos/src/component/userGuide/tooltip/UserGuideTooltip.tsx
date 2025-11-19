import styles from './UserGuideTooltip.module.scss';

import { TooltipRenderProps } from 'react-joyride';
import { CSSProperties, MouseEventHandler } from 'react';

import PreviousIcon from '@/assets/images/UI/prev.svg?react';
import NextIcon from '@/assets/images/UI/next.svg?react';
import AtlosButton from '@/component/button/button';
import { Property } from 'csstype';

const RangeIndicator = ({ value }: { value: number }) => {
    return (
        <div className={styles.UserGuideRangeIndicatorContainer}>
            <div className={styles.square} />
            <div className={styles.line} />
            <span className={styles.range}>{`${value * 100}%`}</span>
            <div className={styles.line} />
            <div className={styles.square} />
        </div>
    );
};

interface GradientDividerInterface {
    height?: number;
    c1?: Property.Color;
    c2?: Property.Color;
    c3?: Property.Color;
    c4?: Property.Color;
}

const GradientDivider = ({
    height = 3,
    c1 = 'black',
    c2 = 'black',
    c3 = 'black',
    c4 = 'black',
}: GradientDividerInterface) => {
    const style: CSSProperties = {
        width: '100%',
        height,
        background: `linear-gradient(to right, ${c1}, ${c2}, ${c3}, ${c4})`,
        boxShadow: `0px 2px 4px rgba(0,0,0,0.25)`,
        pointerEvents: 'none',
    };
    return <div style={style} />;
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
        <div className={styles.UserGuideHeader}>
            <div className={styles.textContainer}>
                <div className={styles.index}>{prop.index}</div>
                <div className={styles.size}>{`/${prop.size}`}</div>
            </div>
            <div className={styles.spacer}></div>
            <div className={styles.buttonContainer}>
                <div className={styles.iconCircle} onClick={prop.onClickBack}>
                    <PreviousIcon className={styles.button} />
                </div>
                <div
                    className={styles.iconCircle}
                    onClick={
                        prop.index !== prop.size - 1
                            ? prop.onClickNext
                            : prop.onComplete
                    }
                >
                    <NextIcon className={styles.button} />
                </div>
                <AtlosButton text={'SKIP'} onClick={prop.onClickSkip} />
            </div>
        </div>
    );
};

export const MinimalTooltip = ({
    index,
    step,
    backProps,
    closeProps,
    primaryProps,
    skipProps,
    size,
}: TooltipRenderProps) => {
    const isDarkMode =
        document.documentElement.getAttribute('data-theme') === 'dark';
    return (
        <div className={styles.UserGuideTooltipWrapper}>
            <div className={styles.UserGuideTooltipContainer}>
                <TooltipHeader
                    onClickBack={backProps.onClick}
                    onClickNext={primaryProps.onClick}
                    onClickSkip={skipProps.onClick}
                    onComplete={closeProps.onClick}
                    index={index}
                    size={size}
                />
                {isDarkMode ? (
                    <GradientDivider
                        c1={'#F2F2EB4D'}
                        c2={'#F2F2EB'}
                        c3={'#F2F2EB'}
                        c4={'#F2F2EB4D'}
                    />
                ) : (
                    <GradientDivider />
                )}
                <div className={styles.UserGuideContentBase}>
                    {step.content}
                </div>
                <RangeIndicator value={parseFloat(((index + 1) / size).toFixed(2))} />
            </div>
        </div>
    );
};
