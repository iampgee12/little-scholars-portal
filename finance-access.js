// Accountant / Bursary Officer access. These staff sign in to the admin
// portal (users.role = 'admin', staff_type = 'accountant') but only get:
//   - the whole Finance menu (fees, income & expenses, payroll, store, accounting),
//     except unlocking a locked accounting period;
//   - People (students, parents, families, staff) to look at, never to change;
//   - their own account (name, email, password).
// Academics, E-Class, Results, CBT, Attendance and the Admin menu are refused here,
// on the server, so a hidden menu can never be reached by typing its address.

const FINANCE_PREFIX = /^\/api\/admin\/(fees|finance|payroll|store|acct)(\/|$)/;

// Admin endpoints an accountant may read (GET only)
const READ_ONLY = [
  /^\/api\/admin\/result-setup$/, // classes, arms, pupils and staff lists (trimmed for them)
  /^\/api\/admin\/academic-sessions$/,
  /^\/api\/admin\/grade-scale$/, // read by the portal at start-up (grade bands only, no scores)
  /^\/api\/admin\/enrol\/meta$/,
  /^\/api\/admin\/registry$/,
  /^\/api\/admin\/students\/enrollment-history$/,
  /^\/api\/admin\/students\/by-class$/,
  /^\/api\/admin\/students\/by-status$/,
  /^\/api\/admin\/student-tags$/,
  /^\/api\/admin\/parents\/(list|search)$/,
  /^\/api\/admin\/families(\/list|\/\d+)?$/,
  /^\/api\/admin\/view-students$/, // the student list
  /^\/api\/admin\/view-students\/profile$/,
  /^\/api\/admin\/staff-designations$/,
  /^\/api\/admin\/staff\/export\.xlsx$/,
  /^\/api\/admin\/finance-home$/,
];

// Their own account, whatever the method; signing in (as anyone) is never refused
const OWN_ACCOUNT = [/^\/api\/session$/, /^\/api\/logout$/, /^\/api\/login(\/(code|change|resend))?$/, /^\/api\/account$/, /^\/api\/account\/(password|profile)$/];

function isFinanceUser(user) {
  return !!user && user.role === 'admin' && (user.staff_type || user.staffType) === 'accountant';
}

function financeAllowed(method, path) {
  if (OWN_ACCOUNT.some(re => re.test(path))) return true;
  if (FINANCE_PREFIX.test(path)) return !(method === 'POST' && path === '/api/admin/acct/periods/unlock');
  if (method === 'GET' || method === 'HEAD') return READ_ONLY.some(re => re.test(path));
  return false;
}

// Called first for every /api request. Returns true when it has refused the request.
function refuseIfOutOfScope(user, req, res, url, sendJson) {
  if (!isFinanceUser(user) || financeAllowed(req.method, url.pathname)) return false;
  sendJson(res, 403, { error: 'Your account (Accountant / Bursary) does not have access to this.' });
  return true;
}

// The admin setup data without any academic records: no subjects, scores,
// averages, result publications or head-teacher settings.
function trimSetupForFinance(payload) {
  return {
    ...payload,
    classSubjects: [], subjects: [], subjectTypes: [], classTeacherSubjects: [], assignments: [], resultBatches: [],
    publications: [], publishedResults: [], examTypes: payload.examTypes,
    settings: { headOfSchoolName: '', headSignaturePath: '', watermarkPath: '', watermarkMode: '', nextTermBegins: '' },
    students: (payload.students || []).map(s => ({ ...s, avg: null, att: null })),
  };
}

// Pupil card for an accountant: contact and family details, but no health or
// identity notes and no results.
function trimPupilProfileForFinance(data) {
  const { bloodGroup, genotype, nin, bio, ...student } = data.student || {};
  return { ...data, student, results: [] };
}

module.exports = { isFinanceUser, financeAllowed, refuseIfOutOfScope, trimSetupForFinance, trimPupilProfileForFinance };
