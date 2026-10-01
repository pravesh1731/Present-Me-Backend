// Read-only aggregates for the super admin panel (dashboard + global teacher/student lists).
//
// Every table is read in ONE paged scan and the result is cached for a short time, so a busy
// dashboard does not turn into a DynamoDB scan per request. Concurrent requests share the same
// in-flight scan, and if a refresh fails the last good data is served instead of an error.
const { ScanCommand, GetCommand } = require("@aws-sdk/lib-dynamodb");
const { docClient } = require("../config/dynamodb");
const { stripSensitive } = require("../utils/sanitize");

const TTL_MS = 60 * 1000;
const cache = new Map(); // key -> { at, data, pending }

async function cached(key, loader, { force = false } = {}) {
  const entry = cache.get(key) || { at: 0, data: null, pending: null };
  cache.set(key, entry);

  if (!force && entry.data && Date.now() - entry.at < TTL_MS) return entry.data;

  entry.pending = entry.pending || loader().finally(() => (entry.pending = null));

  try {
    entry.data = await entry.pending;
    entry.at = Date.now();
    return entry.data;
  } catch (err) {
    if (entry.data) return entry.data; // stale beats nothing
    throw err;
  }
}

// Scan a whole table, following LastEvaluatedKey. `attributes` limits what is read back.
async function scanAll(TableName, attributes) {
  const items = [];
  let ExclusiveStartKey;

  const projection = attributes
    ? {
        ProjectionExpression: attributes.map((_, i) => `#a${i}`).join(","),
        ExpressionAttributeNames: Object.fromEntries(
          attributes.map((name, i) => [`#a${i}`, name])
        ),
      }
    : {};

  do {
    const res = await docClient.send(
      new ScanCommand({ TableName, ExclusiveStartKey, ...projection })
    );
    items.push(...(res.Items || []));
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  return items;
}

const timeOf = (iso) => {
  const time = new Date(iso || 0).getTime();
  return Number.isNaN(time) ? 0 : time;
};
const newest = (field) => (a, b) => timeOf(b[field]) - timeOf(a[field]);
const lower = (value) => String(value || "").toLowerCase();

// "2026-10" for the last `count` months, oldest first (UTC)
function lastMonths(count) {
  const months = [];
  const now = new Date();
  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    months.push(d.toISOString().slice(0, 7));
  }
  return months;
}

const oldest = (items, field) =>
  items.length
    ? items.reduce((min, item) => (timeOf(item[field]) < timeOf(min[field]) ? item : min))[field] ||
      null
    : null;

async function lookupUserName(role, userId) {
  if (!userId || !["student", "teacher"].includes(role)) return null;
  const res = await docClient.send(
    new GetCommand({
      TableName: role === "student" ? "students" : "teachers",
      Key: { [role === "student" ? "studentId" : "teacherId"]: userId },
    })
  );
  const user = res.Item;
  return user ? `${user.firstName || ""} ${user.lastName || ""}`.trim() || null : null;
}

async function computeOverview() {
  const [institutions, notes, withdrawals, teachers, students] = await Promise.all([
    scanAll("Institutions", [
      "institutionId",
      "InstitutionName",
      "status",
      "createdAt",
      "expectedStudents",
      "expectedTeachers",
    ]),
    scanAll("notes", [
      "noteId",
      "fileName",
      "type",
      "status",
      "createdAt",
      "downloads",
      "rewardAmount",
      "institutionId",
    ]),
    scanAll("withdrawal", [
      "withdrawalId",
      "status",
      "amount",
      "userRole",
      "userId",
      "institutionId",
      "requestedAt",
      "createdAt",
    ]),
    scanAll("teachers", [
      "teacherId",
      "firstName",
      "lastName",
      "emailId",
      "status",
      "createdAt",
      "institutionId",
    ]),
    scanAll("students", [
      "studentId",
      "firstName",
      "lastName",
      "emailId",
      "rollNo",
      "semester",
      "createdAt",
      "emailVerified",
      "institutionId",
    ]),
  ]);

  const names = Object.fromEntries(
    institutions.map((i) => [i.institutionId, i.InstitutionName])
  );

  // ---- institutions ----
  const inst = { pending: 0, verified: 0, rejected: 0, total: institutions.length, expectedStudents: 0, expectedTeachers: 0 };
  institutions.forEach((item) => {
    const state = lower(item.status);
    if (state === "verified") {
      inst.verified += 1;
      inst.expectedStudents += Number(item.expectedStudents) || 0;
      inst.expectedTeachers += Number(item.expectedTeachers) || 0;
    } else if (state === "rejected") inst.rejected += 1;
    else inst.pending += 1;
  });
  const pendingInstitutions = institutions.filter((i) => !["verified", "rejected"].includes(lower(i.status)));
  inst.oldestPendingAt = oldest(pendingInstitutions, "createdAt");

  // ---- notes / PYQs ----
  const noteStats = { pending: 0, approved: 0, rejected: 0, total: notes.length, pyq: 0, notes: 0, downloads: 0, rewardsPaid: 0 };
  notes.forEach((item) => {
    const state = lower(item.status);
    if (state === "approved" || state === "verified") noteStats.approved += 1;
    else if (state === "rejected") noteStats.rejected += 1;
    else noteStats.pending += 1;
    if (item.type === "PYQ") noteStats.pyq += 1;
    else noteStats.notes += 1;
    noteStats.downloads += Number(item.downloads) || 0;
    noteStats.rewardsPaid += Number(item.rewardAmount) || 0;
  });
  noteStats.oldestPendingAt = oldest(
    notes.filter((n) => !["approved", "verified", "rejected"].includes(lower(n.status))),
    "createdAt"
  );

  // ---- withdrawals ----
  const wd = {
    pending: 0, processing: 0, paid: 0, rejected: 0, failed: 0, total: withdrawals.length,
    pendingAmount: 0, processingAmount: 0, paidAmount: 0,
  };
  withdrawals.forEach((item) => {
    const amount = Number(item.amount) || 0;
    switch (item.status) {
      case "PENDING": wd.pending += 1; wd.pendingAmount += amount; break;
      case "PROCESSING": wd.processing += 1; wd.processingAmount += amount; break;
      case "PAID": wd.paid += 1; wd.paidAmount += amount; break;
      case "REJECTED": wd.rejected += 1; break;
      case "FAILED": wd.failed += 1; break;
      default: break;
    }
  });
  const whenRequested = (w) => w.requestedAt || w.createdAt;
  wd.oldestPendingAt = withdrawals
    .filter((w) => w.status === "PENDING")
    .map(whenRequested)
    .sort((a, b) => timeOf(a) - timeOf(b))[0] || null;

  // ---- people ----
  const teacherStats = { total: teachers.length, verified: 0, pending: 0, rejected: 0 };
  teachers.forEach((item) => {
    const state = lower(item.status);
    if (state === "verified" || state === "approved") teacherStats.verified += 1;
    else if (state === "rejected") teacherStats.rejected += 1;
    else teacherStats.pending += 1;
  });
  const studentStats = {
    total: students.length,
    emailVerified: students.filter((s) => s.emailVerified === true).length,
  };

  // ---- sign-ups per month (last 6) ----
  const months = lastMonths(6);
  const signups = months.map((month) => ({ month, institutions: 0, teachers: 0, students: 0 }));
  const bump = (items, key) =>
    items.forEach((item) => {
      const slot = signups.find((s) => s.month === String(item.createdAt || "").slice(0, 7));
      if (slot) slot[key] += 1;
    });
  bump(institutions, "institutions");
  bump(teachers, "teachers");
  bump(students, "students");

  // ---- latest activity ----
  const recentWithdrawals = [...withdrawals]
    .sort((a, b) => timeOf(whenRequested(b)) - timeOf(whenRequested(a)))
    .slice(0, 5);
  const withdrawalNames = await Promise.all(
    recentWithdrawals.map((w) => lookupUserName(w.userRole, w.userId).catch(() => null))
  );

  return {
    institutions: inst,
    notes: noteStats,
    withdrawals: wd,
    teachers: teacherStats,
    students: studentStats,
    signups,
    recent: {
      institutions: [...institutions]
        .sort(newest("createdAt"))
        .slice(0, 5)
        .map(({ institutionId, InstitutionName, status, createdAt }) => ({
          institutionId, InstitutionName, status, createdAt,
        })),
      notes: [...notes]
        .sort(newest("createdAt"))
        .slice(0, 5)
        .map(({ noteId, fileName, type, status, createdAt, institutionId }) => ({
          noteId, fileName, type, status, createdAt, institutionId,
          institutionName: names[institutionId] || null,
        })),
      // newest sign-ups ("recently joined"); only display fields, never credentials
      teachers: [...teachers]
        .sort(newest("createdAt"))
        .slice(0, 8)
        .map((t) => ({
          teacherId: t.teacherId,
          firstName: t.firstName,
          lastName: t.lastName,
          emailId: t.emailId,
          status: t.status,
          createdAt: t.createdAt,
          institutionId: t.institutionId,
          institutionName: names[t.institutionId] || null,
        })),
      students: [...students]
        .sort(newest("createdAt"))
        .slice(0, 8)
        .map((st) => ({
          studentId: st.studentId,
          firstName: st.firstName,
          lastName: st.lastName,
          emailId: st.emailId,
          rollNo: st.rollNo,
          semester: st.semester,
          emailVerified: st.emailVerified === true,
          createdAt: st.createdAt,
          institutionId: st.institutionId,
          institutionName: names[st.institutionId] || null,
        })),
      withdrawals: recentWithdrawals.map((w, i) => ({
        withdrawalId: w.withdrawalId,
        amount: Number(w.amount) || 0,
        status: w.status,
        userRole: w.userRole,
        userName: withdrawalNames[i],
        requestedAt: whenRequested(w),
        institutionId: w.institutionId,
        institutionName: names[w.institutionId] || null,
      })),
    },
    updatedAt: new Date().toISOString(),
  };
}

const getOverview = (options) => cached("overview", computeOverview, options);

// ---------------------------------------------------------------------------
// Global teacher / student lists (all institutes)
// ---------------------------------------------------------------------------

const getInstitutionNames = () =>
  cached("institutionNames", async () => {
    const rows = await scanAll("Institutions", ["institutionId", "InstitutionName"]);
    return Object.fromEntries(rows.map((r) => [r.institutionId, r.InstitutionName]));
  });

async function loadPeople(table) {
  const [rows, names] = await Promise.all([scanAll(table), getInstitutionNames()]);
  return rows.map((row) => ({
    ...stripSensitive(row),
    institutionName: names[row.institutionId] || "Unknown institution",
  }));
}

const getAllTeachers = (options) => cached("teachers", () => loadPeople("teachers"), options);
const getAllStudents = (options) => cached("students", () => loadPeople("students"), options);

const fullName = (p) => `${p.firstName || ""} ${p.lastName || ""}`.trim();

const sorters = {
  newest: newest("createdAt"),
  oldest: (a, b) => timeOf(a.createdAt) - timeOf(b.createdAt),
  name: (a, b) => fullName(a).localeCompare(fullName(b)),
};

// Filter + sort + paginate an in-memory list. `summarise` runs on the rows that match every
// filter EXCEPT the status-like one, so the UI can show per-status counts next to its tabs.
function queryPeople(all, query, { searchFields, matchesStatus, summarise }) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(query.pageSize, 10) || 25));
  const term = lower(query.search).trim();

  const scoped = all.filter((row) => {
    if (query.institutionId && row.institutionId !== query.institutionId) return false;
    if (!term) return true;
    return searchFields.map((f) => (typeof f === "function" ? f(row) : row[f])).join(" ").toLowerCase().includes(term);
  });

  const filtered = scoped.filter((row) => matchesStatus(row, query));
  const sort = sorters[query.sort] || sorters.newest;
  const sorted = [...filtered].sort(sort);

  const total = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);

  return {
    page: safePage,
    pageSize,
    total,
    totalPages,
    summary: summarise(scoped),
    data: sorted.slice((safePage - 1) * pageSize, safePage * pageSize),
  };
}

const teacherState = (t) => {
  const state = lower(t.status);
  return state === "approved" ? "verified" : state === "verified" || state === "rejected" ? state : "pending";
};

function queryTeachers(all, query) {
  return queryPeople(all, query, {
    searchFields: [fullName, "emailId", "phone", "hotspotName", "institutionName"],
    matchesStatus: (row, q) => !q.status || q.status === "all" || teacherState(row) === lower(q.status),
    summarise: (rows) => ({
      all: rows.length,
      verified: rows.filter((r) => teacherState(r) === "verified").length,
      pending: rows.filter((r) => teacherState(r) === "pending").length,
      rejected: rows.filter((r) => teacherState(r) === "rejected").length,
    }),
  });
}

function queryStudents(all, query) {
  return queryPeople(all, query, {
    searchFields: [fullName, "emailId", "phone", "rollNo", "institutionName"],
    matchesStatus: (row, q) =>
      !q.verified || q.verified === "all" ||
      (q.verified === "verified" ? row.emailVerified === true : row.emailVerified !== true),
    summarise: (rows) => ({
      all: rows.length,
      verified: rows.filter((r) => r.emailVerified === true).length,
      unverified: rows.filter((r) => r.emailVerified !== true).length,
    }),
  });
}

module.exports = {
  getOverview,
  getAllTeachers,
  getAllStudents,
  queryTeachers,
  queryStudents,
};
