// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,waitFor} from '@testing-library/react';
import {ChatGPTSetup} from './ChatGPTSetup';
import {latestTunnelRelease} from '../lib/tunnelClientRelease';
vi.mock('../lib/desktopFs',()=>({nativeDesktopAvailable:()=>true}));
vi.mock('../lib/tunnelClientRelease',async original=>({...await original<typeof import('../lib/tunnelClientRelease')>(),latestTunnelRelease:vi.fn()}));
const release={tag_name:'v0.0.99',draft:false,prerelease:false,assets:[{name:'tunnel-client-v0.0.99-darwin-arm64.zip',state:'uploaded',browser_download_url:'https://github.com/openai/tunnel-client/releases/download/v0.0.99/tunnel-client-v0.0.99-darwin-arm64.zip'}]};
beforeEach(()=>vi.mocked(latestTunnelRelease).mockResolvedValue(release));afterEach(()=>{cleanup();vi.restoreAllMocks();});
function fixture(ready=false){
 const invoke=vi.fn(async(command:string)=>command==='connector_setup_status'?{client_path:'/synthetic/tunnel-client',tunnel_id:'tunnel_synthetic',has_key:true,configured:true}:command==='connector_client_platform'?{os:'macos',arch:'aarch64'}:command==='connector_client_add'?'chatgpt':undefined);
 (window as unknown as {__TAURI__:unknown}).__TAURI__={core:{invoke}};
 const writeText=vi.fn(async()=>{});Object.defineProperty(navigator,'clipboard',{value:{writeText},configurable:true});
 const onSaved=vi.fn();const ui=render(<ChatGPTSetup tunnelReady={ready} onSaved={onSaved}/>);return {ui,invoke,writeText,onSaved};
}
it('orders four steps, matches Apple download and does not expose the saved key',async()=>{
 const {ui,invoke}=fixture();await waitFor(()=>expect(ui.getByText('修改配置')).toBeTruthy());await waitFor(()=>expect(ui.getByRole('link',{name:`下载 ${release.assets[0].name}`})).toBeTruthy());
 expect(ui.queryByRole('link',{name:'查看官方最新下载页'})).toBeNull();
 expect(ui.getAllByRole('listitem').map(step=>step.querySelector('.connector-step-label')?.textContent)).toEqual(['隧道标识（Tunnel ID）','连接程序（tunnel-client）','连接密钥（Runtime API key）','添加到 ChatGPT']);
 expect((ui.getByLabelText('连接密钥（Runtime API key）') as HTMLInputElement).value).toBe('');fireEvent.click(ui.getByRole('link',{name:'OpenAI 密钥页面'}));await waitFor(()=>expect(invoke).toHaveBeenCalledWith('connector_open_setup_link',{url:'https://platform.openai.com/settings/organization/api-keys'}));
});
it('copies the saved ID, disables an unsaved draft, and preserves the stored key on blank save',async()=>{
 const {ui,invoke,writeText,onSaved}=fixture();await waitFor(()=>expect(ui.getByText('修改配置')).toBeTruthy());
 fireEvent.click(ui.getByText('复制隧道标识'));await waitFor(()=>expect(writeText).toHaveBeenCalledWith('tunnel_synthetic'));
 fireEvent.click(ui.getByText('修改配置'));expect((ui.getByText('复制隧道标识') as HTMLButtonElement).disabled).toBe(true);fireEvent.click(ui.getByText('保存配置'));
 await waitFor(()=>expect(invoke).toHaveBeenCalledWith('connector_setup',{clientPath:'/synthetic/tunnel-client',tunnelId:'tunnel_synthetic',runtimeKey:''}));await waitFor(()=>expect(onSaved).toHaveBeenCalledOnce());
});
it('requires actual readiness before opening ChatGPT',async()=>{
 const pending=fixture();await waitFor(()=>expect(pending.ui.getByText('修改配置')).toBeTruthy());expect((pending.ui.getByText('前往 ChatGPT 添加') as HTMLButtonElement).disabled).toBe(true);cleanup();
 const {ui,invoke}=fixture(true);await waitFor(()=>expect(ui.getByText('修改配置')).toBeTruthy());fireEvent.click(ui.getByText('前往 ChatGPT 添加'));await waitFor(()=>expect(invoke).toHaveBeenCalledWith('connector_client_add',{client:'chatgpt',language:'zh-CN'}));await waitFor(()=>expect(ui.getByText(/已打开 ChatGPT 插件页面/)).toBeTruthy());
});
it('shows fallback on failure and can retry',async()=>{
 vi.mocked(latestTunnelRelease).mockRejectedValueOnce(Error('offline'));const {ui}=fixture();await waitFor(()=>expect(ui.getByText(/暂时无法获取最新版本/)).toBeTruthy());expect(ui.getByRole('link',{name:'查看官方最新下载页'}).getAttribute('href')).toContain('/releases/latest');fireEvent.click(ui.getByText('重新检查'));await waitFor(()=>expect(ui.getByRole('link',{name:`下载 ${release.assets[0].name}`})).toBeTruthy());
});
it('does not guess when the full package is missing',async()=>{
 vi.mocked(latestTunnelRelease).mockResolvedValueOnce({...release,assets:[]});const {ui}=fixture();await waitFor(()=>expect(ui.getByText(/未找到适合本机的完整安装包/)).toBeTruthy());expect(ui.queryByRole('link',{name:/\.zip$/})).toBeNull();
});
it('clears entered secrets on failure and keeps editing available',async()=>{
 const {ui,invoke}=fixture();await waitFor(()=>expect(ui.getByText('修改配置')).toBeTruthy());fireEvent.click(ui.getByText('修改配置'));
 fireEvent.change(ui.getByLabelText('连接密钥（Runtime API key）'),{target:{value:'synthetic-secret-for-failure'}});invoke.mockRejectedValueOnce('setup_failed');fireEvent.click(ui.getByText('保存配置'));
 await waitFor(()=>expect((ui.getByLabelText('连接密钥（Runtime API key）') as HTMLInputElement).value).toBe(''));expect(ui.getByText(/配置尚未完成/)).toBeTruthy();expect((ui.getByText('保存配置') as HTMLButtonElement).disabled).toBe(false);
});
