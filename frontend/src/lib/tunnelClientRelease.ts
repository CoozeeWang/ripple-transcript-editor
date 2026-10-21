/** Public metadata only: no account credentials, local paths or document data. */
export const TUNNEL_RELEASE_PAGE = 'https://github.com/openai/tunnel-client/releases/latest';
export const TUNNEL_RELEASE_API = 'https://api.github.com/repos/openai/tunnel-client/releases/latest';
export interface ClientPlatform { os: string; arch: string }
export interface ClientDownload { name: string; url: string; version: string }

export function officialSetupUrl(value: string): boolean {
  if (['https://platform.openai.com/settings/organization/tunnels',
    'https://platform.openai.com/settings/organization/api-keys', TUNNEL_RELEASE_PAGE].includes(value)) return true;
  try {
    const url = new URL(value);
    return url.origin === 'https://github.com' && !url.username && !url.password && !url.search && !url.hash
      && /^\/openai\/tunnel-client\/releases\/download\/[^/]+\/tunnel-client-v[\w.+-]+-(darwin|windows|linux)-(arm64|amd64)\.zip$/.test(url.pathname);
  } catch { return false; }
}

export function releaseDownload(data: unknown, platform: ClientPlatform): ClientDownload | null {
  if (!data || typeof data !== 'object') return null;
  const release = data as Record<string, unknown>;
  if (release.draft !== false || release.prerelease !== false || typeof release.tag_name !== 'string'
    || !/^v[\w.+-]+$/.test(release.tag_name) || !Array.isArray(release.assets)) return null;
  const os = platform.os === 'macos' ? 'darwin' : platform.os;
  const arch = platform.arch === 'aarch64' ? 'arm64' : platform.arch === 'x86_64' ? 'amd64' : platform.arch;
  if (!['darwin', 'windows', 'linux'].includes(os) || !['arm64', 'amd64'].includes(arch)) return null;
  // Exact full archive: runtime/cloudflared/all packages are deliberately excluded.
  const name = `tunnel-client-${release.tag_name}-${os}-${arch}.zip`;
  const matches = release.assets.filter(asset => asset && asset.name === name && asset.state === 'uploaded');
  if (matches.length !== 1 || typeof matches[0].browser_download_url !== 'string') return null;
  const url = matches[0].browser_download_url;
  if (!officialSetupUrl(url) || new URL(url).pathname !== `/openai/tunnel-client/releases/download/${release.tag_name}/${name}`) return null;
  return { name, url, version: release.tag_name };
}

let inFlight: Promise<unknown> | undefined;
export function latestTunnelRelease(): Promise<unknown> {
  if (inFlight) return inFlight;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  inFlight = fetch(TUNNEL_RELEASE_API, { headers: { Accept: 'application/vnd.github+json' },
    credentials: 'omit', cache: 'no-store', signal: controller.signal })
    .then(response => { if (!response.ok) throw new Error('release_unavailable'); return response.json(); })
    .finally(() => { clearTimeout(timeout); inFlight = undefined; });
  return inFlight;
}
