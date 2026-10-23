import { createContext } from 'react';

export type VisibilityReporter = (id: string, visible: boolean) => void;

export interface IMarkVisibilityContext {
    report: VisibilityReporter;
}

export const MarkVisibilityContext = createContext<IMarkVisibilityContext | null>(null);
