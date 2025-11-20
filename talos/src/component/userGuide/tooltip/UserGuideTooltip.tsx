import styles from './UserGuideTooltip.module.scss';

import { TooltipRenderProps } from 'react-joyride';
import { CSSProperties, MouseEventHandler } from 'react';

import AtlosButton from '@/component/button/button';

const RangeIndicator = ({ value }: { value: number }) => {
    return (
        <div className={styles.UserGuideRangeIndicatorContainer} style={{ width: `${value}%` }}>
            <div className={styles.square} />
            <div className={styles.line} />
            <span className={styles.range}>{`${value}%`}</span>
            <div className={styles.line} />
            <div className={styles.square} />
        </div>
    );
};

interface GradientDividerInterface {
    height?: number;
    c1?: string;
    c2?: string;
    c3?: string;
    c4?: string;
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
                <div className={styles.index}>{`${prop.index + 1}`}</div>
                <div className={styles.size}>{`/${prop.size}`}</div>
            </div>
            <div className={styles.spacer}></div>
            <div className={styles.buttonContainer}>
                <AtlosButton
                    text=''
                    buttonType='prev'
                    buttonStyle='icon'
                    onClick={prop.onClickBack}
                    size={'2rem'}
                />
                <AtlosButton
                    text=''
                    buttonType='next'
                    buttonStyle='icon'
                    onClick={
                        prop.index !== prop.size - 1
                            ? prop.onClickNext
                            : prop.onComplete
                    }
                    size={'2rem'}
                />
                <AtlosButton text={'SKIP'} onClick={prop.onClickSkip} />
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
                <RangeIndicator value={Math.round(((index + 1) / size) * 100)} />
            </div>
        </div>
    );
};
