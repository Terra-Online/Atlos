import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
    children: ReactNode;
    /** Rendered after a render error. Defaults to nothing so one failed panel cannot take the map down. */
    fallback?: ReactNode;
    /** Changing any value resets the boundary, e.g. when the owning region or query changes. */
    resetKeys?: readonly unknown[];
    onError?: (error: Error, info: ErrorInfo) => void;
}

interface State {
    failed: boolean;
}

const changed = (a: readonly unknown[] = [], b: readonly unknown[] = []) =>
    a.length !== b.length || a.some((value, index) => !Object.is(value, b[index]));

/** Isolates a subtree so a render or lazy-chunk failure does not blank the whole app. */
export default class ErrorBoundary extends Component<Props, State> {
    override state: State = { failed: false };

    static getDerivedStateFromError(): State {
        return { failed: true };
    }

    override componentDidCatch(error: Error, info: ErrorInfo): void {
        if (this.props.onError) this.props.onError(error, info);
        else console.error('[ErrorBoundary]', error, info.componentStack);
    }

    override componentDidUpdate(prev: Props): void {
        if (this.state.failed && changed(prev.resetKeys, this.props.resetKeys)) {
            this.setState({ failed: false });
        }
    }

    override render(): ReactNode {
        return this.state.failed ? (this.props.fallback ?? null) : this.props.children;
    }
}
