// 全局导航：打开设置、播放器等全屏页面。各页面通过 useNav() 调用，不用一层层传回调。
import { createContext, useContext } from 'react';

export type Nav = {
  openSettings: () => void;
  openPlayer: (packageId: string) => void;
  goTab: (tab: TabId) => void;
};

export type TabId = 'translate' | 'reading' | 'listen' | 'grammar' | 'words';

export const NavContext = createContext<Nav>({ openSettings: () => {}, openPlayer: () => {}, goTab: () => {} });
export const useNav = () => useContext(NavContext);
