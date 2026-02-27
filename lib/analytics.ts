import { ScheduleStatus } from "@prisma/client";
import { db } from "@/lib/db";

export type AnalyticsOverview = {
  windowDays: number;
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

function toHour(date: Date | null): number | null {
  if (!date) {
    return null;
  }
  return date.getHours();
}

export async function buildAnalyticsOverview(windowDays = 30): Promise<AnalyticsOverview> {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  const [schedules, metrics] = await Promise.all([
    db.schedule.findMany({
      where: {
        createdAt: {
          gte: since
        }
      },
      include: {
        account: true,
        content: true
      }
    }),
    db.postMetric.findMany({
      where: {
        collectedAt: {
          gte: since
        }
      }
    })
  ]);

  const metricBySchedule = new Map(metrics.map((item) => [item.scheduleId, item]));
  const accountMap = new Map<
    string,
    {
      accountId: string;
      username: string;
      posted: number;
      failed: number;
      blocked: number;
      impressions: number;
      engagement: number;
    }
  >();
  const topicMap = new Map<string, number>();
  const hourMap = new Map<number, number>();

  let posted = 0;
  let failed = 0;
  let blocked = 0;
  let totalEngagement = 0;

  for (const row of schedules) {
    const item =
      accountMap.get(row.accountId) ??
      {
        accountId: row.accountId,
        username: row.account.username,
        posted: 0,
        failed: 0,
        blocked: 0,
        impressions: 0,
        engagement: 0
      };

    if (row.status === ScheduleStatus.POSTED) {
      posted += 1;
      item.posted += 1;
      const metric = metricBySchedule.get(row.id);
      if (metric) {
        item.impressions += metric.impressions;
        const engagement =
          metric.likes + metric.reposts + metric.replies + metric.bookmarks;
        item.engagement += engagement;
        totalEngagement += engagement;
      }

      const topic = row.content.topic?.trim() || "untagged";
      topicMap.set(topic, (topicMap.get(topic) ?? 0) + 1);

      const hour = toHour(row.postedAt);
      if (hour !== null) {
        hourMap.set(hour, (hourMap.get(hour) ?? 0) + 1);
      }
    } else if (row.status === ScheduleStatus.FAILED) {
      failed += 1;
      item.failed += 1;
    } else if (row.status === ScheduleStatus.BLOCKED) {
      blocked += 1;
      item.blocked += 1;
    }

    accountMap.set(row.accountId, item);
  }

  const accounts = Array.from(accountMap.values()).sort((a, b) => b.posted - a.posted);
  const topTopics = Array.from(topicMap.entries())
    .map(([topic, count]) => ({
      topic,
      posted: count
    }))
    .sort((a, b) => b.posted - a.posted)
    .slice(0, 8);
  const topHours = Array.from(hourMap.entries())
    .map(([hour, count]) => ({
      hour,
      posted: count
    }))
    .sort((a, b) => b.posted - a.posted)
    .slice(0, 8);

  return {
    windowDays,
    totals: {
      posted,
      failed,
      blocked,
      avgEngagementPerPost: posted > 0 ? Number((totalEngagement / posted).toFixed(2)) : 0
    },
    accounts,
    topTopics,
    topHours
  };
}
