// 全局导航：打开设置、播放器等全屏页面。各页面通过 useNav() 调用，不用一层层传回调。
import { createContext, useContext } from 'react';

export type Nav = {
  /** tab：直接打开设置里的某一栏（比如精听页「填 PC 端地址」打开「同步与词典」）；不传就是「AI 接口」 */
  openSettings: (tab?: SettingsTab) => void;
  openPlayer: (packageId: string) => void;
  openCatRoom: () => void;
  goTab: (tab: TabId) => void;
};

export type TabId = 'translate' | 'reading' | 'listen' | 'grammar' | 'words';
export type SettingsTab = 'ai' | 'usage' | 'learn' | 'look' | 'sync' | 'about';

export const NavContext = createContext<Nav>({ openSettings: () => {}, openPlayer: () => {}, openCatRoom: () => {}, goTab: () => {} });
export const useNav = () => useContext(NavContext);
