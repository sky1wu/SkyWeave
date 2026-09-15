"use client";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { NativeSelect } from "./ui/native-select";
import { Button } from "./ui/button";
import { useState, useEffect } from "react";
import { UserPlus, Link2, Copy, Users, Mail, Ban, Trash2 } from "lucide-react";
import type { TripSnapshot, Participant } from "@/domain/types";
import type { Mutate } from "./planner";
import { ErrorText, Modal } from "./ui";
import { useConfirmation } from "./confirmation";
export function Members({
  snapshot,
  mutate,
}: {
  snapshot: TripSnapshot;
  mutate: Mutate;
}) {
  const { confirm, confirmation } = useConfirmation();
  const [deleting, setDeleting] = useState<string | null>(null);
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
  async function remove(p: Participant) {
    if (
      !(await confirm(
        `删除同行者「${p.name}」？其专属邀请链接将一并失效，此操作无法撤销。`,
      ))
    )
      return;
    setDeleting(p.id);
    try {
      await act(() =>
        mutate(`/trips/${snapshot.trip.id}/participants/${p.id}`, "DELETE", {
          expectedVersion: p.version,
        }),
      );
    } finally {
      setDeleting(null);
    }
  }
  return (
    <main className="content-page">
      {confirmation}
      <div className="page-heading">
        <div>
          <h2 className="section-title">同行成员</h2>
          <p className="page-description">管理成员权限、同行者和邀请链接。</p>
        </div>
        <div className="flex gap-2">
          {editable && (
            <Button
              variant="outline"
              type="button"
              className="btn"
              onClick={() => setNewPerson(true)}
            >
              <UserPlus size={15} />
              添加同行者
            </Button>
          )}
          {owner && (
            <Button
              variant="default"
              type="button"
              className="btn primary"
              onClick={() => {
                setUrl("");
                setInvite("general");
              }}
            >
              <Link2 size={15} />
              邀请朋友
            </Button>
          )}
        </div>
      </div>
      <ErrorText error={error} />
      <div className="member-grid">
        {snapshot.participants.map((p) => {
          const m = snapshot.members.find((m) => m.userId === p.userId);
          const name = m?.name ?? p.name;
          return (
            <section className="member-card" key={p.id}>
              <div className="member-identity">
                <div className="avatar large">{name.slice(0, 1)}</div>
                <div>
                  <h3 className="font-semibold">{name}</h3>
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
                <p className="member-detail">
                  <Mail size={13} />
                  {m.email}
                </p>
              )}
              {!m && (
                <p className="member-detail">
                  可参与分摊，接受专属邀请后绑定账号。
                </p>
              )}
              {owner && (
                <div className="member-actions">
                  {m && m.role !== "owner" && (
                    <>
                      <NativeSelect
                        className="max-w-32 text-xs"
                        aria-label={`${name} 角色`}
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
                      </NativeSelect>
                      <Button
                        variant="outline"
                        type="button"
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
                      </Button>
                    </>
                  )}
                  {!m && p.status === "active" && (
                    <Button
                      variant="outline"
                      type="button"
                      className="btn"
                      onClick={() => {
                        setUrl("");
                        setInvite(p);
                      }}
                    >
                      <Link2 size={13} />
                      专属邀请
                    </Button>
                  )}
                  {!p.userId && (
                    <Button
                      variant="outline"
                      type="button"
                      className="btn"
                      onClick={() => setRename(p)}
                    >
                      修改姓名
                    </Button>
                  )}
                  {!m && (
                    <Button
                      variant="outline"
                      type="button"
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
                    </Button>
                  )}
                  {!p.userId && (
                    <Button
                      variant="destructive"
                      type="button"
                      className="btn danger"
                      disabled={deleting !== null}
                      onClick={() => void remove(p)}
                    >
                      <Trash2 size={13} />
                      {deleting === p.id ? "删除中…" : "删除同行者"}
                    </Button>
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
                    <Button
                      variant="outline"
                      type="button"
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
                    </Button>
                  )}
                </div>
              ))
            ) : (
              <div className="empty">暂无邀请记录。</div>
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
            <Label>
              同行者姓名
              <Input
                name="name"
                required
                maxLength={100}
                placeholder="例如：小林"
              />
            </Label>
            <p className="text-sm muted">
              无需注册即可参与费用分摊，之后可通过专属邀请绑定账号。
            </p>
            <Button variant="default" type="submit" className="btn primary">
              添加同行者
            </Button>
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
            <Label>
              姓名
              <Input
                name="name"
                required
                maxLength={100}
                defaultValue={rename.name}
              />
            </Label>
            <Button variant="default" type="submit" className="btn primary">
              保存
            </Button>
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
              <Input
                aria-label="邀请链接"
                readOnly
                value={url}
                onFocus={(e) => e.target.select()}
              />
              <Button
                variant="default"
                type="button"
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
              </Button>
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
              <Label>
                加入后的权限
                <NativeSelect name="role">
                  <option value="editor">共同编辑行程和费用</option>
                  <option value="viewer">只读，可发表评论</option>
                </NativeSelect>
              </Label>
              <div className="field-grid">
                <Label>
                  有效天数
                  <Input
                    name="days"
                    type="number"
                    min={1}
                    max={365}
                    defaultValue={7}
                  />
                </Label>
                {invite === "general" && (
                  <Label>
                    可使用次数
                    <Input
                      name="maxUses"
                      type="number"
                      min={1}
                      max={1000}
                      defaultValue={10}
                    />
                  </Label>
                )}
              </div>
              {invite !== "general" && (
                <p className="text-sm muted">
                  这是一次性专属邀请，接受后将绑定「{invite.name}
                  」的已有账目身份。
                </p>
              )}
              <Button variant="default" type="submit" className="btn primary">
                <Users size={15} />
                生成邀请链接
              </Button>
            </form>
          )}
        </Modal>
      )}
    </main>
  );
}
