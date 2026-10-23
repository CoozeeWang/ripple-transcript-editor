import { i18next, interfaceLanguage, msg } from '../i18n';
import { IS_MAC } from './format';
import { recentProjects } from './projectStore';

const menuKeys = {
  'Check for Updates…':'checkUpdates', 'Software Update':'updateTitle',
  'Open Project…':'openProject',
  'Recent Projects':'recentProjects', 'No Recent Projects':'noRecentProjects',
  File: 'file', Edit: 'edit', View: 'view', Window: 'window', Help: 'help',
  About: 'about', Services: 'services', Hide: 'hide', 'Hide Others': 'hideOthers',
  'Show All': 'showAll', Quit: 'quit', Exit: 'quit',
  'Close Window': 'closeWindow', Close: 'closeWindow', Undo: 'undo', Redo: 'redo',
  Cut: 'cut', Copy: 'copy', Paste: 'paste', 'Select All': 'selectAll',
  'Toggle Full Screen': 'fullscreen', Minimize: 'minimize', Zoom: 'zoom', Maximize: 'maximize',
} as const;

/** Keep the standard native actions and shortcuts; translate only their labels. */
export function nativeMenuLabels(macos = IS_MAC) {
  return Object.fromEntries(Object.entries(menuKeys).map(([source, key]) => [source, msg(`nativeMenu.${macos && key === 'help' ? 'helpMac' : macos && key === 'minimize' ? 'minimizeMac' : key}`, { name: '__APP_NAME__' })]));
}
export function installNativeMenuLanguage(invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>,
  loadRecents: () => Promise<{id:string;title:string}[]> = async () => (await recentProjects()).map(({id,title}) => ({id,title}))) {
  let revision = 0;
  const update = () => {
    const current = ++revision;
    void loadRecents().catch(() => []).then(recentProjects => {
      if (current !== revision) return;
      return invoke('set_menu_language', { labels: nativeMenuLabels(), language: interfaceLanguage(), recentProjects });
    }).catch(error => console.error('Native menu update failed', error));
  };
  update();
  i18next.on('languageChanged', update);
  window.addEventListener('ripple-recent-projects-changed', update);
  return () => { ++revision; i18next.off('languageChanged', update); window.removeEventListener('ripple-recent-projects-changed', update); };
}
