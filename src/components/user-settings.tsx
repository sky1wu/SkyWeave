"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Check, ChevronLeft, KeyRound, LogOut, UserRound } from "lucide-react";
import { authClient } from "@/lib/client";
import { Brand, ErrorText } from "./ui";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { McpSettings, type McpSettingsProps } from "./mcp-settings";

function authError(error: { status: number; code?: string }, fallback: string) {
  if (error.status === 401) {
    // Discard private client state when the session expires.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/login?next=%2Fsettings");
    return "登录已失效，正在前往登录页…";
  }
  if (error.status === 429) return "操作过于频繁，请稍后再试。";
  switch (error.code) {
    case "INVALID_PASSWORD":
      return "当前密码不正确，请重新输入。";
    case "PASSWORD_TOO_SHORT":
    case "PASSWORD_TOO_LONG":
      return "新密码需要 8–128 个字符。";
    default:
      return fallback;
  }
}

function SuccessText({ message }: { message: string }) {
  return (
    <div role="status" className="settings-success">
      {message && (
        <>
          <Check size={16} aria-hidden="true" />
          {message}
        </>
      )}
    </div>
  );
}

export function UserSettings({
  user,
  mcp,
}: {
  user: { name: string; email: string };
  mcp: McpSettingsProps;
}) {
  const router = useRouter();
  const [name, setName] = useState(user.name);
  const [savedName, setSavedName] = useState(user.name);
  const [pending, setPending] = useState<
    "profile" | "password" | "signout" | null
  >(null);
  const [profileError, setProfileError] = useState("");
  const [profileSuccess, setProfileSuccess] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordSuccess, setPasswordSuccess] = useState("");
  const [signOutError, setSignOutError] = useState("");

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setProfileError("");
    setProfileSuccess("");
    const trimmedName = name.trim();
    if (!trimmedName || trimmedName.length > 100) {
      setProfileError("请输入 1–100 个字符的昵称，不能只包含空格。");
      return;
    }
    setPending("profile");
    try {
      const result = await authClient.updateUser({ name: trimmedName });
      if (result.error) {
        setProfileError(authError(result.error, "昵称未保存，请重试。"));
        return;
      }
      setName(trimmedName);
      setSavedName(trimmedName);
      setProfileSuccess("昵称已保存。");
      router.refresh();
    } catch {
      setProfileError("无法连接服务器，请检查网络后重试。");
    } finally {
      setPending(null);
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const currentPassword = String(values.get("currentPassword"));
    const newPassword = String(values.get("newPassword"));
    setPasswordError("");
    setPasswordSuccess("");
    if (newPassword !== values.get("confirmPassword")) {
      setPasswordError("两次输入的新密码不一致，请重新确认。");
      return;
    }
    if (newPassword === currentPassword) {
      setPasswordError("新密码不能与当前密码相同。");
      return;
    }
    setPending("password");
    try {
      const result = await authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
      });
      if (result.error) {
        setPasswordError(authError(result.error, "密码未修改，请重试。"));
        return;
      }
      form.reset();
      setPasswordSuccess("密码已修改，其他设备需要重新登录。");
    } catch {
      setPasswordError("无法连接服务器，请检查网络后重试。");
    } finally {
      setPending(null);
    }
  }

  async function signOut() {
    if (pending) return;
    setPending("signout");
    setSignOutError("");
    try {
      const result = await authClient.signOut();
      if (result.error) {
        setSignOutError(authError(result.error, "退出未成功，请重试。"));
        return;
      }
      // A full navigation clears cached account and trip data.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign("/login");
    } catch {
      setSignOutError("无法连接服务器，请检查网络后重试。");
    } finally {
      setPending(null);
    }
  }

  return (
    <>
      <header className="site-header">
        <Brand />
        <Link href="/" className="settings-back">
          <ChevronLeft size={16} aria-hidden="true" />
          所有行程
        </Link>
      </header>
      <main className="settings-main">
        <div className="settings-heading">
          <h1>用户设置</h1>
          <p className="page-description">
            管理个人资料、登录密码与 Agent 访问。
          </p>
        </div>
        <div className="settings-layout">
          <aside className="settings-identity" aria-label="当前账号">
            <span className="settings-avatar" aria-hidden="true">
              {Array.from(savedName.trim())[0] || <UserRound size={28} />}
            </span>
            <div>
              <h2>{savedName}</h2>
              <p>{user.email}</p>
            </div>
          </aside>
          <div className="settings-sections">
            <section
              className="settings-section"
              aria-labelledby="profile-heading"
            >
              <h2 id="profile-heading">
                <UserRound size={19} aria-hidden="true" />
                个人资料
              </h2>
              <p className="settings-description">让同行的人知道你是谁。</p>
              <form onSubmit={saveProfile}>
                <fieldset disabled={pending !== null}>
                  <Label>
                    昵称
                    <Input
                      name="name"
                      autoComplete="name"
                      required
                      maxLength={100}
                      value={name}
                      aria-describedby="name-description"
                      onChange={(event) => {
                        setName(event.target.value);
                        setProfileError("");
                        setProfileSuccess("");
                      }}
                    />
                  </Label>
                  <p id="name-description" className="settings-help">
                    显示在行程成员、评论和协作动态中。
                  </p>
                  <Label>
                    登录邮箱
                    <Input
                      name="email"
                      type="email"
                      autoComplete="email"
                      value={user.email}
                      readOnly
                      aria-describedby="email-description"
                    />
                  </Label>
                  <p id="email-description" className="settings-help">
                    用于登录，暂不支持修改。
                  </p>
                  <ErrorText error={profileError} />
                  <div className="settings-form-footer">
                    <Button
                      type="submit"
                      disabled={pending !== null || name.trim() === savedName}
                    >
                      {pending === "profile" ? "保存中…" : "保存昵称"}
                    </Button>
                    <SuccessText message={profileSuccess} />
                  </div>
                </fieldset>
              </form>
            </section>
            <section
              className="settings-section"
              aria-labelledby="password-heading"
            >
              <h2 id="password-heading">
                <KeyRound size={19} aria-hidden="true" />
                修改密码
              </h2>
              <p className="settings-description" id="password-description">
                修改后，其他设备需重新登录，当前设备保持登录。
              </p>
              <form
                onSubmit={changePassword}
                onChange={() => {
                  setPasswordError("");
                  setPasswordSuccess("");
                }}
              >
                <fieldset disabled={pending !== null}>
                  <Label>
                    当前密码
                    <Input
                      name="currentPassword"
                      type="password"
                      autoComplete="current-password"
                      required
                      maxLength={128}
                    />
                  </Label>
                  <div className="settings-password-fields">
                    <Label>
                      新密码
                      <Input
                        name="newPassword"
                        type="password"
                        autoComplete="new-password"
                        required
                        minLength={8}
                        maxLength={128}
                        placeholder="8–128 个字符"
                        aria-describedby="password-description"
                      />
                    </Label>
                    <Label>
                      确认新密码
                      <Input
                        name="confirmPassword"
                        type="password"
                        autoComplete="new-password"
                        required
                        minLength={8}
                        maxLength={128}
                        placeholder="再次输入新密码"
                      />
                    </Label>
                  </div>
                  <ErrorText error={passwordError} />
                  <div className="settings-form-footer">
                    <Button type="submit" disabled={pending !== null}>
                      {pending === "password" ? "修改中…" : "修改密码"}
                    </Button>
                    <SuccessText message={passwordSuccess} />
                  </div>
                </fieldset>
              </form>
            </section>
            <McpSettings {...mcp} />
            <section
              className="settings-section settings-signout"
              aria-labelledby="signout-heading"
            >
              <div>
                <h2 id="signout-heading">退出登录</h2>
                <p className="settings-description">
                  退出当前设备，已保存的行程会保留。
                </p>
                <ErrorText error={signOutError} />
              </div>
              <Button
                type="button"
                variant="outline"
                disabled={pending !== null}
                onClick={signOut}
              >
                <LogOut size={16} aria-hidden="true" />
                {pending === "signout" ? "退出中…" : "退出登录"}
              </Button>
            </section>
          </div>
        </div>
      </main>
    </>
  );
}
