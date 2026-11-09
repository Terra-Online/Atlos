import { useCallback, useEffect, useState } from 'react';
import type React from 'react';

type Args = {
    comments: unknown;
    error: string;
    inputValue: string;
    loading: boolean;
    rendered: unknown;
    visible: boolean;
    inputBarRef: React.RefObject<HTMLDivElement | null>;
    listRef: React.RefObject<HTMLDivElement | null>;
    panelRef: React.RefObject<HTMLElement | null>;
};

export const useInputLayout = ({
    comments,
    error,
    inputValue,
    loading,
    rendered,
    visible,
    inputBarRef,
    listRef,
    panelRef,
}: Args) => {
    const [blurVisible, setBlurVisible] = useState(false);

    const updateBlur = useCallback(() => {
        const list = listRef.current;
        if (!list) {
            setBlurVisible(false);
            return;
        }

        const overflow = list.scrollHeight - list.clientHeight > 2;
        const atBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 2;
        setBlurVisible(overflow && !atBottom);
    }, [listRef]);

    useEffect(() => {
        const list = listRef.current;
        if (!list) return undefined;

        const rafId = window.requestAnimationFrame(updateBlur);
        const observer = new ResizeObserver(updateBlur);
        observer.observe(list);

        return () => {
            window.cancelAnimationFrame(rafId);
            observer.disconnect();
        };
    }, [
        comments,
        error,
        inputValue,
        loading,
        rendered,
        visible,
        listRef,
        updateBlur,
    ]);

    useEffect(() => {
        const inputBar = inputBarRef.current;
        const panel = panelRef.current;
        if (!inputBar || !panel) return undefined;

        const syncHeight = () => {
            panel.style.setProperty('--comment-input-height', `${Math.ceil(inputBar.getBoundingClientRect().height)}px`);
            updateBlur();
        };
        syncHeight();

        const observer = new ResizeObserver(syncHeight);
        observer.observe(inputBar);
        return () => observer.disconnect();
    }, [inputBarRef, panelRef, rendered, updateBlur, visible]);

    return {
        blurVisible,
        updateBlur,
    };
};
