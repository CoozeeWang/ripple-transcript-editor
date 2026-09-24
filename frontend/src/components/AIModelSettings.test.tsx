// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AIModelSettings } from "./AIModelSettings";
import CredentialManager from "../CredentialManager";

const fields = [
  { key: "base_url", label: "服务地址", secret: false, required: true, placeholder: "地址", default_value: "https://api.deepseek.com" },
  { key: "model", label: "模型名称", secret: false, required: true, placeholder: "模型" },
  { key: "api_key", label: "API 密钥", secret: true, required: true, placeholder: "密钥" },
];
const original = { base_url: "https://api.deepseek.com", model: "model-one", api_key: "private-key" };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function mockServer(base = "/api/ai/providers", initial = true) {
  const rows = initial ? [{ id: "p1", name: "个人账户", values: { ...original } }] : [];
  let active = initial ? "p1" : ""; let defaultId = active;
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    let data: unknown;
    if (url === base) data = [{ id: "deepseek", name: "DeepSeek" }];
    else if (url.endsWith("/reveal")) data = { values: rows.find(r => url.includes(`/${r.id}/`))!.values };
    else {
      const row = rows.find(r => url.endsWith(`/${r.id}`) || url.includes(`/${r.id}/`));
      if (init?.method === "POST" && url.endsWith("/credentials")) { const id = `p${rows.length + 1}`; rows.push({ id, name: body.name, values: body.values }); if (!active) active = defaultId = id; }
      if (init?.method === "PUT" && row) { row.name = body.name; row.values = body.values; }
      if (url.endsWith("/default") && row) active = defaultId = row.id;
      if (url.endsWith("/activate") && row) active = row.id;
      data = { provider_id: "deepseek", provider_name: "DeepSeek", fields, active_profile_id: active,
        profiles: rows.map(r => ({ id: r.id, name: r.name, active: r.id === active, is_default: r.id === defaultId,
          field_keys_present: Object.keys(r.values), public_values: { model: r.values.model, base_url: r.values.base_url } })) };
    }
    return new Response(JSON.stringify(data), { status: 200 });
  });
  vi.stubGlobal("fetch", fetch);
  return { rows, fetch };
}

it("adds multiple named models with masked keys and switches the default", async () => {
  const { rows, fetch } = mockServer(undefined, false);
  const ui = render(<AIModelSettings />);
  await ui.findByText("+ 添加配置");
  for (const [name, model, key] of [["个人", "model-one", "key-one"], ["团队", "model-two", "key-two"]]) {
    fireEvent.click(ui.getByText("+ 添加配置"));
    fireEvent.change(ui.getByLabelText("服务商"), { target: { value: "deepseek" } });
    const card = within(ui.getByLabelText("配置备忘名").closest(".cred-profile") as HTMLElement);
    fireEvent.change(card.getByLabelText("配置备忘名"), { target: { value: name } });
    expect((card.getByLabelText("服务地址") as HTMLInputElement).value).toBe("https://api.deepseek.com");
    fireEvent.change(card.getByLabelText("模型名称"), { target: { value: model } });
    fireEvent.change(card.getByLabelText("API 密钥"), { target: { value: key } });
    expect((card.getByLabelText("API 密钥") as HTMLInputElement).type).toBe("password");
    fireEvent.click(card.getByRole("button", { name: "显示" }));
    expect((card.getByLabelText("API 密钥") as HTMLInputElement).type).toBe("text");
    fireEvent.click(card.getByText("保存"));
    await ui.findByText(name);
  }
  expect(rows).toHaveLength(2);
  const second = within(ui.getByText("团队").closest(".cred-profile") as HTMLElement);
  fireEvent.click(second.getByText("设为默认"));
  await waitFor(() => expect(second.getByText("默认")).toBeTruthy());
  expect(fetch.mock.calls.some(([url]) => url.endsWith("/p2/default"))).toBe(true);
});

it.each(["editing", "transcription"] as const)("%s cards reveal on demand, edit actual saved keys, and discard cancelled drafts", async kind => {
  const { rows, fetch } = mockServer(kind === "editing" ? undefined : "/api/providers");
  const ui = render(<CredentialManager kind={kind} />);
  await ui.findByText("个人账户");
  expect(fetch.mock.calls.some(([url]) => url.endsWith("/reveal"))).toBe(false);
  expect(ui.queryByLabelText("API 密钥")).toBeNull();
  expect(ui.queryByText("设为启用")).toBeNull();
  fireEvent.click(ui.getByRole("button", { name: /^编辑$/ }));
  await waitFor(() => expect((ui.getByLabelText("API 密钥") as HTMLInputElement).disabled).toBe(false));
  fireEvent.click(ui.getByRole("button", { name: "显示" }));
  expect((ui.getByLabelText("API 密钥") as HTMLInputElement).type).toBe("text");
  fireEvent.click(ui.getByRole("button", { name: "隐藏" }));
  expect((ui.getByLabelText("API 密钥") as HTMLInputElement).type).toBe("password");
  fireEvent.change(ui.getByLabelText("API 密钥"), { target: { value: "discard-me" } });
  fireEvent.click(ui.getByText("取消"));
  expect(rows[0].values.api_key).toBe("private-key");
  expect(ui.queryByDisplayValue("discard-me")).toBeNull();
  fireEvent.click(ui.getByRole("button", { name: /^编辑$/ }));
  await waitFor(() => expect((ui.getByLabelText("API 密钥") as HTMLInputElement).disabled).toBe(false));
  fireEvent.change(ui.getByLabelText("模型名称"), { target: { value: "new-model" } });
  fireEvent.click(ui.getByText("保存"));
  await waitFor(() => expect(rows[0].values.model).toBe("new-model"));
  expect(rows[0].name).toBe("个人账户");
  expect(rows[0].values.api_key).toBe("private-key");
});

it("keeps failed add drafts and gives a reconnect action instead of replacing the manager with an error", async () => {
  const { fetch } = mockServer(undefined, false);
  const ui = render(<AIModelSettings />);
  await ui.findByText("+ 添加配置");
  fireEvent.click(ui.getByText("+ 添加配置"));
  fireEvent.change(ui.getByLabelText("服务商"), { target: { value: "deepseek" } });
  fireEvent.change(ui.getByLabelText("模型名称"), { target: { value: "draft-model" } });
  fetch.mockResolvedValueOnce(new Response(JSON.stringify({ detail: "请填写 API 密钥" }), { status: 422 }));
  fireEvent.click(ui.getByText("保存"));
  await ui.findByText("请填写 API 密钥");
  expect((ui.getByLabelText("模型名称") as HTMLInputElement).value).toBe("draft-model");
  expect(ui.getByText("重新连接")).toBeTruthy();
});
