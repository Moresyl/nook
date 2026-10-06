import { createContext, useContext } from 'react';
import type { ContentBridge } from '../../contracts/quick-chat';

export const ContentBridgeContext = createContext<ContentBridge | undefined>(undefined);
export function useContentBridge(): ContentBridge { return useContext(ContentBridgeContext) ?? window.qiyao; }
