"use client";

import { useState, type FormEvent } from "react";
import { Cable, Copy, Trash2 } from "lucide-react";
import type { McpToken } from "@/domain/mcp";
import { api } from "@/lib/client";
import { ErrorText } from "./ui";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { NativeSelect } from "./ui/native-select";

export interface McpSettingsProps {
  endpoint: string;
  tokens: McpToken[];
  trips: { id: string; title: string }[];
}

export function McpSettings({
  endpoint,
  tokens: initialTokens,
  trips,
}: McpSettingsProps) {
  const [tokens, setTokens] = useState(initialTokens);
  const [created, setCreated] = useState<(McpToken & { token: string }) | null>(
    null,
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setPending(true);
    setError("");
    setMessage("");
    try {
      const value = await api<McpToken & { token: string }>(
        "/mcp-tokens",
        "POST",
        {
          name: data.get("name"),
          permission: data.get("permission"),
          tripId: data.get("tripId") || null,
          expiresInDays: Number(data.get("expiresInDays")),
        },
      );
      setCreated(value);
      const { token: secret, ...metadata } = value;
      void secret;
      setTokens((current) => [metadata, ...current]);
      form.reset();
    } catch (error) {
      setError(error instanceof Error ? error.message : "创建失败，请重试。");
    } finally {
      setPending(false);
    }
  }

  async function revoke(entry: McpToken) {
    if (pending) return;
    setPending(true);
    setError("");
    setMessage("");
    try {
      await api(`/mcp-tokens/${entry.id}`, "DELETE", {});
      setTokens((current) => current.filter((token) => token.id !== entry.id));
      if (created?.id === entry.id) setCreated(null);
      setMessage(`已撤销「${entry.name}」，使用它的 Agent 将无法继续访问。`);
    } catch (error) {
      setError(error instanceof Error ? error.message : "撤销失败，请重试。");
    } finally {
      setPending(false);
    }
  }

  async function copyToken() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.token);
      setError("");
      setMessage("令牌已复制。");
    } catch {
      setError("无法自动复制，请选中令牌后手动复制。");
    }
  }

  return (
    <section className="settings-section" aria-labelledby="mcp-heading">
      <h2 id="mcp-heading">
        <Cable size={19} aria-hidden="true" />
        Agent 访问 · MCP
      </h2>
      <p className="settings-description">
        让 Agent
        读取或编辑旅行日程、费用与结算记录。访问权限始终受你的行程成员角色限制。
      </p>
      <Label className="mt-5">
        MCP 地址
        <Input
          value={endpoint}
          readOnly
          onFocus={(event) => event.target.select()}
        />
      </Label>
      <p className="settings-description">
        连接方式选择 Streamable HTTP，认证选择 Bearer
        Token，填入下方创建的令牌。
      </p>
      <form onSubmit={create}>
        <fieldset disabled={pending || created !== null}>
          <Label>
            令牌名称
            <Input
              name="name"
              required
              maxLength={100}
              placeholder="例如：旅行助手"
            />
          </Label>
          <Label>
            允许访问的行程
            <NativeSelect
              name="tripId"
              aria-label="允许访问的行程"
              defaultValue={trips[0]?.id ?? ""}
            >
              {trips.map((trip) => (
                <option key={trip.id} value={trip.id}>
                  {trip.title}
                </option>
              ))}
              <option value="">所有我可访问的行程（含以后加入的行程）</option>
            </NativeSelect>
          </Label>
          <div className="settings-password-fields">
            <Label>
              访问权限
              <NativeSelect
                name="permission"
                aria-label="访问权限"
                defaultValue="read"
              >
                <option value="read">只读日程与费用</option>
                <option value="edit">读写日程与费用</option>
              </NativeSelect>
            </Label>
            <Label>
              有效期
              <NativeSelect
                name="expiresInDays"
                aria-label="有效期"
                defaultValue="30"
              >
                <option value="7">7 天</option>
                <option value="30">30 天</option>
                <option value="90">90 天</option>
                <option value="365">365 天</option>
              </NativeSelect>
            </Label>
          </div>
          <div className="settings-form-footer">
            <Button type="submit">
              {pending ? "处理中…" : "创建访问令牌"}
            </Button>
          </div>
        </fieldset>
      </form>
      {created && (
        <div className="mcp-token-created">
          <Label>
            新令牌 · 仅显示这一次
            <Input
              value={created.token}
              readOnly
              autoComplete="off"
              spellCheck={false}
              onFocus={(event) => event.target.select()}
            />
          </Label>
          <p className="settings-description">
            复制并保存到 Agent 的连接配置中。关闭后无法再次查看。
          </p>
          <div className="settings-form-footer">
            <Button type="button" variant="outline" onClick={copyToken}>
              <Copy size={15} aria-hidden="true" />
              复制令牌
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setCreated(null);
                setMessage("");
              }}
            >
              已保存，关闭
            </Button>
          </div>
        </div>
      )}
      <ErrorText error={error} />
      <p role="status" className="settings-description">
        {message}
      </p>
      <ul className="mcp-token-list" aria-label="已创建的 MCP 令牌">
        {tokens.map((entry) => (
          <li key={entry.id}>
            <div>
              <strong>{entry.name}</strong>
              <p>
                {entry.permission === "edit" ? "读写" : "只读"} ·{" "}
                {entry.tripTitle ?? "所有可访问行程"}
              </p>
              <p>
                {entry.tokenPrefix}… · 到期{" "}
                {new Date(entry.expiresAt).toLocaleDateString("zh-CN", {
                  timeZone: "Asia/Shanghai",
                })}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
              aria-label={`撤销令牌 ${entry.name}`}
              onClick={() => revoke(entry)}
            >
              <Trash2 size={14} aria-hidden="true" />
              撤销
            </Button>
          </li>
        ))}
      </ul>
      {!tokens.length && (
        <p className="settings-description">还没有访问令牌。</p>
      )}
    </section>
  );
}
