import { apiErrorMessage } from '../i18n/errors';
import { msg } from '../i18n';
import { useEffect, useState } from "react";
import type { DefaultCredentialView, ProviderInfo } from "../types";
import { loadSelectedProviderId } from "../localStore";

// 转录引擎（provider）列表 + 默认/选中引擎 + 凭据保存。
// 只依赖后端 /api/providers 与本地记忆，不涉及 transcript / 版本 / 文件状态。
export function useProviders() {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState<string>("");
  // 全局默认引擎 id（来自后端 /api/credentials/default），区别于用户本地记忆的选择。
  const [defaultProviderId, setDefaultProviderId] = useState<string | null>(null);
  const [activeProviderName, setActiveProviderName] = useState("");

  useEffect(() => {
    fetch("/api/providers")
      .then(async (response) => {
        if (!response.ok) throw new Error(msg('useProviders.m1146'));
        const list = (await response.json()) as ProviderInfo[];
        setProviders(list);
        const preferred = loadSelectedProviderId();
        // 1) 用户在本地明确选过的引擎优先
        if (preferred && list.some((p) => p.id === preferred)) {
          setSelectedProviderId(preferred);
        } else {
          // 2) 否则采用全局默认凭据所在的引擎（跨引擎唯一的那套）
          try {
            const def = (await (
              await fetch("/api/credentials/default")
            ).json()) as DefaultCredentialView;
            const pid = def.default_profile?.provider_id;
            if (pid && list.some((p) => p.id === pid)) {
              setSelectedProviderId(pid);
            } else {
              // 3) 兜底：列表第一个
              setSelectedProviderId(list[0]?.id ?? "");
            }
          } catch {
            setSelectedProviderId(list[0]?.id ?? "");
          }
        }
        // 全局默认引擎（独立于本地记忆）：转录弹窗用它标注「默认」徽标、
        // 并在默认引擎未配置时自动展开引擎列表。
        fetch("/api/credentials/default")
          .then((r) => r.json())
          .then((d: DefaultCredentialView) => {
            const pid = d.default_profile?.provider_id;
            if (pid && list.some((p) => p.id === pid)) setDefaultProviderId(pid);
          })
          .catch(() => {});
      })
      .catch(() => setProviders([]));
  }, []);

  const saveCredentials = async (providerId: string, values: Record<string, string>) => {
    const response = await fetch(`/api/providers/${providerId}/credentials`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { detail?: string } | null;
      throw new Error(apiErrorMessage(body, response.status, msg('useProviders.m1147')));
    }
    // 写完后重新拉一遍，刷新「已配置」状态。
    const refreshed = (await (await fetch("/api/providers")).json()) as ProviderInfo[];
    setProviders(refreshed);
  };

  return {
    providers,
    selectedProviderId,
    setSelectedProviderId,
    defaultProviderId,
    activeProviderName,
    setActiveProviderName,
    saveCredentials,
  };
}
