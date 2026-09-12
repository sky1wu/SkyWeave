"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/client";
import { Brand, ErrorText } from "./ui";
import { ArrowRight, Route, Users, Wallet } from "lucide-react";
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
        <div>
          <span className="eyebrow">行程 · 协作 · 费用</span>
          <h1>
            旅行规划
            <br />
            与费用管理
          </h1>
          <p>
            安排每天的地点和路线，
            <br />
            与同行者一起编辑、记账和结算。
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
        <span className="text-xs opacity-60">Amap Trip Planner</span>
      </div>
      <div className="auth-form-side">
        <form className="auth-form" onSubmit={submit}>
          <h2>{register ? "创建账号" : "登录"}</h2>
          <p className="muted mb-8">
            {register
              ? "注册后即可创建行程或接受邀请。"
              : "登录后查看和管理你的行程。"}
          </p>
          <ErrorText error={error} />
          {register && (
            <label>
              昵称
              <input
                name="name"
                autoComplete="name"
                required
                maxLength={100}
                placeholder="输入昵称"
              />
            </label>
          )}
          <label>
            邮箱
            <input
              name="email"
              type="email"
              autoComplete="email"
              required
              placeholder="you@example.com"
            />
          </label>
          <label>
            密码
            <input
              name="password"
              type="password"
              autoComplete={register ? "new-password" : "current-password"}
              required
              minLength={8}
              maxLength={128}
              placeholder="至少 8 个字符"
            />
          </label>
          <button className="btn primary w-full mt-2" disabled={busy}>
            {busy ? "请稍候…" : register ? "创建账号" : "登录"}
            <ArrowRight size={16} />
          </button>
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
