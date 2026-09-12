"use client";
import { useState, useEffect } from "react";
import { UserPlus, Link2, Copy, Users, Mail, Ban } from "lucide-react";
import type { TripSnapshot, Participant } from "@/domain/types";
import type { Mutate } from "./planner";
import { ErrorText, Modal } from "./ui";
export function Members({
  snapshot,
  mutate,
}: {
  snapshot: TripSnapshot;
  mutate: Mutate;
}) {
  const [error, setError] = useState(""),
    [newPerson, setNewPerson] = useState(false),
    [invite, setInvite] = useState<Participant | "general" | null>(null),
    [url, setUrl] = useState(""),
    [copied, setCopied] = useState(false),
    [rename, setRename] = useState<Participant | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  const owner = snapshot.role === "owner",
    editable = snapshot.role !== "viewer";
  async function act(fn: () => Promise<unknown>) {
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <main className="content-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">BETTER WITH GOOD COMPANY</span>
          <h2 className="section-title mt-2">这一次，和谁一起出发</h2>
        </div>
        <div className="flex gap-2">
          {editable && (
            <button className="btn" onClick={() => setNewPerson(true)}>
              <UserPlus size={15} />
              添加同行者
            </button>
          )}
          {owner && (
            <button
              className="btn primary"
              onClick={() => {
                setUrl("");
                setInvite("general");
              }}
            >
              <Link2 size={15} />
              邀请朋友
            </button>
          )}
        </div>
      </div>
      <ErrorText error={error} />
      <div className="member-grid">
        {snapshot.participants.map((p) => {
          const m = snapshot.members.find((m) => m.userId === p.userId);
          return (
            <section className="panel member-card" key={p.id}>
              <div className="flex gap-4 items-center">
                <div className="avatar large">{p.name.slice(0, 1)}</div>
                <div>
                  <h3 className="font-semibold">{p.name}</h3>
                  <p className="text-xs muted mt-1">
                    {p.status === "inactive"
                      ? "已停用 · 历史账目保留"
                      : m
                        ? m.role === "owner"
                          ? "行程所有者"
                          : m.role === "editor"
                            ? "共同编辑"
                            : "只读成员"
                        : "未注册同行者"}
                  </p>
                </div>
              </div>
              {m && (
                <p className="text-xs muted flex gap-2 items-center mt-5">
                  <Mail size={13} />
                  {m.email}
                </p>
              )}
              {!m && (
                <p className="text-xs muted mt-5">
                  可参与记账和结算。通过专属邀请加入后，历史账目会自动保留。
                </p>
              )}
              {owner && (
                <div className="flex flex-wrap gap-2 mt-5">
                  {m && m.role !== "owner" && (
                    <>
                      <select
                        className="max-w-32 text-xs"
                        aria-label={`${p.name} 角色`}
                        value={m.role}
                        onChange={(e) =>
                          act(() =>
                            mutate(
                              `/trips/${snapshot.trip.id}/members/${m.userId}`,
                              "PATCH",
                              {
                                expectedVersion: m.version,
                                role: e.target.value,
                              },
                            ),
                          )
                        }
                      >
                        <option value="editor">共同编辑</option>
                        <option value="viewer">只读成员</option>
                      </select>
                      <button
                        className="btn"
                        onClick={() =>
                          act(() =>
                            mutate(
                              `/trips/${snapshot.trip.id}/members/${m.userId}`,
                              "PATCH",
                              {
                                expectedVersion: m.version,
                                status:
                                  m.status === "active" ? "inactive" : "active",
                              },
                            ),
                          )
                        }
                      >
                        {m.status === "active" ? "移出行程" : "恢复成员"}
                      </button>
                    </>
                  )}
                  {!m && p.status === "active" && (
                    <button
                      className="btn"
                      onClick={() => {
                        setUrl("");
                        setInvite(p);
                      }}
                    >
                      <Link2 size={13} />
                      专属邀请
                    </button>
                  )}
                  <button className="btn" onClick={() => setRename(p)}>
                    修改姓名
                  </button>
                  {!m && (
                    <button
                      className="btn"
                      onClick={() =>
                        act(() =>
                          mutate(
                            `/trips/${snapshot.trip.id}/participants/${p.id}`,
                            "PATCH",
                            {
                              expectedVersion: p.version,
                              status:
                                p.status === "active" ? "inactive" : "active",
                            },
                          ),
                        )
                      }
                    >
                      {p.status === "active" ? "停用" : "恢复"}
                    </button>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>
      {owner && (
        <>
          <h3 className="font-semibold mt-10 mb-4">邀请记录</h3>
          <section className="panel">
            {snapshot.invites.length ? (
              snapshot.invites.map((i) => (
                <div className="invite-row" key={i.id}>
                  <Link2 size={17} />
                  <div className="flex-1">
                    <p className="text-sm">
                      {i.participantId
                        ? `${snapshot.participants.find((p) => p.id === i.participantId)?.name} 的专属邀请`
                        : "普通邀请"}{" "}
                      · {i.role === "editor" ? "共同编辑" : "只读"}
                    </p>
                    <p className="text-xs muted mt-1">
                      已使用 {i.usedCount}/{i.maxUses} 次 ·{" "}
                      {i.revokedAt
                        ? "已撤销"
                        : i.expiresAt < now
                          ? "已过期"
                          : `有效至 ${new Date(i.expiresAt).toLocaleDateString("zh-CN")}`}
                    </p>
                  </div>
                  {!i.revokedAt && (
                    <button
                      className="btn"
                      onClick={() =>
                        act(() =>
                          mutate(
                            `/trips/${snapshot.trip.id}/invites/${i.id}`,
                            "DELETE",
                            { expectedVersion: i.version },
                          ),
                        )
                      }
                    >
                      <Ban size={13} />
                      撤销
                    </button>
                  )}
                </div>
              ))
            ) : (
              <div className="empty">还没有创建邀请。</div>
            )}
          </section>
        </>
      )}
      {newPerson && (
        <Modal title="添加未注册同行者" close={() => setNewPerson(false)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void act(async () => {
                await mutate(
                  `/trips/${snapshot.trip.id}/participants`,
                  "POST",
                  { name: f.get("name") },
                );
                setNewPerson(false);
              });
            }}
          >
            <ErrorText error={error} />
            <label>
              同行者姓名
              <input
                name="name"
                required
                maxLength={100}
                placeholder="例如：小林"
              />
            </label>
            <p className="text-sm muted">
              无需注册即可参与费用分摊，之后可通过专属邀请绑定账号。
            </p>
            <button className="btn primary">添加同行者</button>
          </form>
        </Modal>
      )}
      {rename && (
        <Modal title="修改同行者姓名" close={() => setRename(null)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void act(async () => {
                await mutate(
                  `/trips/${snapshot.trip.id}/participants/${rename.id}`,
                  "PATCH",
                  { name: f.get("name"), expectedVersion: rename.version },
                );
                setRename(null);
              });
            }}
          >
            <ErrorText error={error} />
            <label>
              姓名
              <input
                name="name"
                required
                maxLength={100}
                defaultValue={rename.name}
              />
            </label>
            <button className="btn primary">保存</button>
          </form>
        </Modal>
      )}
      {invite && (
        <Modal
          title={invite === "general" ? "邀请朋友加入" : `邀请 ${invite.name}`}
          close={() => setInvite(null)}
        >
          {url ? (
            <div className="grid gap-4">
              <p className="text-sm muted">
                将链接复制给朋友。链接只在创建时展示，请妥善保存。
              </p>
              <input
                aria-label="邀请链接"
                readOnly
                value={url}
                onFocus={(e) => e.target.select()}
              />
              <button
                className="btn primary"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(url);
                    setCopied(true);
                  } catch {
                    setError("请选中上方链接手动复制");
                  }
                }}
              >
                <Copy size={15} />
                {copied ? "已复制" : "复制邀请链接"}
              </button>
              <ErrorText error={error} />
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void act(async () => {
                  const result = await mutate<{ path: string }>(
                    `/trips/${snapshot.trip.id}/invites`,
                    "POST",
                    {
                      role: f.get("role"),
                      participantId: invite === "general" ? null : invite.id,
                      maxUses:
                        invite === "general" ? Number(f.get("maxUses")) : 1,
                      expiresAt: Date.now() + Number(f.get("days")) * 86400000,
                    },
                  );
                  setUrl(window.location.origin + result.path);
                  setCopied(false);
                });
              }}
            >
              <ErrorText error={error} />
              <label>
                加入后的权限
                <select name="role">
                  <option value="editor">共同编辑行程和费用</option>
                  <option value="viewer">只读，可发表评论</option>
                </select>
              </label>
              <div className="field-grid">
                <label>
                  有效天数
                  <input
                    name="days"
                    type="number"
                    min={1}
                    max={365}
                    defaultValue={7}
                  />
                </label>
                {invite === "general" && (
                  <label>
                    可使用次数
                    <input
                      name="maxUses"
                      type="number"
                      min={1}
                      max={1000}
                      defaultValue={10}
                    />
                  </label>
                )}
              </div>
              {invite !== "general" && (
                <p className="text-sm muted">
                  这是一次性专属邀请，接受后将绑定「{invite.name}
                  」的已有账目身份。
                </p>
              )}
              <button className="btn primary">
                <Users size={15} />
                生成邀请链接
              </button>
            </form>
          )}
        </Modal>
      )}
    </main>
  );
}
