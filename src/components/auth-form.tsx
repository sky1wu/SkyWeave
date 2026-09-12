"use client";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/client";
import { Brand, ErrorText } from "./ui";
import { Route, Users, Wallet } from "lucide-react";
import { JourneyArt } from "./journey-art";
export function AuthForm({ register = false }: { register?: boolean }) {
  const router = useRouter();
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email")),
      password = String(form.get("password"));
    try {
      const result = register
        ? await authClient.signUp.email({
            email,
            password,
            name: String(form.get("name")),
          })
        : await authClient.signIn.email({ email, password });
      if (result.error)
        throw new Error(
          register
            ? `注册未成功：${result.error.message}`
            : "邮箱或密码不正确，请重试",
        );
      const next = new URLSearchParams(window.location.search).get("next");
      router.push(next?.startsWith("/") && !next.startsWith("//") ? next : "/");
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <main className="auth-layout">
      <div className="auth-story">
        <Brand />
        <div className="auth-intro">
          <h1>
            下一站，
            <br />
            一起出发。
          </h1>
          <p>
            把想去的地方，连成一段旅程。
            <br />
            和同行的人一起安排、记账，轻松出发。
          </p>
          <div className="auth-features">
            <span>
              <Route size={18} /> 地点与路线
            </span>
            <span>
              <Users size={18} /> 多人编辑
            </span>
            <span>
              <Wallet size={18} /> 费用分摊
            </span>
          </div>
        </div>
        <JourneyArt />
        <p className="auth-story-footer">每一天的安排，都在一张地图上。</p>
      </div>
      <div className="auth-form-side">
        <form className="auth-form" onSubmit={submit}>
          <h2>{register ? "创建账号" : "欢迎回来"}</h2>
          <p className="muted mb-8">
            {register
              ? "注册后即可创建行程或接受邀请。"
              : "登录后查看和管理你的行程。"}
          </p>
          <ErrorText error={error} />
          {register && (
            <Label>
              昵称
              <Input
                name="name"
                autoComplete="name"
                required
                maxLength={100}
                placeholder="输入昵称"
              />
            </Label>
          )}
          <Label>
            邮箱
            <Input
              name="email"
              type="email"
              autoComplete="email"
              required
              placeholder="you@example.com"
            />
          </Label>
          <Label>
            密码
            <Input
              name="password"
              type="password"
              autoComplete={register ? "new-password" : "current-password"}
              required
              minLength={8}
              maxLength={128}
              placeholder="至少 8 个字符"
            />
          </Label>
          <Button
            variant="default"
            type="submit"
            className="btn primary w-full mt-2"
            disabled={busy}
          >
            {busy ? "请稍候…" : register ? "创建账号" : "登录"}
          </Button>
          <div className="text-sm muted mt-5">
            {register ? "已有账号？" : "还没有账号？"}
            <a
              className="accent-link ml-2"
              href="#"
              onClick={(e) => {
                e.preventDefault();
                router.push(
                  `${register ? "/login" : "/register"}${window.location.search}`,
                );
              }}
            >
              {register ? "登录" : "注册"}
            </a>
          </div>
        </form>
      </div>
    </main>
  );
}
