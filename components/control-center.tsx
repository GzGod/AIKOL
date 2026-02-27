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
    let message = `Request failed: ${path}`;
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
        requestError instanceof Error ? requestError.message : "Failed to load dashboard data."
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
        throw new Error(payload.message ?? "Failed to create account.");
      }
      setNotice("Account saved.");
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
      setError(submitError instanceof Error ? submitError.message : "Failed to create account.");
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
        throw new Error(payload.message ?? "Failed to create content.");
      }
      setNotice("Content saved.");
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
      setError(submitError instanceof Error ? submitError.message : "Failed to create content.");
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
        throw new Error(payload.message ?? "Failed to dispatch content.");
      }
      setNotice(`Dispatch created ${payload.data?.created ?? 0} schedules.`);
      await reloadAll();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to dispatch content.");
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
        throw new Error(payload.message ?? "Failed to run publisher.");
      }
      setNotice(
        `Publisher run done: posted ${payload.data?.posted ?? 0}, failed ${payload.data?.failed ?? 0}, blocked ${payload.data?.blocked ?? 0}.`
      );
      await reloadAll();
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "Failed to run publisher.");
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
          <h1>AIKOL Operations Hub</h1>
          <p>Multi-account X publishing control center for 50-100 account operations.</p>
        </div>
        <div className="cc-actions">
          <button type="button" onClick={() => void reloadAll()}>
            Refresh
          </button>
          <button type="button" className="primary" onClick={() => void runPublisherNow()}>
            Run Publisher
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
            <h3>Posted</h3>
            <p>{analytics.totals.posted}</p>
          </article>
          <article>
            <h3>Failed</h3>
            <p>{analytics.totals.failed}</p>
          </article>
          <article>
            <h3>Blocked</h3>
            <p>{analytics.totals.blocked}</p>
          </article>
          <article>
            <h3>Avg Engagement/Post</h3>
            <p>{analytics.totals.avgEngagementPerPost}</p>
          </article>
        </section>
      )}

      <section className="cc-grid two">
        <form className="cc-panel" onSubmit={submitAccount}>
          <h2>1) Account Management</h2>
          <p>Add or update account credentials, policy limits, and routing tags/groups.</p>
          <label>
            X User ID
            <input
              required
              value={accountForm.xUserId}
              onChange={(event) =>
                setAccountForm((prev) => ({ ...prev, xUserId: event.target.value }))
              }
            />
          </label>
          <label>
            Username
            <input
              required
              value={accountForm.username}
              onChange={(event) =>
                setAccountForm((prev) => ({ ...prev, username: event.target.value }))
              }
            />
          </label>
          <label>
            Display Name
            <input
              required
              value={accountForm.displayName}
              onChange={(event) =>
                setAccountForm((prev) => ({ ...prev, displayName: event.target.value }))
              }
            />
          </label>
          <label>
            Access Token
            <input
              required
              value={accountForm.accessToken}
              onChange={(event) =>
                setAccountForm((prev) => ({ ...prev, accessToken: event.target.value }))
              }
            />
          </label>
          <label>
            Refresh Token
            <input
              value={accountForm.refreshToken}
              onChange={(event) =>
                setAccountForm((prev) => ({ ...prev, refreshToken: event.target.value }))
              }
            />
          </label>
          <label>
            Token Expires At
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
              Language
              <input
                value={accountForm.language}
                onChange={(event) =>
                  setAccountForm((prev) => ({ ...prev, language: event.target.value }))
                }
              />
            </label>
            <label>
              Purpose
              <input
                value={accountForm.purpose}
                onChange={(event) =>
                  setAccountForm((prev) => ({ ...prev, purpose: event.target.value }))
                }
              />
            </label>
          </div>
          <label>
            Tags (comma separated)
            <input
              value={accountForm.tags}
              onChange={(event) =>
                setAccountForm((prev) => ({ ...prev, tags: event.target.value }))
              }
            />
          </label>
          <label>
            Groups (comma separated)
            <input
              value={accountForm.groups}
              onChange={(event) =>
                setAccountForm((prev) => ({ ...prev, groups: event.target.value }))
              }
            />
          </label>
          <div className="cc-inline">
            <label>
              Min Interval (minutes)
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
              Daily Limit
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
              Monthly Limit
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
            Enable per-account proxy
          </label>
          {accountForm.proxyEnabled && (
            <>
              <div className="cc-inline">
                <label>
                  Proxy Protocol
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
                  Proxy Host
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
                  Proxy Port
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
                  Proxy Username
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
                  Proxy Password
                  <input
                    type="password"
                    value={accountForm.proxyPassword}
                    onChange={(event) =>
                      setAccountForm((prev) => ({
                        ...prev,
                        proxyPassword: event.target.value
                      }))
                    }
                    placeholder="leave empty to keep current"
                  />
                </label>
              </div>
            </>
          )}
          <button type="submit" className="primary">
            Save Account
          </button>
        </form>

        <form className="cc-panel" onSubmit={submitContent}>
          <h2>2) Content Matrix</h2>
          <p>Create source content and optionally auto-generate per-account variants.</p>
          <label>
            Title
            <input
              required
              value={contentForm.title}
              onChange={(event) =>
                setContentForm((prev) => ({ ...prev, title: event.target.value }))
              }
            />
          </label>
          <label>
            Body
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
              Topic
              <input
                value={contentForm.topic}
                onChange={(event) =>
                  setContentForm((prev) => ({ ...prev, topic: event.target.value }))
                }
              />
            </label>
            <label>
              Language
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
            Auto-generate account-specific variants
          </label>
          <button type="submit" className="primary">
            Save Content
          </button>
        </form>
      </section>

      <section className="cc-panel">
        <h2>3) Dispatch & Scheduling</h2>
        <form className="cc-grid three" onSubmit={submitDispatch}>
          <label>
            Content
            <select
              required
              value={dispatchForm.contentId}
              onChange={(event) =>
                setDispatchForm((prev) => ({ ...prev, contentId: event.target.value }))
              }
            >
              <option value="">Select content</option>
              {contents.map((content) => (
                <option key={content.id} value={content.id}>
                  {content.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            Mode
            <select
              value={dispatchForm.mode}
              onChange={(event) =>
                setDispatchForm((prev) => ({
                  ...prev,
                  mode: event.target.value as "rule" | "manual"
                }))
              }
            >
              <option value="rule">Rule-based routing</option>
              <option value="manual">Manual account selection</option>
            </select>
          </label>
          <label>
            Start At
            <input
              type="datetime-local"
              value={dispatchForm.scheduleAt}
              onChange={(event) =>
                setDispatchForm((prev) => ({ ...prev, scheduleAt: event.target.value }))
              }
            />
          </label>
          <label>
            Stagger Minutes
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
            Priority
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
              Dispatch
            </button>
          </div>
        </form>
        <p className="cc-muted">
          {dispatchForm.mode === "rule"
            ? "Rule mode routes by topic tags and language matching."
            : "Manual mode dispatches only to checked accounts."}
        </p>
        {selectedContent && (
          <p className="cc-muted">
            Selected content topic: <strong>{selectedContent.topic || "untagged"}</strong>, language:{" "}
            <strong>{selectedContent.language || "any"}</strong>
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
              @{account.username} ({account.status}) {account.tags.length ? `#${account.tags.join(", #")}` : ""}
            </label>
          ))}
        </div>
      </section>

      <section className="cc-grid two">
        <article className="cc-panel">
          <h2>4) Accounts</h2>
          <div className="cc-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Status</th>
                  <th>Tags</th>
                  <th>Groups</th>
                  <th>Proxy</th>
                  <th>Schedules</th>
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
                    <td>{account.status}</td>
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
          <h2>5) Analytics</h2>
          <div className="cc-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Posted</th>
                  <th>Failed</th>
                  <th>Blocked</th>
                  <th>Impressions</th>
                  <th>Engagement</th>
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
          <h3>Top Topics</h3>
          <ul className="cc-list">
            {analytics?.topTopics.map((item) => (
              <li key={item.topic}>
                {item.topic}: {item.posted}
              </li>
            ))}
          </ul>
          <h3>Top Hours</h3>
          <ul className="cc-list">
            {analytics?.topHours.map((item) => (
              <li key={item.hour}>
                {item.hour}:00 - {item.posted} posts
              </li>
            ))}
          </ul>
        </article>
      </section>

      <section className="cc-grid two">
        <article className="cc-panel">
          <h2>Schedules</h2>
          <h3>Calendar</h3>
          <ul className="cc-list">
            {calendarBuckets.map((bucket) => (
              <li key={bucket.date}>
                {bucket.date}: {bucket.count} scheduled
              </li>
            ))}
          </ul>
          <div className="cc-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Planned</th>
                  <th>Status</th>
                  <th>Account</th>
                  <th>Content</th>
                  <th>Attempt</th>
                </tr>
              </thead>
              <tbody>
                {schedules.map((row) => (
                  <tr key={row.id}>
                    <td>{new Date(row.plannedAt).toLocaleString()}</td>
                    <td>{row.status}</td>
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
          <h2>Activity</h2>
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

      {loading && <p className="cc-muted">Loading...</p>}
    </main>
  );
}
