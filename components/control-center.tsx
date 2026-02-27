"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type AccountView = {
  id: string;
  username: string;
  displayName: string;
  language: string | null;
  purpose: string | null;
  status: string;
  tokenExpiresAt: string | null;
  tags: string[];
  groups: string[];
  scheduleCount: number;
  proxy: {
    enabled: boolean;
    protocol: string | null;
    host: string | null;
    port: number | null;
    username: string | null;
    hasPassword: boolean;
  };
};

type ContentView = {
  id: string;
  title: string;
  topic: string | null;
  language: string | null;
  status: string;
  variants: Array<{
    id: string;
    accountId: string | null;
    accountUsername: string | null;
  }>;
};

type ScheduleView = {
  id: string;
  status: string;
  plannedAt: string;
  postedAt: string | null;
  nextAttemptAt: string | null;
  account: {
    id: string;
    username: string;
    status: string;
  };
  content: {
    id: string;
    title: string;
    topic: string | null;
  };
  variantPreview: string;
  attemptCount: number;
  maxAttempts: number;
  lastError: string | null;
  priority: number;
};

type ActivityView = {
  id: string;
  level: string;
  event: string;
  message: string;
  createdAt: string;
};

type AnalyticsView = {
  totals: {
    posted: number;
    failed: number;
    blocked: number;
    avgEngagementPerPost: number;
  };
  accounts: Array<{
    accountId: string;
    username: string;
    posted: number;
    failed: number;
    blocked: number;
    impressions: number;
    engagement: number;
  }>;
  topTopics: Array<{
    topic: string;
    posted: number;
  }>;
  topHours: Array<{
    hour: number;
    posted: number;
  }>;
};

function toLocalDateTimeValue(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60 * 1000);
  return local.toISOString().slice(0, 16);
}

function parseCsv(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
}

async function readJson<T>(path: string): Promise<T> {
  const response = await fetch(path, {
    cache: "no-store"
  });
  if (!response.ok) {
    let message = `请求失败：${path}`;
    try {
      const payload = (await response.json()) as { message?: string };
      if (payload?.message) {
        message = payload.message;
      }
    } catch {
      // Keep fallback message.
    }
    throw new Error(message);
  }
  const payload = (await response.json()) as T;
  return payload;
}

function accountStatusLabel(status: string): string {
  if (status === "ACTIVE") {
    return "正常";
  }
  if (status === "TOKEN_EXPIRED") {
    return "令牌过期";
  }
  if (status === "RATE_LIMITED") {
    return "限流中";
  }
  if (status === "SUSPENDED") {
    return "已限制";
  }
  if (status === "DISCONNECTED") {
    return "已断开";
  }
  return status;
}

function scheduleStatusLabel(status: string): string {
  if (status === "PENDING") {
    return "待执行";
  }
  if (status === "PROCESSING") {
    return "执行中";
  }
  if (status === "POSTED") {
    return "已发布";
  }
  if (status === "FAILED") {
    return "失败待重试";
  }
  if (status === "BLOCKED") {
    return "已阻断";
  }
  if (status === "CANCELED") {
    return "已取消";
  }
  return status;
}

export function ControlCenter() {
  const [accounts, setAccounts] = useState<AccountView[]>([]);
  const [contents, setContents] = useState<ContentView[]>([]);
  const [schedules, setSchedules] = useState<ScheduleView[]>([]);
  const [activity, setActivity] = useState<ActivityView[]>([]);
  const [analytics, setAnalytics] = useState<AnalyticsView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [accountForm, setAccountForm] = useState({
    xUserId: "",
    username: "",
    displayName: "",
    accessToken: "",
    refreshToken: "",
    tokenExpiresAt: "",
    language: "",
    purpose: "",
    tags: "",
    groups: "",
    minIntervalMinutes: "20",
    dailyPostLimit: "50",
    monthlyPostLimit: "1000",
    proxyEnabled: false,
    proxyProtocol: "http",
    proxyHost: "",
    proxyPort: "8080",
    proxyUsername: "",
    proxyPassword: ""
  });
  const [contentForm, setContentForm] = useState({
    title: "",
    body: "",
    topic: "",
    language: "",
    autoVariants: true
  });
  const [dispatchForm, setDispatchForm] = useState({
    contentId: "",
    mode: "rule" as "rule" | "manual",
    scheduleAt: toLocalDateTimeValue(new Date(Date.now() + 10 * 60 * 1000)),
    staggerMinutes: "20",
    priority: "100"
  });
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);

  const selectedContent = useMemo(
    () => contents.find((item) => item.id === dispatchForm.contentId) ?? null,
    [contents, dispatchForm.contentId]
  );
  const calendarBuckets = useMemo(() => {
    const map = new Map<string, number>();
    schedules.forEach((item) => {
      const key = item.plannedAt.slice(0, 10);
      map.set(key, (map.get(key) ?? 0) + 1);
    });
    return Array.from(map.entries())
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [schedules]);

  const reloadAll = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [accountsRes, contentsRes, schedulesRes, analyticsRes, activityRes] =
        await Promise.all([
          readJson<{ data: AccountView[] }>("/api/accounts"),
          readJson<{ data: ContentView[] }>("/api/contents"),
          readJson<{ data: ScheduleView[] }>("/api/schedules?limit=120"),
          readJson<{ data: AnalyticsView }>("/api/analytics/overview?days=30"),
          readJson<{ data: ActivityView[] }>("/api/activity?limit=80")
        ]);
      setAccounts(accountsRes.data);
      setContents(contentsRes.data);
      setSchedules(schedulesRes.data);
      setAnalytics(analyticsRes.data);
      setActivity(activityRes.data);
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "加载控制台数据失败。"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reloadAll();
  }, [reloadAll]);

  async function submitAccount(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice("");
    setError("");
    try {
      const response = await fetch("/api/accounts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          ...accountForm,
          tagNames: parseCsv(accountForm.tags),
          groupNames: parseCsv(accountForm.groups),
          minIntervalMinutes: Number(accountForm.minIntervalMinutes),
          dailyPostLimit: Number(accountForm.dailyPostLimit),
          monthlyPostLimit: Number(accountForm.monthlyPostLimit),
          proxyEnabled: accountForm.proxyEnabled,
          proxyProtocol: accountForm.proxyProtocol,
          proxyHost: accountForm.proxyHost,
          proxyPort: Number(accountForm.proxyPort),
          proxyUsername: accountForm.proxyUsername,
          proxyPassword: accountForm.proxyPassword || undefined,
          tokenExpiresAt: accountForm.tokenExpiresAt
            ? new Date(accountForm.tokenExpiresAt).toISOString()
            : undefined
        })
      });
      const payload = (await response.json()) as { message?: string };
      if (!response.ok) {
        throw new Error(payload.message ?? "保存账号失败。");
      }
      setNotice("账号已保存。");
      setAccountForm((prev) => ({
        ...prev,
        xUserId: "",
        username: "",
        displayName: "",
        accessToken: "",
        refreshToken: "",
        proxyPassword: ""
      }));
      await reloadAll();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "保存账号失败。");
    }
  }

  async function submitContent(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice("");
    setError("");
    try {
      const response = await fetch("/api/contents", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          title: contentForm.title,
          body: contentForm.body,
          topic: contentForm.topic,
          language: contentForm.language,
          autoVariants: contentForm.autoVariants,
          targetAccountIds: selectedAccountIds
        })
      });
      const payload = (await response.json()) as { message?: string; data?: { id?: string } };
      if (!response.ok) {
        throw new Error(payload.message ?? "保存内容失败。");
      }
      setNotice("内容已保存。");
      setContentForm({
        title: "",
        body: "",
        topic: "",
        language: "",
        autoVariants: true
      });
      if (payload.data?.id) {
        setDispatchForm((prev) => ({
          ...prev,
          contentId: payload.data?.id ?? prev.contentId
        }));
      }
      await reloadAll();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "保存内容失败。");
    }
  }

  async function submitDispatch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice("");
    setError("");
    try {
      const response = await fetch("/api/dispatch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contentId: dispatchForm.contentId,
          mode: dispatchForm.mode,
          accountIds: dispatchForm.mode === "manual" ? selectedAccountIds : undefined,
          scheduleAt: new Date(dispatchForm.scheduleAt).toISOString(),
          staggerMinutes: Number(dispatchForm.staggerMinutes),
          priority: Number(dispatchForm.priority)
        })
      });
      const payload = (await response.json()) as {
        message?: string;
        data?: { created?: number };
      };
      if (!response.ok) {
        throw new Error(payload.message ?? "分发失败。");
      }
      setNotice(`分发完成，已创建 ${payload.data?.created ?? 0} 条排程。`);
      await reloadAll();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "分发失败。");
    }
  }

  async function runPublisherNow() {
    setNotice("");
    setError("");
    try {
      const response = await fetch("/api/cron/publish", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          limit: 40
        })
      });
      const payload = (await response.json()) as {
        message?: string;
        data?: {
          posted?: number;
          failed?: number;
          blocked?: number;
          rescheduled?: number;
        };
      };
      if (!response.ok) {
        throw new Error(payload.message ?? "执行发布任务失败。");
      }
      setNotice(
        `任务完成：发布 ${payload.data?.posted ?? 0}，失败 ${payload.data?.failed ?? 0}，阻断 ${payload.data?.blocked ?? 0}。`
      );
      await reloadAll();
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "执行发布任务失败。");
    }
  }

  function toggleAccountSelection(accountId: string) {
    setSelectedAccountIds((prev) =>
      prev.includes(accountId)
        ? prev.filter((id) => id !== accountId)
        : [...prev, accountId]
    );
  }

  return (
    <main className="cc-page">
      <header className="cc-header">
        <div>
          <h1>AIKOL 运营中枢</h1>
          <p>面向 50-100 个账号的 X 多账号发布与运营控制台。</p>
        </div>
        <div className="cc-actions">
          <button type="button" onClick={() => void reloadAll()}>
            刷新
          </button>
          <button type="button" className="primary" onClick={() => void runPublisherNow()}>
            立即执行发布
          </button>
        </div>
      </header>

      {(error || notice) && (
        <section className="cc-flash">
          {error && <p className="error">{error}</p>}
          {notice && <p className="notice">{notice}</p>}
        </section>
      )}

      {analytics && (
        <section className="cc-cards">
          <article>
            <h3>已发布</h3>
            <p>{analytics.totals.posted}</p>
          </article>
          <article>
            <h3>失败</h3>
            <p>{analytics.totals.failed}</p>
          </article>
          <article>
            <h3>阻断</h3>
            <p>{analytics.totals.blocked}</p>
          </article>
          <article>
            <h3>单帖平均互动</h3>
            <p>{analytics.totals.avgEngagementPerPost}</p>
          </article>
        </section>
      )}

      <section className="cc-grid two">
        <form className="cc-panel" onSubmit={submitAccount}>
          <h2>1）账号管理</h2>
          <p>新增或更新账号凭证、风控阈值、标签与分组。</p>
          <label>
            X 用户 ID
            <input
              required
              value={accountForm.xUserId}
              onChange={(event) =>
                setAccountForm((prev) => ({ ...prev, xUserId: event.target.value }))
              }
            />
          </label>
          <label>
            用户名
            <input
              required
              value={accountForm.username}
              onChange={(event) =>
                setAccountForm((prev) => ({ ...prev, username: event.target.value }))
              }
            />
          </label>
          <label>
            显示名
            <input
              required
              value={accountForm.displayName}
              onChange={(event) =>
                setAccountForm((prev) => ({ ...prev, displayName: event.target.value }))
              }
            />
          </label>
          <label>
            访问令牌（Access Token）
            <input
              required
              value={accountForm.accessToken}
              onChange={(event) =>
                setAccountForm((prev) => ({ ...prev, accessToken: event.target.value }))
              }
            />
          </label>
          <label>
            刷新令牌（Refresh Token）
            <input
              value={accountForm.refreshToken}
              onChange={(event) =>
                setAccountForm((prev) => ({ ...prev, refreshToken: event.target.value }))
              }
            />
          </label>
          <label>
            Token 过期时间
            <input
              type="datetime-local"
              value={accountForm.tokenExpiresAt}
              onChange={(event) =>
                setAccountForm((prev) => ({ ...prev, tokenExpiresAt: event.target.value }))
              }
            />
          </label>
          <div className="cc-inline">
            <label>
              语言
              <input
                value={accountForm.language}
                onChange={(event) =>
                  setAccountForm((prev) => ({ ...prev, language: event.target.value }))
                }
              />
            </label>
            <label>
              用途
              <input
                value={accountForm.purpose}
                onChange={(event) =>
                  setAccountForm((prev) => ({ ...prev, purpose: event.target.value }))
                }
              />
            </label>
          </div>
          <label>
            标签（逗号分隔）
            <input
              value={accountForm.tags}
              onChange={(event) =>
                setAccountForm((prev) => ({ ...prev, tags: event.target.value }))
              }
            />
          </label>
          <label>
            分组（逗号分隔）
            <input
              value={accountForm.groups}
              onChange={(event) =>
                setAccountForm((prev) => ({ ...prev, groups: event.target.value }))
              }
            />
          </label>
          <div className="cc-inline">
            <label>
              最小发布间隔（分钟）
              <input
                type="number"
                min={5}
                value={accountForm.minIntervalMinutes}
                onChange={(event) =>
                  setAccountForm((prev) => ({
                    ...prev,
                    minIntervalMinutes: event.target.value
                  }))
                }
              />
            </label>
            <label>
              日限额
              <input
                type="number"
                min={1}
                value={accountForm.dailyPostLimit}
                onChange={(event) =>
                  setAccountForm((prev) => ({ ...prev, dailyPostLimit: event.target.value }))
                }
              />
            </label>
            <label>
              月限额
              <input
                type="number"
                min={1}
                value={accountForm.monthlyPostLimit}
                onChange={(event) =>
                  setAccountForm((prev) => ({
                    ...prev,
                    monthlyPostLimit: event.target.value
                  }))
                }
              />
            </label>
          </div>
          <label className="cc-checkbox">
            <input
              type="checkbox"
              checked={accountForm.proxyEnabled}
              onChange={(event) =>
                setAccountForm((prev) => ({
                  ...prev,
                  proxyEnabled: event.target.checked
                }))
              }
            />
            启用账号独立代理
          </label>
          {accountForm.proxyEnabled && (
            <>
              <div className="cc-inline">
                <label>
                  代理协议
                  <select
                    value={accountForm.proxyProtocol}
                    onChange={(event) =>
                      setAccountForm((prev) => ({
                        ...prev,
                        proxyProtocol: event.target.value
                      }))
                    }
                  >
                    <option value="http">http</option>
                    <option value="https">https</option>
                  </select>
                </label>
                <label>
                  代理地址
                  <input
                    value={accountForm.proxyHost}
                    onChange={(event) =>
                      setAccountForm((prev) => ({
                        ...prev,
                        proxyHost: event.target.value
                      }))
                    }
                    placeholder="127.0.0.1"
                  />
                </label>
                <label>
                  代理端口
                  <input
                    type="number"
                    min={1}
                    max={65535}
                    value={accountForm.proxyPort}
                    onChange={(event) =>
                      setAccountForm((prev) => ({
                        ...prev,
                        proxyPort: event.target.value
                      }))
                    }
                  />
                </label>
              </div>
              <div className="cc-inline">
                <label>
                  代理用户名
                  <input
                    value={accountForm.proxyUsername}
                    onChange={(event) =>
                      setAccountForm((prev) => ({
                        ...prev,
                        proxyUsername: event.target.value
                      }))
                    }
                  />
                </label>
                <label>
                  代理密码
                  <input
                    type="password"
                    value={accountForm.proxyPassword}
                    onChange={(event) =>
                      setAccountForm((prev) => ({
                        ...prev,
                        proxyPassword: event.target.value
                      }))
                    }
                    placeholder="留空则保持当前密码"
                  />
                </label>
              </div>
            </>
          )}
          <button type="submit" className="primary">
            保存账号
          </button>
        </form>

        <form className="cc-panel" onSubmit={submitContent}>
          <h2>2）内容矩阵</h2>
          <p>创建母稿内容，并按账号自动生成内容变体。</p>
          <label>
            标题
            <input
              required
              value={contentForm.title}
              onChange={(event) =>
                setContentForm((prev) => ({ ...prev, title: event.target.value }))
              }
            />
          </label>
          <label>
            正文
            <textarea
              required
              rows={8}
              value={contentForm.body}
              onChange={(event) =>
                setContentForm((prev) => ({ ...prev, body: event.target.value }))
              }
            />
          </label>
          <div className="cc-inline">
            <label>
              主题
              <input
                value={contentForm.topic}
                onChange={(event) =>
                  setContentForm((prev) => ({ ...prev, topic: event.target.value }))
                }
              />
            </label>
            <label>
              语言
              <input
                value={contentForm.language}
                onChange={(event) =>
                  setContentForm((prev) => ({ ...prev, language: event.target.value }))
                }
              />
            </label>
          </div>
          <label className="cc-checkbox">
            <input
              type="checkbox"
              checked={contentForm.autoVariants}
              onChange={(event) =>
                setContentForm((prev) => ({
                  ...prev,
                  autoVariants: event.target.checked
                }))
              }
            />
            自动生成账号专属文案变体
          </label>
          <button type="submit" className="primary">
            保存内容
          </button>
        </form>
      </section>

      <section className="cc-panel">
        <h2>3）分发与排程</h2>
        <form className="cc-grid three" onSubmit={submitDispatch}>
          <label>
            内容
            <select
              required
              value={dispatchForm.contentId}
              onChange={(event) =>
                setDispatchForm((prev) => ({ ...prev, contentId: event.target.value }))
              }
            >
              <option value="">请选择内容</option>
              {contents.map((content) => (
                <option key={content.id} value={content.id}>
                  {content.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            分发模式
            <select
              value={dispatchForm.mode}
              onChange={(event) =>
                setDispatchForm((prev) => ({
                  ...prev,
                  mode: event.target.value as "rule" | "manual"
                }))
              }
            >
              <option value="rule">规则路由</option>
              <option value="manual">手动选择账号</option>
            </select>
          </label>
          <label>
            开始时间
            <input
              type="datetime-local"
              value={dispatchForm.scheduleAt}
              onChange={(event) =>
                setDispatchForm((prev) => ({ ...prev, scheduleAt: event.target.value }))
              }
            />
          </label>
          <label>
            账号间隔（分钟）
            <input
              type="number"
              min={0}
              value={dispatchForm.staggerMinutes}
              onChange={(event) =>
                setDispatchForm((prev) => ({ ...prev, staggerMinutes: event.target.value }))
              }
            />
          </label>
          <label>
            优先级
            <input
              type="number"
              min={1}
              value={dispatchForm.priority}
              onChange={(event) =>
                setDispatchForm((prev) => ({ ...prev, priority: event.target.value }))
              }
            />
          </label>
          <div className="cc-actions-inline">
            <button type="submit" className="primary" disabled={!dispatchForm.contentId}>
              开始分发
            </button>
          </div>
        </form>
        <p className="cc-muted">
          {dispatchForm.mode === "rule"
            ? "规则路由：按账号标签主题与语言匹配自动分发。"
            : "手动模式：仅分发到勾选账号。"}
        </p>
        {selectedContent && (
          <p className="cc-muted">
            当前内容主题：<strong>{selectedContent.topic || "未标记"}</strong>，语言：
            <strong>{selectedContent.language || "不限"}</strong>
          </p>
        )}
        <div className="cc-account-picker">
          {accounts.map((account) => (
            <label key={account.id} className="cc-checkbox">
              <input
                type="checkbox"
                checked={selectedAccountIds.includes(account.id)}
                onChange={() => toggleAccountSelection(account.id)}
              />
              @{account.username}（{accountStatusLabel(account.status)}）{" "}
              {account.tags.length ? `#${account.tags.join(", #")}` : ""}
            </label>
          ))}
        </div>
      </section>

      <section className="cc-grid two">
        <article className="cc-panel">
          <h2>4）账号列表</h2>
          <div className="cc-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>账号</th>
                  <th>状态</th>
                  <th>标签</th>
                  <th>分组</th>
                  <th>代理</th>
                  <th>排程数</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((account) => (
                  <tr key={account.id}>
                    <td>
                      <strong>@{account.username}</strong>
                      <br />
                      <span>{account.displayName}</span>
                    </td>
                    <td>{accountStatusLabel(account.status)}</td>
                    <td>{account.tags.join(", ") || "-"}</td>
                    <td>{account.groups.join(", ") || "-"}</td>
                    <td>
                      {account.proxy.enabled
                        ? `${account.proxy.protocol}://${account.proxy.host}:${account.proxy.port}`
                        : "-"}
                    </td>
                    <td>{account.scheduleCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <article className="cc-panel">
          <h2>5）数据分析</h2>
          <div className="cc-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>账号</th>
                  <th>已发布</th>
                  <th>失败</th>
                  <th>阻断</th>
                  <th>曝光</th>
                  <th>互动</th>
                </tr>
              </thead>
              <tbody>
                {analytics?.accounts.map((item) => (
                  <tr key={item.accountId}>
                    <td>@{item.username}</td>
                    <td>{item.posted}</td>
                    <td>{item.failed}</td>
                    <td>{item.blocked}</td>
                    <td>{item.impressions}</td>
                    <td>{item.engagement}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3>主题排行</h3>
          <ul className="cc-list">
            {analytics?.topTopics.map((item) => (
              <li key={item.topic}>
                {item.topic}: {item.posted}
              </li>
            ))}
          </ul>
          <h3>发布时间段排行</h3>
          <ul className="cc-list">
            {analytics?.topHours.map((item) => (
              <li key={item.hour}>
                {item.hour}:00 - {item.posted} 条
              </li>
            ))}
          </ul>
        </article>
      </section>

      <section className="cc-grid two">
        <article className="cc-panel">
          <h2>排程列表</h2>
          <h3>日历汇总</h3>
          <ul className="cc-list">
            {calendarBuckets.map((bucket) => (
              <li key={bucket.date}>
                {bucket.date}：{bucket.count} 条排程
              </li>
            ))}
          </ul>
          <div className="cc-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>计划时间</th>
                  <th>状态</th>
                  <th>账号</th>
                  <th>内容</th>
                  <th>尝试次数</th>
                </tr>
              </thead>
              <tbody>
                {schedules.map((row) => (
                  <tr key={row.id}>
                    <td>{new Date(row.plannedAt).toLocaleString()}</td>
                    <td>{scheduleStatusLabel(row.status)}</td>
                    <td>@{row.account.username}</td>
                    <td>{row.content.title}</td>
                    <td>
                      {row.attemptCount}/{row.maxAttempts}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <article className="cc-panel">
          <h2>活动日志</h2>
          <ul className="cc-activity">
            {activity.map((item) => (
              <li key={item.id}>
                <span>{new Date(item.createdAt).toLocaleString()}</span>
                <strong>{item.event}</strong>
                <p>{item.message}</p>
              </li>
            ))}
          </ul>
        </article>
      </section>

      {loading && <p className="cc-muted">加载中...</p>}
    </main>
  );
}
