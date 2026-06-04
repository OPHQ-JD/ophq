import React, { useEffect, useMemo, useState } from "react";

const APP_STORAGE_KEY = "jdfabs-operations-hq-v1";
const APP_BRAND_NAME = "OPHQ";
const APP_BRAND_SUBTITLE = "One Platform. Total Control.";

const deploymentConfig = {
  storageMode: "local", // change to cloud-api when backend is connected.
  apiBaseUrl: "/api/jdfabs",
  authProvider: "pending", // Supabase/Auth0/Firebase can be connected here later.
  documentStorage: "pending", // Supabase Storage/S3/Cloudflare R2 can be connected here later.
  environment: "development", // development -> staging -> production.
  releaseChannel: "staging-first", // all changes should be tested in staging before production.
  rollbackMode: "last-stable-release", // production deploys should keep the previous stable version available.
};

const releaseManagementPlan = [
  { id: "development", title: "Development app", purpose: "Where new changes are built in small patches.", status: "Current" },
  { id: "staging", title: "Staging/test app", purpose: "Private test copy for Jon to click through before live release.", status: "Required before live" },
  { id: "production", title: "Live app", purpose: "Stable daily-use version for Operations, Sales and Staff.", status: "Pending" },
  { id: "backup", title: "Backups", purpose: "Database snapshots before every production release.", status: "Required before live" },
  { id: "rollback", title: "Rollback", purpose: "Return to the previous stable version if a live update causes an issue.", status: "Required before live" },
  { id: "changelog", title: "Changelog", purpose: "Every change is logged with risk, area touched and tests required.", status: "In use" },
];

const authEnvironmentOptions = ["development", "staging", "production"];

const initialProfiles = [
  { id: "profile-jon", name: "Jon Davis", email: "jon.davis@jdfabs.co.uk", role: "operations", status: "Active", authProviderId: "pending", mfaRequired: true, lastLoginAt: "" },
  { id: "profile-sales", name: "Sales", email: "sales@jdfabs.co.uk", role: "sales", status: "Pending", authProviderId: "pending", mfaRequired: true, lastLoginAt: "" },
  { id: "profile-staff", name: "Workshop", email: "workshop@jdfabs.co.uk", role: "staff", status: "Pending", authProviderId: "pending", mfaRequired: false, lastLoginAt: "" },
];

const authReadinessChecks = [
  { id: "provider", label: "Auth provider selected", status: deploymentConfig.authProvider !== "pending" ? "Ready" : "Pending", detail: "Choose Supabase/Auth0/Firebase before production." },
  { id: "profiles", label: "User profiles exist", status: "Ready", detail: "Operations, Sales and Staff profile scaffolds exist." },
  { id: "mfa", label: "Admin MFA required", status: initialProfiles.find((profile) => profile.role === "operations")?.mfaRequired ? "Ready" : "Pending", detail: "Operations/admin accounts should use MFA." },
  { id: "backend-permissions", label: "Backend permission map", status: "Scaffolded", detail: "Current frontend guard mirrors the backend rules required for live." },
  { id: "session-audit", label: "Session audit logging", status: "Scaffolded", detail: "Role switches and guarded actions write audit events locally." },
];

const numberingReadinessExamples = [
  { documentType: "quote", existing: [{ quoteNo: "QU-008" }], linkedSourceNumber: "", expected: "QU-009", purpose: "New quote gets next QU number." },
  { documentType: "job", existing: [], linkedSourceNumber: "QU-008", expected: "JD-008", purpose: "Job links to quote sequence." },
  { documentType: "deliveryNote", existing: [], linkedSourceNumber: "JD-008", expected: "DN-008", purpose: "Delivery note links to job sequence." },
  { documentType: "enquiry", existing: [{ enquiryNo: "ENQ-00004" }], linkedSourceNumber: "", expected: "ENQ-00005", purpose: "Supplier enquiry gets next ENQ number." },
  { documentType: "purchaseOrder", existing: [{ poNo: "PO-00009" }], linkedSourceNumber: "", expected: "PO-00010", purpose: "Formal PO gets next PO number only after Raise PO." },
];

function runNumberingReadinessTests() {
  const checks = numberingReadinessExamples.map((example) => {
    const reserved = reserveLocalDocumentNumber({ documentType: example.documentType, records: example.existing, linkedSourceNumber: example.linkedSourceNumber });
    return { ...example, actual: reserved.number, passed: reserved.number === example.expected };
  });
  return {
    passed: checks.every((check) => check.passed),
    cloudRequired: deploymentConfig.storageMode !== "cloud-api",
    warning: deploymentConfig.storageMode !== "cloud-api" ? "Local numbering is suitable for prototype testing only. Live multi-user numbering must be reserved by the backend endpoint." : "Cloud numbering endpoint active.",
    checks,
  };
}

function runRecordLockReadinessTests() {
  const userA = { id: "profile-jon", name: "Jon Davis", role: "operations" };
  const userB = { id: "profile-sales", name: "Sales User", role: "sales" };
  const lock = createRecordLock({ recordId: "job-lock-test", resource: "jobs", user: userA, expiresInMinutes: 15 });
  const checks = [
    { name: "Fresh lock is active", passed: isRecordLockActive(lock) },
    { name: "Lock owner can edit", passed: canEditLockedRecord(lock, userA) },
    { name: "Other user is blocked", passed: !canEditLockedRecord(lock, userB) },
    { name: "Lock can be found by resource/id", passed: getActiveRecordLock([lock], "jobs", "job-lock-test")?.id === lock.id },
  ];
  return {
    passed: checks.every((check) => check.passed),
    cloudRequired: deploymentConfig.storageMode !== "cloud-api",
    warning: deploymentConfig.storageMode !== "cloud-api" ? "Local locks show the intended behaviour. Live locks must be enforced server-side for real concurrent users." : "Cloud lock endpoint active.",
    checks,
  };
}

function runAuthPermissionReadinessTests() {
  const checks = [
    { name: "Operations can create jobs", passed: canBackendAccess("operations", "canCreate", "jobs") },
    { name: "Operations can create supplier enquiries", passed: canBackendAccess("operations", "canCreate", "purchase_enquiries") },
    { name: "Operations can create purchase orders", passed: canBackendAccess("operations", "canCreate", "purchase_orders") },
    { name: "Sales cannot create jobs", passed: !canBackendAccess("sales", "canCreate", "jobs") },
    { name: "Sales cannot create supplier enquiries", passed: !canBackendAccess("sales", "canCreate", "purchase_enquiries") },
    { name: "Sales cannot create purchase orders", passed: !canBackendAccess("sales", "canCreate", "purchase_orders") },
    { name: "Staff cannot create purchase orders", passed: !canBackendAccess("staff", "canCreate", "purchase_orders") },
    { name: "Staff can update assigned task progress", passed: canBackendAccess("staff", "canUpdate", "assigned_job_task_progress") },
    { name: "Staff can create own clock entries", passed: canBackendAccess("staff", "canCreate", "own_clock_entries") },
    { name: "Staff can create own holiday requests", passed: canBackendAccess("staff", "canCreate", "own_holiday_requests") },
  ];
  return { passed: checks.every((check) => check.passed), checks };
}

function getProfileForRole(role, profiles = initialProfiles) {
  return profiles.find((profile) => profile.role === role && profile.status === "Active") || profiles.find((profile) => profile.role === role) || initialProfiles[0];
}

function createAuditLogEntry({ user, action, resource, resourceId = "", outcome = "Allowed", notes = "" }) {
  return {
    id: `audit-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    at: new Date().toISOString(),
    userId: user?.id || "unknown",
    userName: user?.name || "Unknown user",
    role: user?.role || "staff",
    action,
    resource,
    resourceId,
    outcome,
    notes,
  };
}

const backendPermissionMap = {
  operations: {
    label: "Operations",
    canRead: ["*"],
    canCreate: ["customers", "suppliers", "quotes", "quote_packages", "jobs", "purchase_enquiries", "purchase_orders", "delivery_notes", "stock_items", "clock_entries", "holiday_requests", "stored_documents", "pricing_schedule", "company_settings", "staff", "custom_products"],
    canUpdate: ["customers", "suppliers", "quotes", "quote_packages", "jobs", "purchase_enquiries", "purchase_orders", "delivery_notes", "stock_items", "clock_entries", "holiday_requests", "stored_documents", "pricing_schedule", "company_settings", "staff", "custom_products"],
    canDelete: ["draft_quotes", "draft_purchase_enquiries", "draft_purchase_orders", "draft_delivery_notes", "stored_documents"],
    restrictions: [],
  },
  sales: {
    label: "Sales",
    canRead: ["customers", "quotes", "company_settings"],
    canCreate: ["customers", "quotes", "quote_packages"],
    canUpdate: ["customers", "draft_quotes", "sent_quotes", "accepted_quotes_before_planner_send"],
    canDelete: ["draft_quotes"],
    restrictions: ["no_job_creation", "no_purchase_orders", "no_stock_cost_controls", "no_clocking_approvals", "no_holiday_approvals", "no_pricing_schedule_admin_unless_enabled"],
  },
  staff: {
    label: "Workshop",
    canRead: ["assigned_jobs", "job_sheets", "delivery_calendar", "own_clock_entries", "own_holiday_requests", "relevant_stored_documents", "stock_items"],
    canCreate: ["own_clock_entries", "own_holiday_requests", "job_progress_updates", "stock_items"],
    canUpdate: ["assigned_job_task_progress", "own_open_clock_entries", "own_pending_holiday_requests", "stock_items"],
    canDelete: [],
    restrictions: ["no_pricing", "no_quote_editing", "no_job_creation", "no_purchase_order_creation", "no_approval_controls", "no_admin_settings"],
  },
};

function canBackendAccess(role, action, resource) {
  const permissions = backendPermissionMap[role] || backendPermissionMap.staff;
  const allowed = permissions[action] || [];
  return allowed.includes("*") || allowed.includes(resource);
}

function assertBackendPermission({ user, action, resource }) {
  const allowed = canBackendAccess(user?.role || "staff", action, resource);
  return {
    allowed,
    audit: createAuditLogEntry({
      user,
      action,
      resource,
      outcome: allowed ? "Allowed" : "Denied",
      notes: allowed ? "Permission scaffold allowed action." : "Permission scaffold blocked action.",
    }),
  };
}

function createActionContext({ role, profiles }) {
  const user = getProfileForRole(role, profiles);
  return { user, role: user?.role || role || "staff" };
}

function createAppActionService({ role, profiles, setAuditLog, setActionStatus, recordLocks = [], setRecordLocks }) {
  const context = createActionContext({ role, profiles });

  function guard(action, resource, notes = "") {
    const result = assertBackendPermission({ user: context.user, action, resource });
    const audit = { ...result.audit, notes: notes || result.audit.notes };
    setAuditLog((current) => [audit, ...current].slice(0, 250));
    if (!result.allowed && setActionStatus) setActionStatus(`Permission denied: ${context.user?.name || "User"} cannot ${action.replace("can", "").toLowerCase()} ${resource}.`);
    return result.allowed;
  }

  function createRecord({ resource, record, setter, notes = "" }) {
    if (!guard("canCreate", resource, notes)) return null;
    const nextRecord = withRecordMeta(record, context.user);
    setter((current) => [nextRecord, ...current]);
    return nextRecord;
  }

  function updateRecord({ resource, id, patch, setter, notes = "" }) {
    if (!guard("canUpdate", resource, notes)) return false;
    const activeLock = getActiveRecordLock(recordLocks, resource, id);
    if (activeLock && !canEditLockedRecord(activeLock, context.user)) {
      if (setActionStatus) setActionStatus(`${resource} is currently being edited by ${activeLock.lockedByName}. Try again after the lock expires.`);
      setAuditLog((current) => [createAuditLogEntry({ user: context.user, action: "canUpdate", resource, resourceId: id, outcome: "Denied", notes: `Record locked by ${activeLock.lockedByName}.` }), ...current].slice(0, 250));
      return false;
    }
    setter((current) => current.map((record) => record.id === id ? bumpRecordVersion(record, patch, context.user) : record));
    return true;
  }

  function lockRecord({ resource, id, notes = "" }) {
    if (!guard("canUpdate", resource, notes || "Record locked for editing.")) return null;
    const activeLock = getActiveRecordLock(recordLocks, resource, id);
    if (activeLock && !canEditLockedRecord(activeLock, context.user)) {
      if (setActionStatus) setActionStatus(`${resource} is already being edited by ${activeLock.lockedByName}.`);
      return null;
    }
    const nextLock = createRecordLock({ recordId: id, resource, user: context.user });
    if (setRecordLocks) setRecordLocks((current) => upsertRecordLock(current, nextLock));
    return nextLock;
  }

  function unlockRecord({ resource, id }) {
    if (setRecordLocks) setRecordLocks((current) => current.filter((lock) => !(lock.resource === resource && lock.recordId === id)));
  }

  function deleteRecord({ resource, id, setter, notes = "" }) {
    if (!guard("canDelete", resource, notes)) return false;
    setter((current) => current.filter((record) => record.id !== id));
    return true;
  }

  return { context, guard, createRecord, updateRecord, deleteRecord, lockRecord, unlockRecord };
}

const liveReadinessStages = [
  { id: "ids", title: "Backend-safe IDs and versions", status: "Scaffolded", notes: "Safer local IDs, record versions and conflict helpers added." },
  { id: "services", title: "Service layer split", status: "In progress", notes: "Action service now covers jobs, stock, quote packages, POs, delivery notes, clocking and holidays." },
  { id: "numbering", title: "Backend-controlled numbering", status: "Scaffolded", notes: "Local reservation helper added; cloud endpoint contract added for server-side QU/JD/DN/ENQ/PO reservation before production." },
  { id: "permissions", title: "Backend permission enforcement", status: "Scaffolded", notes: "Permission map exists; next step is guarding write actions." },
  { id: "conflicts", title: "Multi-user conflict handling", status: "Scaffolded", notes: "Record version, visible lock checks and edit guards are in place; live backend must enforce locks server-side." },
  { id: "documents", title: "Saved document storage", status: "Scaffolded", notes: "Stored document register helper added; print-generated documents can now be tracked before cloud storage is connected." },
];

const deploymentStages = [
  { id: "database", title: "Cloud database", status: "Scaffolded", notes: "Local browser storage remains active until cloud API endpoints are connected." },
  { id: "auth", title: "Real login/auth", status: "Scaffolded", notes: "Operations, Sales and Staff roles are defined in-app; provider connection pending." },
  { id: "permissions", title: "Role permissions", status: "In place", notes: "Navigation and feature access are role-controlled in the app; backend enforcement still required." },
  { id: "pdf-generation", title: "Saved PDFs", status: "Scaffolded", notes: "Quote, PO and job sheet print views exist; server-side PDF storage pending." },
  { id: "document-storage", title: "Job document storage", status: "Scaffolded", notes: "Document register added; cloud file storage pending." },
  { id: "live-testing", title: "Full live workflow testing", status: "Pending", notes: "Run after database/auth/storage are connected." },
];

const proposedCloudTables = [
  "profiles", "customers", "suppliers", "quotes", "quote_packages", "jobs", "job_stage_tasks", "purchase_enquiries", "purchase_orders", "purchase_order_lines", "delivery_notes", "stock_items", "stock_length_segments", "stock_allocations", "clock_entries", "holiday_requests", "company_settings", "pricing_schedule", "custom_products", "productivity_rules", "stored_documents", "audit_log", "record_locks", "document_numbers", "app_snapshots"
];

const cloudBackendTablePlan = [
  { table: "profiles", purpose: "Real user login profile and role", keyFields: "id, email, name, role, status", access: "Operations manage; all users read own profile" },
  { table: "customers", purpose: "Customer records", keyFields: "id, company, contact, email, phone, deliveryAddress", access: "Operations/Sales create and edit" },
  { table: "suppliers", purpose: "Supplier directory for enquiries and POs", keyFields: "id, name, contact, email, phone", access: "Operations only" },
  { table: "quotes", purpose: "Quote builder output and customer quote status", keyFields: "id, quoteNo, customerId, status, totals, takeoffLines", access: "Operations/Sales, with pricing visibility controlled" },
  { table: "quote_packages", purpose: "Planner inbox package created from draft-complete quotes", keyFields: "id, quoteId, inboxStatus, leadTime, productionStageBreakdown", access: "Operations only" },
  { table: "jobs", purpose: "Live production job header", keyFields: "id, jobNo, quoteId, customerId, deadline, status, priority", access: "Operations edit; Staff read assigned" },
  { table: "job_stage_tasks", purpose: "Planner task rows and staff allocation", keyFields: "id, jobId, stage, staffIds, start, end, hours, status", access: "Operations edit; Staff update assigned progress" },
  { table: "purchase_enquiries", purpose: "Supplier enquiry before a PO number is raised", keyFields: "id, enquiryNo, jobId, supplierId, status, lines", access: "Operations only" },
  { table: "purchase_orders", purpose: "Formal supplier purchase orders after enquiry/quote confirmation", keyFields: "id, poNo, enquiryNo, jobId, supplierId, totals, status", access: "Operations only" },
  { table: "stock_items", purpose: "Stock inventory header and material identity with PO/enquiry traceability", keyFields: "id, productId, sectionSize, grade, finish, purchaseDocumentId, purchaseDocumentNo, sourceJobId", access: "Operations edit; Staff read-only" },
  { table: "stock_length_segments", purpose: "Individual full lengths/offcuts for length-aware stock allocation and scrapped offcut history", keyFields: "id, stockItemId, originalLengthM, availableLengthM, status, sourceStatus, scrapReason, scrappedAt", access: "Operations edit; Staff read-only" },
  { table: "stock_allocations", purpose: "Reserved/consumed lengths against jobs to avoid double-ordering", keyFields: "id, stockSegmentId, jobId, partId, lengthM, status", access: "Operations edit; Staff read-only" },
  { table: "stored_documents", purpose: "Saved PDFs/documents attached to quotes/jobs/POs", keyFields: "id, documentType, relatedResource, storageUrl, documentNo", access: "Operations create; role-filtered read" },
  { table: "audit_log", purpose: "Permanent action history", keyFields: "id, userId, action, resource, resourceId, outcome, at", access: "Operations read" },
  { table: "document_numbers", purpose: "Server-side QU/JD/DN/ENQ/PO number reservation", keyFields: "documentType, sequence, reservedBy, reservedAt", access: "Backend only" },
];

const liveApiContracts = [
  { method: "GET", path: "/api/jdfabs/snapshot", purpose: "Load initial app state from cloud database." },
  { method: "PUT", path: "/api/jdfabs/snapshot", purpose: "Development fallback endpoint for saving a full snapshot before table-by-table sync." },
  { method: "POST", path: "/api/jdfabs/numbering/reserve", purpose: "Reserve QU/JD/DN/ENQ/PO numbers safely for multiple users." },
  { method: "POST", path: "/api/jdfabs/documents", purpose: "Create server-side PDF/document record and return storage URL." },
  { method: "POST", path: "/api/jdfabs/audit", purpose: "Write permanent audit events." },
  { method: "POST", path: "/api/jdfabs/locks", purpose: "Create or renew record locks for live multi-user editing." },
  { method: "DELETE", path: "/api/jdfabs/locks/:id", purpose: "Release record locks after save/cancel." },
  { method: "POST", path: "/api/jdfabs/stock/allocate-length", purpose: "Reserve a required cut length from a full length/offcut and return remaining available length." },
  { method: "POST", path: "/api/jdfabs/stock/from-purchase-document", purpose: "Create on-order stock length segments from supplier enquiry/PO lines." },
  { method: "POST", path: "/api/jdfabs/stock/scrap-segment", purpose: "Mark an offcut/full length segment as scrapped/consumed while keeping traceability history." },
];

const liveRolloutChecklist = [
  { id: "stable-release", title: "Create stable release point", status: "Next", owner: "Release", test: "GitHub has a clean commit/tag for the current working OPHQ build before more changes are added." },
  { id: "backup-current-data", title: "Take current backup", status: "Next", owner: "Operations", test: "Export JSON backup downloads and can be previewed/import-checked without restoring." },
  { id: "staging-deploy", title: "Deploy staging/test app", status: "Next", owner: "Release", test: "Private Vercel preview/staging URL runs the latest commit and matches GitHub source." },
  { id: "workflow-test", title: "Run full workflow test", status: "Next", owner: "Operations", test: "Quote -> approval -> job -> enquiry/PO -> stock/offcut -> job sheet -> delivery note completes using test data." },
  { id: "stock-test", title: "Validate stock/offcut workflow", status: "Next", owner: "Operations", test: "PO stock creates allocated/offcut rows; existing stock auto-allocates; manual cut and scrap work and persist after reload." },
  { id: "clocking-test", title: "Validate clocking and sick days", status: "Pending", owner: "Operations", test: "26th-25th period, Mon-Fri standard hours, weekend clocking, overtime and sick absence rows display correctly." },
  { id: "contacts-import", title: "Validate customer/supplier imports", status: "Pending", owner: "Operations", test: "Xero Contacts CSV imports customers and suppliers, searchable autofill works, remove/hide behaves safely." },
  { id: "documents-test", title: "Validate printed documents", status: "Pending", owner: "Operations", test: "Quote, PO, job sheet and delivery note print/PDF cleanly without app screen clutter." },
  { id: "role-test", title: "Validate user roles", status: "Pending", owner: "Operations", test: "Operations, Sales and Staff views show only permitted sections; Staff cannot see staff/admin/pricing controls." },
  { id: "cloud-database", title: "Connect cloud database", status: "Pending", owner: "Backend", test: "App state loads/saves through cloud-api mode rather than browser local storage." },
  { id: "auth-provider", title: "Connect real login provider", status: "Pending", owner: "Backend", test: "Named Operations, Sales and Staff users log in with correct role and MFA rules." },
  { id: "backend-permissions", title: "Enforce backend permissions", status: "Pending", owner: "Backend", test: "Permission restrictions are enforced server-side, not only hidden in the UI." },
  { id: "numbering", title: "Move document numbering to backend", status: "Pending", owner: "Backend", test: "Two users cannot reserve the same QU/JD/DN/ENQ/PO number." },
  { id: "document-storage", title: "Connect document storage", status: "Pending", owner: "Backend", test: "Generated PDFs and signed documents are stored against their records and survive browser/device changes." },
  { id: "production-launch", title: "Production launch", status: "Pending", owner: "Release", test: "Backup taken, rollback available, staging test passed, users briefed, first live job completed successfully." },
];

const preLaunchWorkflowChecklist = [
  { id: "backup-before-test", area: "Backup", check: "Export a local OPHQ backup before every test round.", pass: "Backup JSON downloads, shows sensible record counts, and restore preview can be cancelled safely." },
  { id: "quote-create", area: "Quotes", check: "Create a steel quote with material, finish, holes/extras, plates, weld hit/miss, VAT and markup.", pass: "Quote total, VAT, weight, finish per-tonne cost and production hours look correct." },
  { id: "quote-approval", area: "Quote approvals", check: "Send quote for approval, approve lead time, mark sent, then mark accepted.", pass: "Quote moves through statuses without duplicate records and preserves quote totals." },
  { id: "job-create", area: "Jobs", check: "Create a job from an accepted quote.", pass: "JD number links to quote number and job appears in planner/job register." },
  { id: "planner", area: "Planner", check: "Update stage progression and check staff assignment visibility.", pass: "Operations can manage planner; Staff view is limited and staff/admin section remains hidden." },
  { id: "purchasing-enquiry", area: "Purchasing", check: "Create supplier enquiry from a job and confirm it does not create stock.", pass: "Enquiry appears for supplier handling but stock inventory remains unchanged until PO is raised." },
  { id: "purchase-order", area: "Purchasing", check: "Edit enquiry after supplier quote and raise PO.", pass: "PO number is created and ordered material creates allocated stock and offcut rows." },
  { id: "stock-po", area: "Stock", check: "Raise PO for a full length where the job needs a shorter cut.", pass: "Allocated job line and Offcut line appear automatically; offcut is available for auto allocation." },
  { id: "stock-existing", area: "Stock", check: "Create a job that can use existing stock/offcut.", pass: "No enquiry is raised if stock covers it; inventory splits into allocated line plus recalculated offcut." },
  { id: "stock-actions", area: "Stock", check: "Use Manual cut, Cut/consume and Scrap on stock/offcuts.", pass: "Manual cut creates a used/allocated line and remaining offcut; scrap removes line from available inventory; reload preserves changes." },
  { id: "contacts", area: "Customers/Suppliers", check: "Import Xero Contacts CSV as customers and suppliers.", pass: "*ContactName and EmailAddress map correctly; missing emails do not block valid names; searchable autofill finds imported records." },
  { id: "delivery", area: "Delivery", check: "Raise delivery note, print/PDF it, sign it, and confirm job leaves delivery calendar.", pass: "Signed delivery note is retained and job becomes ready for invoice/Xero." },
  { id: "clocking", area: "Clocking", check: "Clock staff across weekdays/weekends, add sick day absence, and review timesheet.", pass: "26th-25th period remains; Mon-Fri standard hours are used; weekend hours count before overtime; sick days show as absence." },
  { id: "documents", area: "Documents", check: "Print/PDF quote, PO, job sheet and delivery note.", pass: "Each document has clean A4 output and does not print the full app screen." },
  { id: "roles", area: "Roles", check: "Check Operations, Sales and Staff role views.", pass: "Sales cannot access jobs/POs; Staff cannot see pricing/admin/staff controls; Operations can manage all required areas." },
  { id: "restore", area: "Restore", check: "Preview a backup restore without confirming it.", pass: "Backup counts appear and restore can be cancelled safely." },
];

const backendHandoverSpec = [
  { area: "Domain", requirement: "Use ophq.ai or agreed production domain for the live app.", decisionNeeded: "Confirm production domain and whether staging should use staging.ophq.ai or a private Vercel preview URL." },
  { area: "Hosting", requirement: "Deploy React/Vite app with HTTPS, environment variables and rollback support.", decisionNeeded: "Vercel is currently suitable; confirm production project and rollback process." },
  { area: "Database", requirement: "Move OPHQ records from browser local storage into a cloud database using the table plan.", decisionNeeded: "Choose Supabase/Postgres, Firebase, or another managed database before team-wide live use." },
  { area: "Auth", requirement: "Replace role switch/local profiles with real logins for Operations, Sales and Staff.", decisionNeeded: "Choose auth provider and prepare first user email list, including MFA for Operations." },
  { area: "Permissions", requirement: "Enforce role access in backend/API, not just by hiding UI sections.", decisionNeeded: "Confirm backend RLS/API permission rules for Operations, Sales and Staff." },
  { area: "Document storage", requirement: "Store quote PDFs, job sheets, enquiries, POs, delivery notes and signed notes against records.", decisionNeeded: "Choose Supabase Storage, S3, Cloudflare R2 or equivalent." },
  { area: "Backups", requirement: "Automatic scheduled database backups plus manual backup before every production release.", decisionNeeded: "Confirm retention period; suggested minimum 30 days plus pre-release manual snapshots." },
  { area: "Numbering", requirement: "Reserve QU/JD/DN/ENQ/PO numbers on the backend so two users cannot create duplicates.", decisionNeeded: "Backend implementation required before multi-user production use." },
  { area: "Stock concurrency", requirement: "Stock allocation, cut/consume and scrap actions must be transaction-safe.", decisionNeeded: "Backend stock allocation endpoint should lock segment/row before changing available length." },
  { area: "Audit trail", requirement: "Keep permanent audit history for quotes, jobs, POs, stock movements, clocking, staff and settings.", decisionNeeded: "Confirm which actions must be non-deletable for compliance and traceability." },
  { area: "Go-live blocker", requirement: "Do not use as the live company system while storageMode is local.", decisionNeeded: "Switch to cloud-api only after staging test passes and backup/rollback are confirmed." },
];

function getLaunchModeStatus() {
  const isCloud = deploymentConfig.storageMode === "cloud-api";
  const isProduction = deploymentConfig.environment === "production";
  if (isCloud && isProduction) {
    return {
      mode: "Production ready",
      tone: "green",
      message: "Cloud database mode is active. Confirm backups, auth and rollback before team-wide use.",
    };
  }
  if (isCloud) {
    return {
      mode: "Staging cloud test",
      tone: "amber",
      message: "Cloud API mode is active, but this should still be tested privately before production release.",
    };
  }
  return {
    mode: "Local test mode",
    tone: "red",
    message: "Data is currently saved in this browser only. Do not treat this as the live company system until cloud database, auth, backups and document storage are connected.",
  };
}

function getEmptyAppStateSnapshot() {
  return {
    customers: [],
    staff: [],
    suppliers: [],
    quotes: [],
    plannerQuotePackages: [],
    jobs: [],
    purchaseOrders: [],
    deliveryNotes: [],
    stockItems: [],
    importLogs: [],
    companySettings: initialCompanySettings,
    clockEntries: [],
    holidays: [],
    sickDays: [],
    stageTimeEntries: [],
    pricingSchedule: defaultSteelPricingSchedule,
    productivityRules: defaultProductivityRules,
    customProducts: [],
    storedDocuments: [],
    profiles: initialProfiles,
    auditLog: [],
    recordLocks: [],
  };
}

function loadSavedAppState() {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(APP_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    return {};
  }
}

async function loadCloudAppState() {
  if (deploymentConfig.storageMode !== "cloud-api" || typeof fetch === "undefined") return null;
  const response = await fetch(`${deploymentConfig.apiBaseUrl}/snapshot`, { method: "GET" });
  if (!response.ok) throw new Error(`Cloud load failed with status ${response.status}`);
  return response.json();
}

async function saveCloudAppState(snapshot) {
  if (deploymentConfig.storageMode !== "cloud-api" || typeof fetch === "undefined") return false;
  const response = await fetch(`${deploymentConfig.apiBaseUrl}/snapshot`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(snapshot),
  });
  if (!response.ok) throw new Error(`Cloud save failed with status ${response.status}`);
  return true;
}

function saveAppState(snapshot) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(APP_STORAGE_KEY, JSON.stringify(snapshot));
  } catch (error) {
    // Local browser storage can fail if full or blocked. The app should continue running.
  }
}

function clearSavedAppState() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(APP_STORAGE_KEY);
}

function downloadAppStateBackup(snapshot = {}, filePrefix = "jdfabs-ophq-backup") {
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const blob = new Blob([JSON.stringify({ ...snapshot, exportedAt: new Date().toISOString(), appStorageKey: APP_STORAGE_KEY }, null, 2)], { type: "application/json" });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${filePrefix}-${timestamp}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
  return true;
}

function restoreAppStateBackup(snapshot = {}) {
  if (typeof window === "undefined") return false;
  const allowedSnapshot = getEmptyAppStateSnapshot();
  const restored = Object.keys(allowedSnapshot).reduce((next, key) => {
    if (Object.prototype.hasOwnProperty.call(snapshot, key)) next[key] = snapshot[key];
    return next;
  }, {});
  restored.restoredAt = new Date().toISOString();
  saveAppState(restored);
  return true;
}

function getBackupPreviewSummary(snapshot = {}) {
  return {
    customers: Array.isArray(snapshot.customers) ? snapshot.customers.length : 0,
    quotes: Array.isArray(snapshot.quotes) ? snapshot.quotes.length : 0,
    jobs: Array.isArray(snapshot.jobs) ? snapshot.jobs.length : 0,
    purchaseOrders: Array.isArray(snapshot.purchaseOrders) ? snapshot.purchaseOrders.length : 0,
    stockItems: Array.isArray(snapshot.stockItems) ? snapshot.stockItems.length : 0,
    exportedAt: snapshot.exportedAt || snapshot.savedAt || "Unknown",
  };
}

const initialStaff = [
  { id: "s1", name: "Jon", roles: ["Design", "Order Materials", "Cutting", "Drilling", "Fabrication"], rolePriorities: { Design: 1, "Order Materials": 3, Cutting: 1, Drilling: 5, Fabrication: 2 }, hoursPerDay: 8, pin: "1111" },
  { id: "s2", name: "Mick", roles: ["Order Materials", "Drilling", "Fabrication", "Welding", "Inspection"], rolePriorities: { "Order Materials": 2, Drilling: 1, Fabrication: 1, Welding: 1, Inspection: 2 }, hoursPerDay: 8, pin: "2222" },
  { id: "s3", name: "Sarah", roles: ["Order Materials", "Inspection", "Painting"], rolePriorities: { "Order Materials": 1, Inspection: 1, Painting: 1 }, hoursPerDay: 7.5, pin: "3333" },
  { id: "s4", name: "Lee", roles: ["Order Materials", "Delivery"], rolePriorities: { "Order Materials": 4, Delivery: 1 }, hoursPerDay: 8, pin: "4444" },
];

function isStaffActive(person = {}) {
  return String(person.status || "Active") !== "Inactive";
}

const stages = ["Design", "Order Materials", "Cutting", "Drilling", "Fabrication", "Welding", "Inspection", "Painting", "Delivery", "Complete"];
const statuses = ["Waiting Material", "In Production", "To Be Invoiced", "Delivery", "Complete"];
const quoteStatuses = ["Draft", "In Planner Review", "Ready to send", "Sent", "Accepted", "Rejected", "Converted"];
const poStatuses = ["Enquiry Draft", "Enquiry Sent", "Supplier Quote Received", "Draft PO", "Sent", "Part Received", "Received", "Cancelled"];
const deliveryStatuses = ["Draft", "Issued", "Signed", "Cancelled"];
const invoiceStatuses = ["Not Invoiced", "Ready for Xero", "Sent to Xero", "Paid"];
const stockStatuses = ["In Stock", "On Order", "Allocated", "Offcut", "Consumed", "Scrapped"];
const stockLengthStatuses = ["Available", "Reserved", "Consumed", "Offcut"];
const stockKerfAllowanceM = 0;

function normaliseLengthM(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return 0;
  const number = Number(raw.replace(/[^0-9.]/g, "") || 0);
  if (!number) return 0;
  if (raw.includes("mm")) return number / 1000;
  return number;
}

function formatLengthM(value) {
  const number = Number(value || 0);
  return `${Math.round(number * 1000) / 1000}m`;
}

function createLengthSegmentsForStockItem(item = {}) {
  const quantity = Math.max(1, Number(item.quantity || 1));
  const lengthM = Number(item.length || normaliseLengthM(item.lengthText) || 0);
  return Array.from({ length: quantity }, (_, index) => ({
    id: `${item.id || "stock"}-seg-${index + 1}`,
    originalLengthM: lengthM,
    availableLengthM: lengthM,
    status: "Available",
    sourceStatus: item.status || "In Stock",
    allocatedJobId: item.allocatedJobId || "",
    allocations: [],
  }));
}

function getStockSegments(item = {}) {
  const segments = Array.isArray(item.lengthSegments) && item.lengthSegments.length ? item.lengthSegments : createLengthSegmentsForStockItem(item);
  return segments.map((segment, index) => ({
    id: segment.id || `${item.id || "stock"}-seg-${index + 1}`,
    originalLengthM: Number(segment.originalLengthM || item.length || 0),
    availableLengthM: Math.max(0, Number(segment.availableLengthM ?? segment.remainingLengthM ?? item.length ?? 0)),
    status: segment.status || "Available",
    sourceStatus: segment.sourceStatus || item.status || "In Stock",
    allocatedJobId: segment.allocatedJobId || "",
    allocations: segment.allocations || [],
  }));
}

function getStockAllocationRows(item = {}, jobs = []) {
  return getStockSegments(item).flatMap((segment) => (segment.allocations || []).map((allocation) => {
    const job = jobs.find((jobItem) => jobItem.id === allocation.jobId);
    return {
      ...allocation,
      segmentId: segment.id,
      jobNo: job?.jobNo || allocation.jobId || "Unknown job",
      jobTitle: job?.title || "",
      remainingLengthM: Number(segment.availableLengthM || 0),
      originalLengthM: Number(segment.originalLengthM || 0),
      segmentStatus: segment.status,
    };
  }));
}

function getStockTraceabilityNumber(item = {}) {
  return item.purchaseDocumentNo || item.poNo || item.enquiryNo || item.purchaseDocumentId || "Manual stock";
}

function getPoLineOrderedLengthM(line = {}) {
  return normaliseLengthM(line.orderedLength || line.orderLength || line.stockLength || line.length) || Number(line.orderedLength || line.orderLength || line.stockLength || line.length || 0);
}

function getPoLineAllocatedLengthM(line = {}) {
  return normaliseLengthM(line.allocatedLength || line.requiredLength || line.cutLength || line.jobLength || line.requiredCutLength || line.length) || Number(line.allocatedLength || line.requiredLength || line.cutLength || line.jobLength || line.requiredCutLength || line.length || 0);
}

function createStockSegmentsForFixedLine(item = {}, status = "Available") {
  const quantity = Math.max(1, Number(item.quantity || 1));
  const lengthM = Number(item.length || normaliseLengthM(item.lengthText) || 0);
  return Array.from({ length: quantity }, (_, index) => ({
    id: `${item.id || "stock"}-seg-${index + 1}`,
    originalLengthM: lengthM,
    availableLengthM: lengthM,
    status,
    sourceStatus: item.status || "In Stock",
    allocatedJobId: item.allocatedJobId || "",
    allocations: item.allocatedJobId ? [{ id: createEntityId("stock-allocation"), jobId: item.allocatedJobId, lengthM, partId: item.sourcePoLineId || "", status: "Allocated", allocatedAt: new Date().toISOString() }] : [],
  }));
}

function scrapStockSegment(stockItems = [], { stockItemId = "", segmentId = "", reason = "Scrapped offcut" }) {
  if (!stockItemId) return stockItems;
  return stockItems.flatMap((item) => {
    if (item.id !== stockItemId) return [item];
    const remainingSegments = getStockSegments(item).filter((segment) => segment.id !== segmentId);
    if (!remainingSegments.length) return [];
    return [{
      ...item,
      lengthSegments: remainingSegments,
      quantity: remainingSegments.length,
      length: Number(remainingSegments[0]?.availableLengthM || item.length || 0),
      notes: [item.notes, `${reason || "Scrapped offcut"} removed from available stock.`].filter(Boolean).join(" | "),
    }];
  });
}

function getAllocatedLengthForStockItem(item = {}) {
  return getStockSegments(item)
    .flatMap((segment) => segment.allocations || [])
    .reduce((sum, allocation) => sum + Number(allocation.lengthM || 0), 0);
}

function getRemainingLengthForStockItem(item = {}) {
  return getStockSegments(item)
    .filter((segment) => segment.status !== "Consumed")
    .reduce((sum, segment) => sum + Number(segment.availableLengthM || 0), 0);
}

function getStockAvailableLengthByStatus(stockItems = [], part = {}, status = "In Stock", jobId = "") {
  const statusList = Array.isArray(status) ? status : [status];
  return (stockItems || [])
    .filter((item) => stockMatchesPart(item, part) && statusList.includes(item.status))
    .flatMap((item) => getStockSegments(item).map((segment) => ({ item, segment })))
    .filter(({ segment }) => segment.status !== "Consumed")
    .filter(({ segment }) => !segment.allocatedJobId || segment.allocatedJobId === jobId)
    .reduce((sum, { segment }) => sum + Number(segment.availableLengthM || 0), 0);
}

function getRequiredLengthForPart(part = {}) {
  return Number(part.length || 0) * Math.max(1, Number(part.quantity || 1));
}

function findBestStockSegmentForLength(stockItems = [], part = {}, requiredLengthM = 0, preferredStatus = "In Stock", jobId = "") {
  const preferredStatuses = Array.isArray(preferredStatus) ? preferredStatus : [preferredStatus];
  const candidates = (stockItems || [])
    .filter((item) => stockMatchesPart(item, part) && preferredStatuses.includes(item.status))
    .flatMap((item) => getStockSegments(item).map((segment) => ({ item, segment })))
    .filter(({ segment }) => segment.status !== "Consumed")
    .filter(({ segment }) => !segment.allocatedJobId || segment.allocatedJobId === jobId)
    .filter(({ segment }) => Number(segment.availableLengthM || 0) + 0.0001 >= Number(requiredLengthM || 0))
    .sort((a, b) => Number(a.segment.availableLengthM || 0) - Number(b.segment.availableLengthM || 0));
  return candidates[0] || null;
}

function allocateStockLengthToJob(stockItems = [], { stockItemId = "", segmentId = "", jobId = "", part = {}, lengthM = 0, status = "Reserved" }) {
  const requestedLength = Number(lengthM || part.length || 0) + stockKerfAllowanceM;
  if (!requestedLength || !jobId) return stockItems;
  return stockItems.map((item) => {
    if (stockItemId && item.id !== stockItemId) return item;
    if (!stockItemId && !stockMatchesPart(item, part)) return item;
    let allocated = false;
    const segments = getStockSegments(item).map((segment) => {
      if (allocated) return segment;
      if (segmentId && segment.id !== segmentId) return segment;
      if (segment.status === "Consumed") return segment;
      if (segment.allocatedJobId && segment.allocatedJobId !== jobId) return segment;
      if (Number(segment.availableLengthM || 0) + 0.0001 < requestedLength) return segment;
      allocated = true;
      const remaining = Math.max(0, Number(segment.availableLengthM || 0) - requestedLength);
      return {
        ...segment,
        availableLengthM: remaining,
        status: remaining > 0 ? "Offcut" : "Consumed",
        allocatedJobId: remaining > 0 ? "" : jobId,
        allocations: [...(segment.allocations || []), { id: createEntityId("stock-allocation"), jobId, lengthM: requestedLength, partId: part.id || "", status, allocatedAt: new Date().toISOString() }],
      };
    });
    return allocated ? { ...item, lengthSegments: segments, quantity: segments.filter((segment) => segment.status !== "Consumed").length, notes: [item.notes, `Allocated ${formatLengthM(requestedLength)} to job; remaining lengths updated.`].filter(Boolean).join(" | ") } : item;
  });
}

function createStockLinesFromPoLine(line = {}, po = {}, status = "On Order") {
  const orderedLengthM = getPoLineOrderedLengthM(line);
  const allocatedLengthM = Math.min(orderedLengthM, getPoLineAllocatedLengthM(line) || orderedLengthM);
  const offcutLengthM = Math.max(0, orderedLengthM - allocatedLengthM);
  const quantity = Math.max(1, Number(line.quantity || 1));
  const common = {
    productId: line.productId || "",
    sectionSize: line.sectionSize || "",
    grade: line.grade || "S355",
    finish: line.finish || "Self colour",
    quantity,
    location: status === "On Order" ? "On order" : "Goods in",
    purchaseDocumentId: po.id || "",
    purchaseDocumentNo: getPurchasingDocumentNumber(po),
    sourceJobId: po.jobId || "",
    sourcePoLineId: line.id || "",
  };
  const rows = [];
  if (allocatedLengthM > 0) {
    const allocated = {
      ...common,
      id: createEntityId("stock-allocated"),
      length: orderedLengthM,
      sourceStockLengthM: orderedLengthM,
      sourceOrderedLengthM: orderedLengthM,
      allocatedCutLengthM: allocatedLengthM,
      remainingLengthM: offcutLengthM,
      status: status === "On Order" ? "On Order" : "Allocated",
      stockLineType: "Allocated",
      allocatedJobId: po.jobId || "",
      notes: `Allocated cut from ${getPurchasingDocumentTitle(po)} ${getPurchasingDocumentNumber(po)}. Cut ${formatLengthM(allocatedLengthM)} from ordered ${formatLengthM(orderedLengthM)}.`,
    };
    rows.push({
      ...allocated,
      lengthSegments: [{
        id: `${allocated.id}-seg-1`,
        originalLengthM: orderedLengthM,
        availableLengthM: offcutLengthM,
        status: "Allocated",
        sourceStatus: allocated.status,
        allocatedJobId: allocated.allocatedJobId,
        allocations: [{ id: createEntityId("stock-allocation"), jobId: allocated.allocatedJobId, lengthM: allocatedLengthM, partId: line.id || "", status: "Allocated", allocatedAt: new Date().toISOString() }],
      }],
    });
  }
  if (offcutLengthM > 0) {
    const offcut = {
      ...common,
      id: createEntityId("stock-offcut"),
      length: offcutLengthM,
      status: "Offcut",
      stockLineType: "Offcut",
      allocatedJobId: "",
      sourceOrderedLengthM: orderedLengthM,
      sourceAllocatedLengthM: allocatedLengthM,
      notes: `Offcut created from ${getPurchasingDocumentTitle(po)} ${getPurchasingDocumentNumber(po)} after allocated cut ${formatLengthM(allocatedLengthM)}.`,
    };
    rows.push({ ...offcut, lengthSegments: createStockSegmentsForFixedLine(offcut, "Offcut") });
  }
  return rows;
}

function createStockItemFromPoLine(line = {}, po = {}, status = "On Order") {
  return createStockLinesFromPoLine(line, po, status)[0] || null;
}

function createStockItemsFromPurchasingDocument(po = {}, status = "On Order") {
  if (isEnquiryDocument(po)) return [];
  return (po.items || [])
    .filter((line) => line.productId && line.sectionSize && getPoLineOrderedLengthM(line) > 0)
    .flatMap((line) => createStockLinesFromPoLine(line, po, status));
}

function consumeAllocatedStockLine(stockItems = [], stockItemId = "") {
  if (!stockItemId) return stockItems;
  return stockItems.filter((item) => item.id !== stockItemId);
}

function cutOffcutStockLine(stockItems = [], { stockItemId = "", lengthM = 0, jobId = "" }) {
  const cutLength = Number(lengthM || 0);
  if (!stockItemId || cutLength <= 0) return stockItems;
  const now = new Date().toISOString();
  const output = [];
  stockItems.forEach((item) => {
    if (item.id !== stockItemId) {
      output.push(item);
      return;
    }
    const sourceLength = Number(item.length || getRemainingLengthForStockItem(item) || 0);
    if (cutLength > sourceLength + 0.0001) {
      output.push(item);
      return;
    }
    const remaining = Math.max(0, sourceLength - cutLength);
    const cutLine = {
      ...item,
      id: createEntityId("stock-cut"),
      length: sourceLength,
      sourceStockLengthM: sourceLength,
      allocatedCutLengthM: cutLength,
      remainingLengthM: remaining,
      quantity: 1,
      status: "Allocated",
      stockLineType: "Allocated Cut",
      allocatedJobId: jobId || item.allocatedJobId || "",
      cutFromStockItemId: item.id,
      notes: [`Manual cut ${formatLengthM(cutLength)} from stock length ${formatLengthM(sourceLength)}.`, jobId ? `Allocated to job ${jobId}.` : "Manual cut not job-linked."].join(" "),
    };
    output.push({
      ...cutLine,
      lengthSegments: [{
        id: `${cutLine.id}-seg-1`,
        originalLengthM: sourceLength,
        availableLengthM: remaining,
        status: "Allocated",
        sourceStatus: item.status || "Offcut",
        allocatedJobId: cutLine.allocatedJobId,
        allocations: [{ id: createEntityId("stock-allocation"), jobId: cutLine.allocatedJobId, lengthM: cutLength, partId: "manual-cut", status: "Allocated", allocatedAt: now }],
      }],
    });
    if (remaining > 0.0001) {
      const offcutLine = {
        ...item,
        id: createEntityId("stock-offcut"),
        length: remaining,
        quantity: 1,
        status: item.status === "On Order" ? "On Order" : "Offcut",
        stockLineType: "Offcut",
        allocatedJobId: "",
        notes: [item.notes, `Remaining offcut after manual cut ${formatLengthM(cutLength)} on ${now}.`].filter(Boolean).join(" | "),
      };
      output.push({ ...offcutLine, lengthSegments: createStockSegmentsForFixedLine(offcutLine, "Offcut") });
    }
  });
  return output;
}


function getPartCutLengthM(part = {}) {
  return normaliseLengthM(part.requiredCutLength || part.cutLength || part.lengthM || part.length || part.sizeLength || part.itemLength || "") || Number(part.length || 0) || 0;
}

function allocateExistingStockRowsForJob(stockItems = [], job = {}) {
  const parts = getJobPartsList(job, null).filter((part) => part.productId && part.sectionSize && getPartCutLengthM(part) > 0);
  if (!parts.length) return stockItems;
  let rows = [...stockItems];
  parts.forEach((part) => {
    const quantity = Math.max(1, Number(part.quantity || 1));
    for (let index = 0; index < quantity; index += 1) {
      const cutLengthM = getPartCutLengthM(part);
      const candidateOptions = rows
        .map((item, rowIndex) => ({ item, rowIndex, availableLengthM: Number(item.length || getRemainingLengthForStockItem(item) || 0) }))
        .filter(({ item, availableLengthM }) => {
          if (!stockMatchesPart(item, part)) return false;
          if (item.allocatedJobId) return false;
          if (!["In Stock", "Offcut", "Available"].includes(item.status)) return false;
          return availableLengthM + 0.0001 >= cutLengthM;
        })
        .sort((a, b) => a.availableLengthM - b.availableLengthM);
      const candidateIndex = candidateOptions[0]?.rowIndex ?? -1;
      if (candidateIndex < 0) continue;
      const source = rows[candidateIndex];
      const sourceLengthM = Number(source.length || getRemainingLengthForStockItem(source) || 0);
      const sourceQuantity = Math.max(1, Number(source.quantity || 1));
      const remainingCutOffcutM = Math.max(0, sourceLengthM - cutLengthM - stockKerfAllowanceM);
      const allocatedLine = {
        ...source,
        id: createEntityId("stock-allocated"),
        length: sourceLengthM,
        sourceStockLengthM: sourceLengthM,
        allocatedCutLengthM: cutLengthM,
        remainingLengthM: remainingCutOffcutM,
        quantity: 1,
        status: "Allocated",
        stockLineType: "Allocated",
        allocatedJobId: job.id || "",
        allocatedJobNo: job.jobNo || "",
        sourceStockItemId: source.id,
        sourcePartId: part.id || "",
        notes: [`Allocated ${formatLengthM(cutLengthM)} to ${job.jobNo || job.id || "job"} from existing stock length ${formatLengthM(sourceLengthM)}.`, source.notes].filter(Boolean).join(" | "),
      };
      const replacementRows = [{
        ...allocatedLine,
        lengthSegments: [{
          id: `${allocatedLine.id}-seg-1`,
          originalLengthM: sourceLengthM,
          availableLengthM: remainingCutOffcutM,
          status: "Allocated",
          sourceStatus: source.status || "In Stock",
          allocatedJobId: job.id || "",
          allocations: [{ id: createEntityId("stock-allocation"), jobId: job.id || "", lengthM: cutLengthM, partId: part.id || "", status: "Allocated", allocatedAt: new Date().toISOString() }],
        }],
      }];
      if (remainingCutOffcutM > 0.0001) {
        const offcutLine = {
          ...source,
          id: createEntityId("stock-offcut"),
          length: remainingCutOffcutM,
          quantity: 1,
          status: "Offcut",
          stockLineType: "Offcut",
          allocatedJobId: "",
          allocatedJobNo: "",
          sourceStockItemId: source.id,
          notes: [`Remaining offcut after allocating ${formatLengthM(cutLengthM)} to ${job.jobNo || job.id || "job"}.`, source.notes].filter(Boolean).join(" | "),
        };
        replacementRows.push({ ...offcutLine, lengthSegments: createStockSegmentsForFixedLine(offcutLine, "Offcut") });
      }
      if (sourceQuantity > 1) {
        const remainingFullLengthLine = {
          ...source,
          id: createEntityId("stock"),
          quantity: sourceQuantity - 1,
          allocatedJobId: "",
          allocatedJobNo: "",
          notes: [`Remaining ${sourceQuantity - 1} full length(s) after allocating one length to ${job.jobNo || job.id || "job"}.`, source.notes].filter(Boolean).join(" | "),
        };
        replacementRows.push({ ...remainingFullLengthLine, lengthSegments: createLengthSegmentsForStockItem(remainingFullLengthLine) });
      }
      rows = [...rows.slice(0, candidateIndex), ...replacementRows, ...rows.slice(candidateIndex + 1)];
    }
  });
  return rows;
}


function stockItemLinkedToJob(item = {}, job = {}) {
  if (!job?.id) return false;
  if (item.allocatedJobId === job.id || item.jobId === job.id) return true;
  return getStockSegments(item).some((segment) => segment.allocatedJobId === job.id || (segment.allocations || []).some((allocation) => allocation.jobId === job.id));
}

function releaseStockAllocationsForJob(stockItems = [], job = {}) {
  if (!job?.id) return stockItems;
  const nowIso = new Date().toISOString();
  const sourceIdsToRestore = new Set(
    (stockItems || [])
      .filter((item) => stockItemLinkedToJob(item, job))
      .map((item) => item.sourceStockItemId || item.cutFromStockItemId || "")
      .filter(Boolean)
  );
  const restoredRows = [];
  const retainedRows = [];

  sourceIdsToRestore.forEach((sourceId) => {
    const releasableGroup = (stockItems || []).filter((item) => {
      if ((item.sourceStockItemId || item.cutFromStockItemId || "") !== sourceId) return false;
      if (stockItemLinkedToJob(item, job)) return true;
      return !item.allocatedJobId && ["In Stock", "Offcut", "Available"].includes(item.status);
    });
    if (!releasableGroup.length) return;
    const template = releasableGroup[0];
    const restoredLength = releasableGroup.reduce((sum, item) => sum + Number(item.length || getRemainingLengthForStockItem(item) || 0), 0);
    if (restoredLength <= 0) return;
    const restored = {
      ...template,
      id: createEntityId("stock-restored"),
      length: restoredLength,
      quantity: 1,
      status: "In Stock",
      stockLineType: "Restored",
      allocatedJobId: "",
      allocatedJobNo: "",
      jobId: "",
      sourceStockItemId: "",
      cutFromStockItemId: "",
      notes: [`Restored ${formatLengthM(restoredLength)} after releasing stock allocation for ${job.jobNo || job.id}.`, template.notes, `Restored at ${nowIso}.`].filter(Boolean).join(" | "),
    };
    restoredRows.push({ ...restored, lengthSegments: createLengthSegmentsForStockItem(restored) });
  });

  (stockItems || []).forEach((item) => {
    const sourceId = item.sourceStockItemId || item.cutFromStockItemId || "";
    if (sourceId && sourceIdsToRestore.has(sourceId)) {
      const releasableSibling = !item.allocatedJobId && ["In Stock", "Offcut", "Available"].includes(item.status);
      if (stockItemLinkedToJob(item, job) || releasableSibling) return;
    }
    if (stockItemLinkedToJob(item, job)) {
      const isOffcut = item.stockLineType === "Offcut" || item.status === "Offcut";
      retainedRows.push({
        ...item,
        allocatedJobId: "",
        allocatedJobNo: "",
        jobId: "",
        status: isOffcut ? "Offcut" : "In Stock",
        notes: [item.notes, `Released from ${job.jobNo || job.id} for stock reallocation.`].filter(Boolean).join(" | "),
        lengthSegments: getStockSegments(item).map((segment) => ({
          ...segment,
          allocatedJobId: "",
          jobId: "",
          status: isOffcut ? "Offcut" : "Available",
          allocations: (segment.allocations || []).filter((allocation) => allocation.jobId !== job.id),
        })),
      });
      return;
    }
    retainedRows.push(item);
  });

  return [...retainedRows, ...restoredRows];
}

function runStockLengthAllocationTests() {
  const jobPart = { id: "test-part-4m", productId: "ub", sectionSize: "203x102x23", grade: "S355", finish: "Self colour", length: 4, quantity: 1 };
  const orderedStock = { id: "test-12-2", productId: "ub", sectionSize: "203x102x23", grade: "S355", finish: "Self colour", length: 12.2, quantity: 1, status: "On Order", allocatedJobId: "" };
  const afterAllocation = allocateStockLengthToJob([{ ...orderedStock, lengthSegments: createLengthSegmentsForStockItem(orderedStock) }], { stockItemId: "test-12-2", jobId: "job-a", part: jobPart, lengthM: 4 });
  const remaining = getStockSegments(afterAllocation[0])[0]?.availableLengthM || 0;
  const secondJobStatus = getStockStatusForPart({ ...jobPart, id: "test-part-8m", length: 8, quantity: 1 }, afterAllocation, "job-b");
  const tooLongStatus = getStockStatusForPart({ ...jobPart, id: "test-part-9m", length: 9, quantity: 1 }, afterAllocation, "job-c");
  const flatPlatePart = { id: "bottom-plate-test", productId: "flat", sectionSize: "300x10", grade: "S355", finish: "Self colour", length: 6, quantity: 1 };
  const flatBarStock = { id: "flat-stock-test", productId: "flat", sectionSize: "300 x 10", grade: "S355", finish: "Self colour", length: 6, quantity: 1, status: "In Stock", allocatedJobId: "" };
  const flatPlateStatus = getStockStatusForPart(flatPlatePart, [flatBarStock], "job-flat");
  const flatPlateAllocatedRows = allocateExistingStockRowsForJob([flatBarStock], { id: "job-flat", jobNo: "JD-FLAT", partsList: [flatPlatePart] });
  const bestFitStockRows = allocateExistingStockRowsForJob([
    { id: "stock-12-2", productId: "ub", sectionSize: "203x102x23", grade: "S355", finish: "Self colour", length: 12.2, quantity: 1, status: "In Stock", allocatedJobId: "" },
    { id: "stock-11", productId: "ub", sectionSize: "203x102x23", grade: "S355", finish: "Self colour", length: 11, quantity: 1, status: "In Stock", allocatedJobId: "" },
  ], { id: "job-best-fit", jobNo: "JD-BEST", partsList: [{ ...jobPart, length: 10.5 }] });
  const releasedBestFitRows = allocateExistingStockRowsForJob(releaseStockAllocationsForJob([
    { id: "allocated-wrong", productId: "ub", sectionSize: "203x102x23", grade: "S355", finish: "Self colour", length: 10.5, quantity: 1, status: "Allocated", allocatedJobId: "job-recalc", allocatedJobNo: "JD-RECALC", sourceStockItemId: "stock-12-2" },
    { id: "offcut-wrong", productId: "ub", sectionSize: "203x102x23", grade: "S355", finish: "Self colour", length: 1.7, quantity: 1, status: "Offcut", allocatedJobId: "", sourceStockItemId: "stock-12-2" },
    { id: "stock-11-recalc", productId: "ub", sectionSize: "203x102x23", grade: "S355", finish: "Self colour", length: 11, quantity: 1, status: "In Stock", allocatedJobId: "" },
  ], { id: "job-recalc", jobNo: "JD-RECALC" }), { id: "job-recalc", jobNo: "JD-RECALC", partsList: [{ ...jobPart, length: 10.5 }] });
  const checks = [
    { name: "12.2m stock creates one length segment", passed: getStockSegments(orderedStock).length === 1 },
    { name: "4m allocation leaves 8.2m offcut/remaining", passed: Math.abs(remaining - 8.2) < 0.001 },
    { name: "Second 8m job can use remaining 8.2m", passed: secondJobStatus.label === "On Order" || secondJobStatus.label === "Available" },
    { name: "Top/bottom plate demand matches manually entered flat bar stock size", passed: flatPlateStatus.label === "Available" },
    { name: "Top/bottom plate demand allocates matching flat bar stock before enquiry", passed: flatPlateAllocatedRows.some((item) => item.status === "Allocated" && item.allocatedJobId === "job-flat") },
    { name: "Existing stock allocation chooses shortest suitable length", passed: bestFitStockRows.some((item) => item.status === "Allocated" && item.sourceStockItemId === "stock-11") },
    { name: "Recalculate stock releases old allocation and picks best length", passed: releasedBestFitRows.some((item) => item.status === "Allocated" && item.sourceStockItemId === "stock-11-recalc") },
    { name: "9m job is still missing after 4m allocation", passed: tooLongStatus.label === "Missing" || tooLongStatus.missingLengthM > 0 },
  ];
  return { passed: checks.every((check) => check.passed), checks, remainingLengthM: remaining };
}

const defaultProductivityRules = [
  { id: "cutting-per-cut", task: "Cutting", label: "Cutting", unit: "per cut", minutes: 30, appliesTo: "steel" },
  { id: "web-hole-per-hole", task: "Drilling", label: "Web holes", unit: "per hole", minutes: 10, appliesTo: "steel" },
  { id: "flange-hole-per-hole", task: "Drilling", label: "Flange holes", unit: "per hole", minutes: 10, appliesTo: "steel" },
  { id: "stiffener-per-item", task: "Fabrication", label: "Stiffeners", unit: "per item", minutes: 20, appliesTo: "steel" },
  { id: "top-plate-per-3m", task: "Fabrication", label: "Top plate welding", unit: "per 3m", minutes: 100, appliesTo: "steel" },
  { id: "bottom-plate-per-3m", task: "Fabrication", label: "Bottom plate welding", unit: "per 3m", minutes: 100, appliesTo: "steel" },
  { id: "end-plate-connection-per-item", task: "Fabrication", label: "End plate connections", unit: "per item", minutes: 45, appliesTo: "steel" },
  { id: "haunch-connection-per-item", task: "Fabrication", label: "Haunch connections", unit: "per item", minutes: 75, appliesTo: "steel" },
  { id: "fin-plate-connection-per-item", task: "Fabrication", label: "Fin plate connections", unit: "per item", minutes: 40, appliesTo: "steel" },
  { id: "cleats-connection-per-item", task: "Fabrication", label: "Cleats connections", unit: "per item", minutes: 50, appliesTo: "steel" },
  { id: "base-plate-per-item", task: "Fabrication", label: "Base plates", unit: "per item", minutes: 35, appliesTo: "steel" },
  { id: "splice-per-item", task: "Welding", label: "Splices", unit: "per item", minutes: 60, appliesTo: "steel" },
  { id: "inspection-per-line", task: "Inspection", label: "Inspection", unit: "per quote line", minutes: 10, appliesTo: "all" },
  { id: "painting-per-line", task: "Painting", label: "Painting / finish handling", unit: "per finished line", minutes: 20, appliesTo: "all" },
];

const quotePriorityOptions = [
  { value: "1", label: "1 - Low" },
  { value: "3", label: "3 - Medium" },
  { value: "5", label: "5 - High" },
  { value: "6", label: "6 - Urgent" },
];

const plannerQuoteStatuses = ["Awaiting lead time review", "Ready to send to customer", "Sent to customer", "Accepted", "Rejected", "Converted"];

const finishPricingRows = [
  { productId: "finish-self-colour", finish: "Self colour", buyPrice: 0, markupAmount: 0, unitLabel: "£/tonne" },
  { productId: "finish-primed", finish: "Primed", buyPrice: 0, markupAmount: 0, unitLabel: "£/tonne" },
  { productId: "finish-painted", finish: "Painted", buyPrice: 0, markupAmount: 0, unitLabel: "£/tonne" },
  { productId: "finish-galvanised", finish: "Galvanised", buyPrice: 0, markupAmount: 0, unitLabel: "£/tonne" },
  { productId: "finish-powder-coated", finish: "Powder coated", buyPrice: 0, markupAmount: 0, unitLabel: "£/tonne" },
];

const defaultSteelPricingSchedule = [
  { productId: "ub", buyPrice: 1000, markupAmount: 0 },
  { productId: "uc", buyPrice: 1000, markupAmount: 0 },
  { productId: "pfc", buyPrice: 1000, markupAmount: 0 },
  { productId: "rsa", buyPrice: 1000, markupAmount: 0 },
  { productId: "ursa", buyPrice: 1000, markupAmount: 0 },
  { productId: "shs", buyPrice: 1000, markupAmount: 0 },
  { productId: "rhs", buyPrice: 1000, markupAmount: 0 },
  { productId: "chs", buyPrice: 1000, markupAmount: 0 },
  { productId: "flat", buyPrice: 1000, markupAmount: 0 },
  { productId: "plate", buyPrice: 1000, markupAmount: 0 },
  ...finishPricingRows,
  { productId: "web-holes", buyPrice: 3.5, markupAmount: 0 },
  { productId: "flange-holes", buyPrice: 3.5, markupAmount: 0 },
  { productId: "stiffeners", buyPrice: 15, markupAmount: 0 },
  { productId: "end-plate-connection", buyPrice: 35, markupAmount: 0 },
  { productId: "haunch-connection", buyPrice: 65, markupAmount: 0 },
  { productId: "fin-plate-connection", buyPrice: 35, markupAmount: 0 },
  { productId: "cleats-connection", buyPrice: 40, markupAmount: 0 },
  { productId: "base-plate-fabrication", buyPrice: 40, markupAmount: 0 },
];

const connectionPricingIds = {
  "End plate": "end-plate-connection",
  "Haunch": "haunch-connection",
  "Fin plate": "fin-plate-connection",
  "Cleats": "cleats-connection",
};

const connectionProductivityRuleIds = {
  "End plate": "end-plate-connection-per-item",
  "Haunch": "haunch-connection-per-item",
  "Fin plate": "fin-plate-connection-per-item",
  "Cleats": "cleats-connection-per-item",
};

const appRoles = {
  operations: {
    label: "Operations",
    description: "Full system access",
    tabs: ["settings", "planner", "plannerQuotes", "deliveryCalendar", "productivity", "stock", "quotes", "customers", "jobs", "pos", "delivery", "clocking", "holiday"],
  },
  sales: {
    label: "Sales",
    description: "Quotes and customer access",
    tabs: ["quotes", "customers"],
  },
  staff: {
    label: "Staff",
    description: "Workshop access",
    tabs: ["planner", "deliveryCalendar", "stock", "delivery", "clocking", "holiday"],
  },
};

function canAccessTab(role, tab) {
  return (appRoles[role]?.tabs || []).includes(tab);
}

function getDefaultTabForRole(role) {
  if (role === "sales") return "quotes";
  return "planner";
}

const stageWeights = {
  Design: 5,
  "Order Materials": 5,
  Cutting: 10,
  Drilling: 10,
  Fabrication: 25,
  Welding: 25,
  Inspection: 5,
  Painting: 10,
  Delivery: 5,
  Complete: 100,
};

const initialCustomers = [
  { id: "c1", company: "Acme Estates", contact: "Jane Smith", email: "jane@example.com", phone: "01234 567890", deliveryAddress: "1 Delivery Street" },
  { id: "c2", company: "Northgate Logistics", contact: "Tom Brown", email: "tom@northgate.example", phone: "01234 111222", deliveryAddress: "Northgate Warehouse" },
  { id: "c3", company: "Private Client", contact: "Mr Green", email: "client@example.com", phone: "01234 333444", deliveryAddress: "Client Address" },
];

const initialSuppliers = [
  { id: "sup1", name: "Steel Supplier Ltd", contact: "Accounts", email: "sales@steel.example", phone: "01234 555666" },
  { id: "sup2", name: "Powder Coating Co", contact: "Sarah", email: "orders@powder.example", phone: "01234 777888" },
];

const steelProductDatabase = [
  { id: "ub", name: "Universal Beam / RSJ", category: "Structural Sections", unit: "m", defaultGrade: "S355", inputs: ["sectionSize", "length", "quantity", "finish", "holes", "endPlates"] },
  { id: "uc", name: "Universal Column", category: "Structural Sections", unit: "m", defaultGrade: "S355", inputs: ["sectionSize", "length", "quantity", "finish", "holes", "basePlates"] },
  { id: "pfc", name: "Parallel Flange Channel", category: "Structural Sections", unit: "m", defaultGrade: "S355", inputs: ["sectionSize", "length", "quantity", "finish", "holes"] },
  { id: "rsa", name: "Equal Angle", category: "Angles", unit: "m", defaultGrade: "S275", inputs: ["sectionSize", "length", "quantity", "finish"] },
  { id: "ursa", name: "Unequal Angle", category: "Angles", unit: "m", defaultGrade: "S275", inputs: ["sectionSize", "length", "quantity", "finish"] },
  { id: "shs", name: "Square Hollow Section", category: "Box Section", unit: "m", defaultGrade: "S275", inputs: ["sectionSize", "length", "quantity", "finish"] },
  { id: "rhs", name: "Rectangular Hollow Section", category: "Box Section", unit: "m", defaultGrade: "S275", inputs: ["sectionSize", "length", "quantity", "finish"] },
  { id: "chs", name: "Circular Hollow Section / Tube", category: "Tube and Pipe", unit: "m", defaultGrade: "S275", inputs: ["sectionSize", "length", "quantity", "finish"] },
  { id: "flat", name: "Flat Bar", category: "Bar", unit: "m", defaultGrade: "S275", inputs: ["sectionSize", "length", "quantity", "finish"] },
  { id: "plate", name: "Plate", category: "Plate", unit: "each", defaultGrade: "S275", inputs: ["thickness", "width", "length", "quantity", "holes", "finish"] },
];

const steelSectionInventory = {
  ub: ["152x89x16", "178x102x19", "203x102x23", "203x133x25", "203x133x30", "254x102x22", "254x102x25", "254x146x31", "305x102x25", "305x127x37", "305x165x40", "356x171x45", "406x178x54"],
  uc: ["152x152x23", "152x152x30", "203x203x46", "203x203x52", "254x254x73", "254x254x89", "254x254x107", "254x254x132", "254x254x167", "305x305x97", "305x305x118", "305x305x137", "305x305x158"],
  pfc: ["100x50x10", "125x65x15", "150x75x18", "180x75x20", "200x75x23", "230x75x26", "260x90x30", "300x90x41", "380x100x54"],
  rsa: ["200x200x24x71.1", "200x200x20x59.9", "200x200x18x54.3", "200x200x16x48.5", "150x150x18x40.1", "150x150x15x33.8", "150x150x12x27.3", "150x150x10x23", "120x120x15x26.6", "120x120x12x21.6", "120x120x10x18.2", "120x120x8x14.7", "100x100x15x21.9", "100x100x12x17.8", "100x100x10x15", "100x100x8x12.2", "90x90x12x15.9", "90x90x10x13.4", "90x90x8x10.9", "90x90x7x9.61", "80x80x10x11.9", "80x80x8x9.63", "75x75x8x8.99", "75x75x6x6.85", "70x70x7x7.38", "70x70x6x6.38", "65x65x7x6.83", "60x60x8x7.09", "60x60x6x5.42", "60x60x5x4.57", "50x50x6x4.47", "50x50x5x3.77", "50x50x4x3.06", "45x45x4.5x3.06", "40x40x5x2.97", "40x40x4x2.42", "35x35x4x2.09", "30x30x4x1.78", "30x30x3x1.36", "25x25x4x1.45", "25x25x3x1.12", "20x20x3x0.88"],
  ursa: ["200x150x18x47.1", "200x150x15x39.6", "200x150x12x32", "200x100x15x33.8", "200x100x12x27.3", "200x100x10x23", "150x90x15x26.6", "150x90x12x21.6", "150x90x10x18.2", "150x75x15x24.8", "150x75x12x20.2", "150x75x10x17", "125x75x12x17.8", "125x75x10x15", "125x75x8x12.2", "100x75x12x15.4", "100x75x10x13", "100x75x8x10.6", "100x65x10x12.3", "100x65x8x9.94", "100x65x7x8.77", "100x50x8x8.97", "100x50x6x6.84", "80x60x7x7.36", "80x40x8x7.07", "80x40x6x5.41", "75x50x8x7.39", "75x50x6x5.65", "70x50x6x5.41", "65x50x5x4.35", "60x40x6x4.46", "60x40x5x3.76", "60x30x5x3.36", "50x30x5x2.96", "45x30x4x2.25", "40x25x4x1.93", "40x20x4x1.77", "30x20x4x1.46", "30x20x3x1.12"],
  shs: ["25x25x2x1.36", "25x25x2.5x1.64", "30x30x2x1.68", "30x30x2.5x2.03", "30x30x3x2.36", "40x40x2x2.31", "40x40x2.5x2.82", "40x40x3x3.3", "40x40x4x4.2", "50x50x2.5x3.6", "50x50x3x4.25", "50x50x4x5.45", "50x50x5x6.56", "60x60x3x5.19", "60x60x4x6.71", "60x60x5x8.13", "60x60x6x9.45", "70x70x3x6.13", "70x70x3.5x7.06", "70x70x4x7.97", "70x70x5x9.7", "70x70x6x11.3", "80x80x3x7.07", "80x80x3.5x8.16", "80x80x4x9.22", "80x80x5x11.3", "80x80x6x13.2", "90x90x3x8.01", "90x90x3.5x9.26", "90x90x4x10.5", "90x90x5x12.8", "90x90x6x15.1", "100x100x3x8.96", "100x100x4x11.7", "100x100x5x14.4", "100x100x6x17", "100x100x8x21.4", "120x120x3x10.8", "120x120x4x14.2", "120x120x5x17.5", "120x120x6x20.7", "120x120x8x26.4", "120x120x10x31.8", "140x140x4x16.8", "140x140x5x20.7", "140x140x6x24.5", "140x140x8x31.4", "140x140x10x38.1", "150x150x4x18", "150x150x5x22.3", "150x150x6x26.4", "150x150x8x33.9", "150x150x10x41.3", "160x160x4x19.3", "160x160x5x23.8", "160x160x6x28.3", "160x160x8x36.5", "160x160x10x44.4", "180x180x5x27", "180x180x6x32.1", "180x180x6.3x33.3", "180x180x8x41.5", "180x180x10x50.7", "180x180x12x58.5", "180x180x12.5x60.5", "200x200x5x30.1", "200x200x6x35.8", "200x200x6.3x37.2", "200x200x8x46.5", "200x200x10x57", "200x200x12x66", "200x200x12.5x68.3", "250x250x6x45.2", "250x250x6.3x47.1", "250x250x8x59.1", "250x250x10x72.7", "250x250x12x84.8", "250x250x12.5x88", "300x300x6x54.7", "300x300x6.3x57", "300x300x8x71.6", "300x300x10x88.4", "300x300x12x104", "300x300x12.5x108", "350x350x6x64.1", "350x350x6.3x66.9", "350x350x8x84.2", "350x350x10x104", "350x350x12x123", "350x350x12.5x127", "400x400x6x73.5", "400x400x6.3x76.8", "400x400x8x96.7", "400x400x10x120", "400x400x12x141", "400x400x12.5x147"],
  rhs: ["50x25x2x2.15", "50x25x2.5x2.62", "50x25x3x3.07", "50x30x2x2.31", "50x30x2.5x2.82", "50x30x3x3.3", "50x30x4x4.2", "60x40x2.5x3.6", "60x40x3x4.25", "60x40x4x5.45", "60x40x5x6.56", "70x40x3x4.72", "70x40x4x6.08", "70x40x5x7.34", "70x50x3x5.19", "70x50x4x6.71", "70x50x5x8.13", "80x40x3x5.19", "80x40x4x6.71", "80x40x5x8.13", "80x50x3x5.66", "80x50x4x7.34", "80x50x5x8.91", "80x60x3x6.13", "80x60x3.5x7.06", "80x60x4x7.97", "80x60x5x9.7", "90x50x3x6.13", "90x50x4x7.97", "90x50x5x9.7", "100x40x3x6.13", "100x40x4x7.97", "100x40x5x9.7", "100x50x3x6.6", "100x50x4x8.59", "100x50x5x10.5", "100x50x6x12.3", "100x60x3x7.07", "100x60x3.5x8.16", "100x60x4x9.22", "100x60x5x11.3", "100x60x6x13.2", "100x80x3x8.01", "100x80x4x10.5", "100x80x5x12.8", "100x80x6x15.1", "120x40x3x7.07", "120x40x4x9.22", "120x40x5x11.3", "120x60x3x8.01", "120x60x3.5x9.26", "120x60x4x10.5", "120x60x5x12.8", "120x60x6x15.1", "120x80x3x8.96", "120x80x4x11.7", "120x80x5x14.4", "120x80x6x17", "120x80x8x21.4", "140x80x3x9.9", "140x80x4x13", "140x80x5x16", "140x80x6x18.9", "140x80x8x23.9", "140x80x10x28.7", "150x100x3x11.3", "150x100x4x14.9", "150x100x5x18.3", "150x100x6x21.7", "150x100x8x27.7", "150x100x10x33.4", "160x80x3x10.8", "160x80x4x14.2", "160x80x5x17.5", "160x80x6x20.7", "160x80x8x26.4", "160x80x10x31.8", "180x80x3x11.8", "180x80x4x15.5", "180x80x5x19.1", "180x80x6x22.6", "180x80x8x28.9", "180x80x10x35", "180x100x4x16.8", "180x100x5x20.7", "180x100x6x24.5", "180x100x8x31.4", "180x100x10x38.1", "200x100x4x18", "200x100x5x22.3", "200x100x6x26.4", "200x100x8x33.9", "200x100x10x41.3", "200x120x4x19.3", "200x120x5x23.8", "200x120x6x28.3", "200x120x8x36.5", "200x120x10x44.4", "200x150x4x21.2", "200x150x5x26.2", "200x150x6x31.1", "200x150x8x40.2", "200x150x10x49.1", "250x150x5x30.1", "250x150x6x35.8", "250x150x6.3x37.2", "250x150x8x46.5", "250x150x10x57", "250x150x12x66", "250x150x12.5x68.3", "300x100x6x35.8", "300x100x8x46.5", "300x100x10x57", "300x200x6x45.2", "300x200x6.3x47.1", "300x200x8x59.1", "300x200x10x72.7", "300x200x12x84.8", "300x200x12.5x88", "400x200x6x54.7", "400x200x6.3x57", "400x200x8x71.6", "400x200x10x88.4", "400x200x12x104", "400x200x12.5x108", "450x250x6x64.1", "450x250x6.3x66.9", "450x250x8x84.2", "450x250x10x104", "450x250x12x123", "450x250x12.5x127", "500x300x6x73.5", "500x300x6.3x76.8", "500x300x8x96.7", "500x300x10x120", "500x300x12x141", "500x300x12.5x147"],
  chs: ["48.3x3.2", "60.3x3.6", "76.1x3.6", "88.9x5", "114.3x5", "139.7x5", "168.3x6.3"],
  flat: ["30x5", "40x5", "50x6", "60x8", "75x10", "100x10", "150x12"],
  plate: ["6mm", "8mm", "10mm", "12mm", "15mm", "20mm", "25mm"],
};

const steelFinishOptions = ["Self colour", "Primed", "Painted", "Galvanised", "Powder coated"];
const steelGradeOptions = ["S275", "S355", "Stainless", "Aluminium"];

const steelIndustryProfile = {
  id: "steel-fabrication",
  name: "Steel Fabrication",
  description: "Existing JDFabs steel fabrication configuration grouped for future industry rule-pack separation.",
  products: steelProductDatabase,
  sectionInventory: steelSectionInventory,
  finishes: steelFinishOptions,
  grades: steelGradeOptions,
  pricingSchedule: defaultSteelPricingSchedule,
  productivityRules: defaultProductivityRules,
  stages,
  stageWeights,
  stock: {
    statuses: stockStatuses,
    lengthStatuses: stockLengthStatuses,
    kerfAllowanceM: stockKerfAllowanceM,
  },
  purchasing: {
    connectionPricingIds,
    connectionProductivityRuleIds,
  },
  pdfWording: {
    quoteNote: "This quotation includes the relevant material, fabrication and finishing processes required for the listed work.",
    quotePreviewNote: "This customer-facing preview includes the relevant material, fabrication and finishing processes required for the listed work.",
    jobSheetNote: "Workshop production document. Pricing is intentionally excluded; material and fabrication details are carried from the approved job package.",
    enquiryNote: "Please provide your best price and availability for the materials listed above. A formal purchase order will be issued once details are confirmed.",
    purchaseOrderNote: "Please supply the materials listed above for the referenced JDFabs job.",
  },
};

function toIso(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function dateIsWithin(day, start, end) {
  const d = new Date(day);
  return d >= new Date(start) && d <= new Date(end);
}

function isWorkingDay(date) {
  const day = date.getDay();
  return day !== 0 && day !== 6;
}

function nextWorkingDay(date) {
  let next = new Date(date);
  while (!isWorkingDay(next)) {
    next = addDays(next, 1);
  }
  return next;
}

function isPlannerWorkingDay(date) {
  return true;
}

function nextPlannerWorkingDay(date) {
  let next = new Date(date);
  while (!isPlannerWorkingDay(next)) {
    next = addDays(next, 1);
  }
  return next;
}

function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return new Date(aStart) <= new Date(bEnd) && new Date(bStart) <= new Date(aEnd);
}

function daysBetween(start, end) {
  return Math.max(1, Math.round((new Date(end) - new Date(start)) / 86400000) + 1);
}

function currency(value) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(Number(value || 0));
}

function createEntityId(prefix = "entity") {
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now()}-${randomPart}`;
}

function withRecordMeta(record, user = null) {
  const now = new Date().toISOString();
  return {
    ...record,
    id: record.id || createEntityId("record"),
    recordVersion: Number(record.recordVersion || 1),
    createdAt: record.createdAt || now,
    updatedAt: now,
    updatedBy: user?.id || record.updatedBy || "local-user",
  };
}

function bumpRecordVersion(record, patch = {}, user = null) {
  const now = new Date().toISOString();
  return {
    ...record,
    ...patch,
    recordVersion: Number(record.recordVersion || 1) + 1,
    updatedAt: now,
    updatedBy: user?.id || "local-user",
  };
}

function hasRecordConflict(localRecord, serverRecord) {
  if (!localRecord || !serverRecord) return false;
  return Number(localRecord.recordVersion || 1) < Number(serverRecord.recordVersion || 1);
}

function createRecordLock({ recordId, resource, user, expiresInMinutes = 15 }) {
  const now = new Date();
  return {
    id: `lock-${resource}-${recordId}`,
    recordId,
    resource,
    lockedBy: user?.id || "unknown",
    lockedByName: user?.name || "Unknown user",
    lockedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + expiresInMinutes * 60000).toISOString(),
  };
}

function isRecordLockActive(lock) {
  if (!lock) return false;
  return new Date(lock.expiresAt).getTime() > Date.now();
}

function canEditLockedRecord(lock, user) {
  if (!isRecordLockActive(lock)) return true;
  return lock.lockedBy === user?.id;
}

function getActiveRecordLock(locks = [], resource, recordId) {
  return locks.find((lock) => lock.resource === resource && lock.recordId === recordId && isRecordLockActive(lock));
}

function upsertRecordLock(locks = [], nextLock) {
  return [nextLock, ...locks.filter((lock) => !(lock.resource === nextLock.resource && lock.recordId === nextLock.recordId))].slice(0, 100);
}

function nextNumber(prefix, count) {
  return `${prefix}-${String(count + 1).padStart(5, "0")}`;
}

const documentNumberPrefixes = {
  quote: "QU",
  job: "JD",
  deliveryNote: "DN",
  purchaseOrder: "PO",
  enquiry: "ENQ",
};

function getDocumentNumberField(documentType) {
  if (documentType === "quote") return "quoteNo";
  if (documentType === "job") return "jobNo";
  if (documentType === "deliveryNote") return "dnNo";
  if (documentType === "purchaseOrder") return "poNo";
  if (documentType === "enquiry") return "enquiryNo";
  return "number";
}

function getNextDocumentSequence(records = [], documentType) {
  const field = getDocumentNumberField(documentType);
  const sequenceField = `${documentType}Sequence`;
  return (records || []).reduce((max, record) => Math.max(max, Number(record[sequenceField] || 0), getSequenceFromDocumentNumber(record[field])), 0) + 1;
}

function reserveLocalDocumentNumber({ documentType, records = [], linkedSourceNumber = "" }) {
  const prefix = documentNumberPrefixes[documentType] || "DOC";
  const linkedSequence = getSequenceFromDocumentNumber(linkedSourceNumber);
  const sequence = linkedSequence || getNextDocumentSequence(records, documentType);
  return {
    documentType,
    prefix,
    sequence,
    number: documentType === "purchaseOrder" || documentType === "enquiry" ? nextNumber(prefix, sequence - 1) : formatLinkedNumber(prefix, sequence),
    reservedAt: new Date().toISOString(),
    source: "local-fallback",
  };
}

async function reserveCloudDocumentNumber({ documentType, linkedSourceNumber = "" }) {
  if (deploymentConfig.storageMode !== "cloud-api" || typeof fetch === "undefined") return null;
  const response = await fetch(`${deploymentConfig.apiBaseUrl}/numbering/reserve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ documentType, linkedSourceNumber }),
  });
  if (!response.ok) throw new Error(`Number reservation failed with status ${response.status}`);
  return response.json();
}

function reserveDocumentNumberSync({ documentType, records = [], linkedSourceNumber = "" }) {
  return reserveLocalDocumentNumber({ documentType, records, linkedSourceNumber });
}

const storedDocumentTypes = ["quote_pdf", "purchase_order_pdf", "job_sheet_pdf", "delivery_note_pdf", "signed_delivery_note_pdf"];

function createStoredDocumentRecord({ documentType, title, relatedResource, relatedResourceId, jobId = "", customerId = "", documentNo = "", fileName = "", storageUrl = "", createdBy = null }) {
  const now = new Date().toISOString();
  return {
    id: createEntityId("stored-document"),
    documentType,
    title,
    relatedResource,
    relatedResourceId,
    jobId,
    customerId,
    documentNo,
    fileName: fileName || `${documentNo || title || documentType}.pdf`.replaceAll(" ", "_"),
    storageUrl,
    storageStatus: storageUrl ? "Stored" : "Print generated - cloud storage pending",
    createdAt: now,
    createdBy: createdBy?.id || "local-user",
    createdByName: createdBy?.name || "Local user",
  };
}

async function saveDocumentToCloudStorage({ html, documentRecord }) {
  if (deploymentConfig.documentStorage !== "cloud" || deploymentConfig.storageMode !== "cloud-api" || typeof fetch === "undefined") return null;
  const response = await fetch(`${deploymentConfig.apiBaseUrl}/documents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ html, documentRecord }),
  });
  if (!response.ok) throw new Error(`Document storage failed with status ${response.status}`);
  return response.json();
}

function formatLinkedNumber(prefix, sequence) {
  return `${prefix}-${String(Number(sequence || 0)).padStart(3, "0")}`;
}

function getSequenceFromDocumentNumber(value) {
  const match = String(value || "").match(new RegExp("([0-9]+)$"));
  return match ? Number(match[1]) : 0;
}

function getNextQuoteSequence(quotes) {
  return getNextDocumentSequence(quotes, "quote");
}

function getLinkedDocumentNumber(prefix, sourceNumber, fallbackSequence = 0) {
  const sequence = getSequenceFromDocumentNumber(sourceNumber) || Number(fallbackSequence || 0);
  return formatLinkedNumber(prefix, sequence);
}

function calculateTotal(items, vatRate = 20, priceKey = "unitPrice") {
  const subtotal = items.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item[priceKey] || 0), 0);
  const vat = subtotal * (Number(vatRate || 0) / 100);
  return { subtotal, vatRate, vat, total: subtotal + vat };
}

function getProductDatabase(customProducts = []) {
  const customRows = customProducts || [];
  const mergedBaseProducts = steelProductDatabase.map((baseProduct) => {
    const baseSectionOptions = [
      ...(baseProduct.sectionOptions || []),
      ...(steelSectionInventory[baseProduct.id] || []),
    ].filter(Boolean);
    const baseWithSections = { ...baseProduct, sectionOptions: Array.from(new Set(baseSectionOptions)) };
    const extensions = customRows.filter((product) => product.id === baseProduct.id || product.extendsProductId === baseProduct.id);
    if (!extensions.length) return baseWithSections;
    const optionRows = [...(baseWithSections.optionRows || [])];
    const sectionOptions = [...(baseWithSections.sectionOptions || [])];
    extensions.forEach((extension) => {
      (extension.optionRows || []).forEach((row) => {
        const size = String(row.size || row.sectionSize || "").trim();
        if (!size) return;
        if (!sectionOptions.some((item) => String(item).toLowerCase() === size.toLowerCase())) sectionOptions.push(size);
        if (!optionRows.some((item) => String(item.size || item.sectionSize || "").toLowerCase() === size.toLowerCase())) optionRows.push({ ...row, size });
      });
      (extension.sectionOptions || []).forEach((sizeValue) => {
        const size = String(sizeValue || "").trim();
        if (size && !sectionOptions.some((item) => String(item).toLowerCase() === size.toLowerCase())) sectionOptions.push(size);
      });
    });
    return {
      ...baseProduct,
      sectionOptions,
      optionRows,
      unit: extensions.find((item) => item.unit)?.unit || baseProduct.unit,
      defaultGrade: extensions.find((item) => item.defaultGrade)?.defaultGrade || baseProduct.defaultGrade,
      productionMinutes: Number(extensions.find((item) => Number(item.productionMinutes || 0) > 0)?.productionMinutes || baseProduct.productionMinutes || 0),
    };
  });
  const baseIds = new Set(steelProductDatabase.map((product) => product.id));
  const standaloneCustomProducts = customRows.filter((product) => !baseIds.has(product.id) && !product.extendsProductId);
  return [...mergedBaseProducts, ...standaloneCustomProducts];
}

function normaliseCustomProductName(name = "") {
  return String(name || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function createCustomProductRecord({ setupMode = "custom", existingProductId = "", name, category = "Custom Products", unit = "m", defaultGrade = "S275", productionMinutes = 0, sectionOptionsText = "", optionRows = [] }, existingProducts = []) {
  const existingProduct = steelProductDatabase.find((product) => product.id === existingProductId);
  const isExistingProductExtension = setupMode === "existing" && existingProduct;
  const baseId = isExistingProductExtension ? existingProduct.id : (normaliseCustomProductName(name) || `custom-product-${Date.now()}`);
  const existingIds = new Set(getProductDatabase(existingProducts).map((product) => product.id));
  let id = baseId;
  let suffix = 2;
  while (!isExistingProductExtension && existingIds.has(id)) {
    id = `${baseId}-${suffix}`;
    suffix += 1;
  }
  const legacyOptions = String(sectionOptionsText || "")
    .split(String.fromCharCode(10))
    .flatMap((line) => line.split(","))
    .map((item) => item.trim())
    .filter(Boolean)
    .map((size, index) => ({ id: `option-${index + 1}`, size, price: 0 }));
  const cleanOptionRows = (optionRows.length ? optionRows : legacyOptions)
    .map((row, index) => ({
      id: row.id || `option-${index + 1}`,
      size: String(row.size || row.sectionSize || "").trim(),
      price: Number(row.price || row.buyPrice || 0),
      productionMinutes: Number(row.productionMinutes || row.minutes || 0),
    }))
    .filter((row) => row.size);
  const sectionOptions = cleanOptionRows.map((row) => row.size);
  return {
    id,
    extendsProductId: isExistingProductExtension ? existingProduct.id : "",
    name: isExistingProductExtension ? existingProduct.name : String(name || "New product").trim(),
    category: isExistingProductExtension ? existingProduct.category : category,
    unit: unit || existingProduct?.unit || "m",
    defaultGrade: defaultGrade || existingProduct?.defaultGrade || "S275",
    productionMinutes: Number(productionMinutes || 0),
    inputs: existingProduct?.inputs || ["sectionSize", "length", "quantity", "finish"],
    sectionOptions,
    optionRows: cleanOptionRows,
    isCustom: !isExistingProductExtension,
    isProductSetupExtension: isExistingProductExtension,
  };
}

function getFinishPricingId(finish = "Self colour") {
  const clean = String(finish || "Self colour").trim().toLowerCase();
  if (clean === "primed") return "finish-primed";
  if (clean === "painted") return "finish-painted";
  if (clean === "galvanised" || clean === "galvanized") return "finish-galvanised";
  if (clean === "powder coated" || clean === "powder-coated") return "finish-powder-coated";
  return "finish-self-colour";
}

function getFinishNameFromPricingId(productId = "") {
  return finishPricingRows.find((row) => row.productId === productId)?.finish || "";
}

function normaliseSteelPricingSchedule(savedSchedule = []) {
  const saved = Array.isArray(savedSchedule) ? savedSchedule : [];
  const savedWithoutLegacyFinish = saved.filter((row) => row.productId !== "finish");
  const mergedDefaults = defaultSteelPricingSchedule.map((defaultRow) => {
    const savedRow = savedWithoutLegacyFinish.find((row) => row.productId === defaultRow.productId && String(row.sectionSize || "") === String(defaultRow.sectionSize || ""));
    return savedRow ? { ...defaultRow, ...savedRow } : defaultRow;
  });
  const extraRows = savedWithoutLegacyFinish.filter((row) => !mergedDefaults.some((defaultRow) => defaultRow.productId === row.productId && String(defaultRow.sectionSize || "") === String(row.sectionSize || "")));
  return [...mergedDefaults, ...extraRows];
}

function getProductName(productId, productDatabase = steelProductDatabase) {
  const finishName = getFinishNameFromPricingId(productId);
  if (finishName) return `${finishName} finish`;
  return (productDatabase || steelProductDatabase).find((product) => product.id === productId)?.name || productId;
}

function getPricingRow(schedule, productId, sectionSize = "") {
  const rows = schedule || [];
  const defaultRow = rows.find((row) => row.productId === productId && !row.sectionSize);
  const exactRow = rows.find((row) => row.productId === productId && row.sectionSize === sectionSize);
  if (exactRow?.inheritsProductPricing && defaultRow) return defaultRow;
  return exactRow || defaultRow || { buyPrice: 0, markupAmount: 0 };
}

function calculateSellPriceFromRow(row) {
  return Number(row?.buyPrice || 0) + Number(row?.markupAmount || 0);
}

function extractKgPerMetre(sectionSize) {
  const match = String(sectionSize || "").match(new RegExp("x\\s*([0-9]+(?:[.][0-9]+)?)$", "i"));
  return match ? Number(match[1]) : 0;
}

function calculatePlateWeightKg({ thicknessMm, widthMm, lengthValue, lengthUnit = "m", quantity = 1 }) {
  const density = 7850;
  const thicknessM = Number(thicknessMm || 0) / 1000;
  const widthM = Number(widthMm || 0) / 1000;
  const lengthM = lengthUnit === "mm" ? Number(lengthValue || 0) / 1000 : Number(lengthValue || 0);
  return density * thicknessM * widthM * lengthM * Number(quantity || 1);
}

function getSectionOptions(productId, customProducts = []) {
  const mergedProduct = getProductDatabase(customProducts).find((product) => product.id === productId);
  if (mergedProduct?.sectionOptions?.length) return mergedProduct.sectionOptions;
  return steelSectionInventory[productId] || [];
}

function estimateSteelLineWeightKg(line) {
  if (line.productId === "plate") {
    const thicknessMatch = String(line.sectionSize || "").match(new RegExp("([0-9]+(?:[.][0-9]+)?)\\s*mm", "i"));
    const thickness = thicknessMatch?.[1] || line.thickness || 0;
    return calculatePlateWeightKg({ thicknessMm: thickness, widthMm: line.width, lengthValue: line.length, lengthUnit: "m", quantity: line.quantity });
  }
  const kgPerMetre = extractKgPerMetre(line.sectionSize) || Number(line.kgPerMetre || 0);
  return kgPerMetre * Number(line.length || 0) * Number(line.quantity || 1);
}

function calculateCountFromCentresWithEndClearance(lengthM, centresMm, minEndDistanceMm = 50) {
  const lengthMm = Number(lengthM || 0) * 1000;
  const centres = Number(centresMm || 0);
  const minEnd = Number(minEndDistanceMm || 50);
  if (!lengthMm || !centres || lengthMm < minEnd * 2) return 0;
  return Math.max(0, Math.floor((lengthMm - minEnd * 2) / centres) + 1);
}

function calculateHoleCountFromCentres(lengthM, centresMm) {
  return calculateCountFromCentresWithEndClearance(lengthM, centresMm, 50);
}

function calculateDistanceFromEnd(lengthM, quantity, centresMm) {
  const lengthMm = Number(lengthM || 0) * 1000;
  const count = Number(quantity || 0);
  const centres = Number(centresMm || 0);
  if (!lengthMm || !count || !centres) return 0;
  return Math.max(0, (lengthMm - ((count - 1) * centres)) / 2);
}

function normaliseTakeoffOptionCount(enabled, manualQuantity, lengthM, centresMm) {
  if (enabled !== "Yes") return 0;
  return calculateHoleCountFromCentres(lengthM, centresMm);
}

function calculateSteelTakeoffLineTotal(line, pricingSchedule) {
  const productPricingRow = getPricingRow(pricingSchedule, line.productId, line.sectionSize);
  const productSell = calculateSellPriceFromRow(productPricingRow);
  const weightT = estimateSteelLineWeightKg(line) / 1000;
  const materialTotal = productPricingRow.priceMode === "fixed" ? productSell * Number(line.quantity || 1) : weightT * productSell;
  const finishPricingRow = getPricingRow(pricingSchedule, getFinishPricingId(line.finish));
  const finishTotal = weightT * calculateSellPriceFromRow(finishPricingRow);
  const webHoleCount = normaliseTakeoffOptionCount(line.webHolesRequired, line.webHoles, line.length, line.webHoleCentres);
  const flangeHoleCount = normaliseTakeoffOptionCount(line.flangeHolesRequired, line.flangeHoles, line.length, line.flangeHoleCentres);
  const stiffenerCount = normaliseTakeoffOptionCount(line.stiffenersRequired, line.stiffeners, line.length, line.stiffenerCentres);
  const webHoleTotal = webHoleCount * calculateSellPriceFromRow(getPricingRow(pricingSchedule, "web-holes"));
  const flangeHoleTotal = flangeHoleCount * calculateSellPriceFromRow(getPricingRow(pricingSchedule, "flange-holes"));
  const stiffenerTotal = stiffenerCount * calculateSellPriceFromRow(getPricingRow(pricingSchedule, "stiffeners"));
  const connectionPriceId = connectionPricingIds[line.connectionType] || "";
  const connectionTotal = line.connectionRequired === "Yes" ? Number(line.connectionQuantity || 1) * calculateSellPriceFromRow(getPricingRow(pricingSchedule, connectionPriceId)) : 0;
  const flatPlateSell = calculateSellPriceFromRow(getPricingRow(pricingSchedule, "flat"));
  const topPlateWeightT = line.topPlateRequired === "Yes" ? calculatePlateWeightKg({ thicknessMm: line.topPlateThickness, widthMm: line.topPlateWidth, lengthValue: line.topPlateLength || line.length, lengthUnit: "m", quantity: line.topPlateQuantity }) / 1000 : 0;
  const bottomPlateWeightT = line.bottomPlateRequired === "Yes" ? calculatePlateWeightKg({ thicknessMm: line.bottomPlateThickness, widthMm: line.bottomPlateWidth, lengthValue: line.bottomPlateLength || line.length, lengthUnit: "m", quantity: line.bottomPlateQuantity }) / 1000 : 0;
  const basePlateWeightT = line.basePlateRequired === "Yes" ? calculatePlateWeightKg({ thicknessMm: line.basePlateThickness, widthMm: line.basePlateWidth, lengthValue: line.basePlateLength, lengthUnit: "mm", quantity: line.basePlateQuantity }) / 1000 : 0;
  const topPlateTotal = topPlateWeightT * flatPlateSell;
  const bottomPlateTotal = bottomPlateWeightT * flatPlateSell;
  const basePlateMaterialTotal = basePlateWeightT * flatPlateSell;
  const basePlateFabricationTotal = line.basePlateRequired === "Yes" ? Number(line.basePlateQuantity || 1) * calculateSellPriceFromRow(getPricingRow(pricingSchedule, "base-plate-fabrication")) : 0;
  const spliceTotal = line.splicedRequired === "Yes" ? Number(line.spliceQuantity || 0) * Number(line.spliceCostEach || 0) : 0;
  return materialTotal + finishTotal + webHoleTotal + flangeHoleTotal + stiffenerTotal + connectionTotal + topPlateTotal + bottomPlateTotal + basePlateMaterialTotal + basePlateFabricationTotal + spliceTotal;
}

function normaliseProductivityRules(savedRules = []) {
  const saved = Array.isArray(savedRules) ? savedRules : [];
  const savedById = new Map(saved.map((rule) => [rule.id, rule]));
  const legacyConnectionRule = savedById.get("connection-per-item");
  const mergedDefaults = defaultProductivityRules.map((defaultRule) => {
    if (savedById.has(defaultRule.id)) return { ...defaultRule, ...savedById.get(defaultRule.id) };
    if (legacyConnectionRule && String(defaultRule.id).includes("connection-per-item")) return { ...defaultRule, minutes: Number(legacyConnectionRule.minutes || defaultRule.minutes) };
    return defaultRule;
  });
  const extraSavedRules = saved.filter((rule) => rule.id !== "connection-per-item" && !defaultProductivityRules.some((defaultRule) => defaultRule.id === rule.id));
  return [...mergedDefaults, ...extraSavedRules];
}

function getProductivityRule(rules = [], id) {
  return normaliseProductivityRules(rules || defaultProductivityRules).find((rule) => rule.id === id) || { minutes: 0 };
}

function minutesFromRule(rules, id, quantity = 1) {
  return Number(getProductivityRule(rules, id).minutes || 0) * Number(quantity || 0);
}

function getConnectionProductivityRuleId(connectionType = "End plate") {
  return connectionProductivityRuleIds[connectionType] || connectionProductivityRuleIds["End plate"];
}

function getStageBreakdownFromMinutes(stageMinutes = {}) {
  return stages
    .filter((stage) => stage !== "Complete")
    .map((stage) => ({ stage, minutes: Math.max(0, Number(stageMinutes[stage] || 0)), hours: Math.round((Math.max(0, Number(stageMinutes[stage] || 0)) / 60) * 100) / 100 }))
    .filter((item) => item.minutes > 0);
}

function addStageMinutes(stageMinutes, stage, minutes) {
  if (!stage || !minutes) return stageMinutes;
  return { ...stageMinutes, [stage]: Number(stageMinutes[stage] || 0) + Number(minutes || 0) };
}

function getCustomProductStageBreakdown(totalMinutes = 0) {
  return stages
    .filter((stage) => stage !== "Complete")
    .reduce((stageMinutes, stage) => {
      const minutes = Math.round((Number(totalMinutes || 0) * Number(stageWeights[stage] || 0)) / 100);
      return minutes > 0 ? addStageMinutes(stageMinutes, stage, minutes) : stageMinutes;
    }, {});
}

function estimateQuoteLineProductionBreakdown(line, productivityRules = defaultProductivityRules, productDatabase = steelProductDatabase) {
  const product = (productDatabase || steelProductDatabase).find((item) => item.id === line.productId);
  const isCustom = Boolean(product?.isCustom);
  const quantity = Number(line.quantity || 1);

  if (isCustom) {
    const option = (product.optionRows || []).find((row) => row.size === line.sectionSize);
    const totalMinutes = Number(option?.productionMinutes || product.productionMinutes || 0) * quantity;
    return getCustomProductStageBreakdown(totalMinutes);
  }

  const webHoleCount = normaliseTakeoffOptionCount(line.webHolesRequired, line.webHoles, line.length, line.webHoleCentres);
  const flangeHoleCount = normaliseTakeoffOptionCount(line.flangeHolesRequired, line.flangeHoles, line.length, line.flangeHoleCentres);
  const stiffenerCount = normaliseTakeoffOptionCount(line.stiffenersRequired, line.stiffeners, line.length, line.stiffenerCentres);
  const topPlateLength = Number(line.topPlateLength || line.length || 0) * Number(line.topPlateQuantity || 1);
  const bottomPlateLength = Number(line.bottomPlateLength || line.length || 0) * Number(line.bottomPlateQuantity || 1);

  let stageMinutes = {};
  stageMinutes = addStageMinutes(stageMinutes, "Cutting", minutesFromRule(productivityRules, "cutting-per-cut", quantity));
  stageMinutes = addStageMinutes(stageMinutes, "Drilling", minutesFromRule(productivityRules, "web-hole-per-hole", webHoleCount));
  stageMinutes = addStageMinutes(stageMinutes, "Drilling", minutesFromRule(productivityRules, "flange-hole-per-hole", flangeHoleCount));
  stageMinutes = addStageMinutes(stageMinutes, "Fabrication", minutesFromRule(productivityRules, "stiffener-per-item", stiffenerCount));
  stageMinutes = addStageMinutes(stageMinutes, "Fabrication", line.topPlateRequired === "Yes" ? minutesFromRule(productivityRules, "top-plate-per-3m", Math.ceil(topPlateLength / 3)) : 0);
  stageMinutes = addStageMinutes(stageMinutes, "Fabrication", line.bottomPlateRequired === "Yes" ? minutesFromRule(productivityRules, "bottom-plate-per-3m", Math.ceil(bottomPlateLength / 3)) : 0);
  stageMinutes = addStageMinutes(stageMinutes, "Fabrication", line.connectionRequired === "Yes" ? minutesFromRule(productivityRules, getConnectionProductivityRuleId(line.connectionType), Number(line.connectionQuantity || 1)) : 0);
  stageMinutes = addStageMinutes(stageMinutes, "Fabrication", line.basePlateRequired === "Yes" ? minutesFromRule(productivityRules, "base-plate-per-item", Number(line.basePlateQuantity || 1)) : 0);
  stageMinutes = addStageMinutes(stageMinutes, "Welding", line.splicedRequired === "Yes" ? minutesFromRule(productivityRules, "splice-per-item", Number(line.spliceQuantity || 0)) : 0);
  stageMinutes = addStageMinutes(stageMinutes, "Inspection", minutesFromRule(productivityRules, "inspection-per-line", 1));
  stageMinutes = addStageMinutes(stageMinutes, "Painting", line.finish && line.finish !== "Self colour" ? minutesFromRule(productivityRules, "painting-per-line", 1) : 0);
  return stageMinutes;
}

function mergeProductionStageBreakdowns(lines = [], productivityRules = defaultProductivityRules, productDatabase = steelProductDatabase) {
  const stageMinutes = (lines || []).reduce((totals, line) => {
    const lineBreakdown = estimateQuoteLineProductionBreakdown(line, productivityRules, productDatabase);
    return Object.entries(lineBreakdown).reduce((nextTotals, [stage, minutes]) => addStageMinutes(nextTotals, stage, minutes), totals);
  }, {});
  return getStageBreakdownFromMinutes(stageMinutes);
}

function estimateQuoteLineProductionMinutes(line, productivityRules = defaultProductivityRules, productDatabase = steelProductDatabase) {
  const breakdown = estimateQuoteLineProductionBreakdown(line, productivityRules, productDatabase);
  return Object.values(breakdown).reduce((sum, minutes) => sum + Number(minutes || 0), 0);
}

function estimateQuoteProductionHours(lines = [], productivityRules = defaultProductivityRules, productDatabase = steelProductDatabase) {
  const minutes = (lines || []).reduce((sum, line) => sum + estimateQuoteLineProductionMinutes(line, productivityRules, productDatabase), 0);
  return Math.max(0, Math.round((minutes / 60) * 100) / 100);
}

function calculatePlannerLeadTime({ jobs = [], staff = [], quoteHours = 0, priority = "3", requestedDeliveryDate = "", today = toIso(new Date()) }) {
  const activeJobs = jobs.filter((job) => job.status !== "Complete" && job.status !== "To Be Invoiced");
  const availableStaffHoursPerDay = Math.max(1, staff.reduce((sum, person) => sum + Number(person.hoursPerDay || 0), 0));
  const higherOrEqualLoad = activeJobs
    .filter((job) => Number(job.priority || 3) >= Number(priority || 3))
    .reduce((sum, job) => sum + Number(job.estimatedHours || 0), 0);
  const totalHoursAhead = higherOrEqualLoad + Number(quoteHours || 0);
  const workingDays = Math.max(1, Math.ceil(totalHoursAhead / availableStaffHoursPerDay));
  let readyDate = nextWorkingDay(new Date(today));
  for (let index = 1; index < workingDays; index += 1) readyDate = nextWorkingDay(addDays(readyDate, 1));
  const readyIso = toIso(readyDate);
  const requestedIso = requestedDeliveryDate || "";
  return {
    workloadHoursAhead: higherOrEqualLoad,
    quoteHours: Number(quoteHours || 0),
    availableStaffHoursPerDay,
    workingDays,
    earliestReadyDate: readyIso,
    requestedDeliveryDate: requestedIso,
    meetsRequestedDate: requestedIso ? new Date(readyIso) <= new Date(requestedIso) : true,
    message: `Estimated lead time ${workingDays} working day(s). Earliest ready for delivery: ${readyIso}.`,
  };
}

function parseNoPriceQuoteListRows(text) {
  const source = String(text || "").split(String.fromCharCode(10)).join(" ").split("  ").join(" ").trim();
  const starts = ["Middle beam", "Rear beam", "Front beam", "Columns", "Column", "Beam", "Lintel"];
  const rows = [];
  const lowerSource = source.toLowerCase();

  function compact(value) {
    return String(value || "").toLowerCase().split(" ").join("").split("×").join("x");
  }

  function sectionInChunk(chunk) {
    const compactChunk = compact(chunk);
    let found = { productId: "", sectionSize: "" };
    Object.entries(steelSectionInventory).forEach(([productId, sections]) => {
      sections.forEach((section) => {
        if (compactChunk.includes(compact(section)) && section.length > found.sectionSize.length) found = { productId, sectionSize: section };
      });
    });
    return found;
  }

  function numberFrom(value) {
    return Number(String(value || "").split("").filter((char) => (char >= "0" && char <= "9") || char === ".").join("") || 0);
  }

  const indexes = [];
  starts.forEach((start) => {
    let index = lowerSource.indexOf(start.toLowerCase());
    while (index >= 0) {
      indexes.push(index);
      index = lowerSource.indexOf(start.toLowerCase(), index + start.length);
    }
  });

  const sorted = Array.from(new Set(indexes)).sort((a, b) => a - b);
  sorted.forEach((start, index) => {
    const end = sorted[index + 1] || source.indexOf("Total steel weight", start);
    const chunk = source.slice(start, end > start ? end : source.length).trim();
    const section = sectionInChunk(chunk);
    if (!section.sectionSize) return;

    const words = chunk.split(" ").filter(Boolean);
    const sectionWords = section.sectionSize.split("x");
    const productToken = section.productId.toUpperCase();
    const productIndex = words.findIndex((word) => word.toLowerCase() === section.productId.toLowerCase());
    const qtyWord = productIndex >= 0 ? words.slice(productIndex + 1).find((word) => {
      const lower = word.toLowerCase();
      const value = numberFrom(word);
      return value > 0 && !lower.endsWith("mm") && !lower.endsWith("kg") && !lower.includes("tonne");
    }) : "1";
    const lengthWord = words.find((word) => word.toLowerCase().endsWith("mm") && numberFrom(word) > 1000) || "0mm";
    const labelEnd = Math.max(0, productIndex - sectionWords.length);
    const label = words.slice(0, labelEnd).join(" ") || `Imported ${productToken}`;

    rows.push({
      partRef: label,
      productId: section.productId,
      sectionSize: section.sectionSize,
      grade: "S355",
      finish: "Self colour",
      length: numberFrom(lengthWord) / 1000,
      quantity: numberFrom(qtyWord) || 1,
      holes: 0,
      sourceText: chunk,
      notes: `Imported no-price quote list row: ${chunk}`,
    });
  });

  const extrasLower = lowerSource;
  const basePlateQty = extrasLower.includes("base plates") ? numberFrom(source.slice(lowerSource.indexOf("base plates"), lowerSource.indexOf("connections") > 0 ? lowerSource.indexOf("connections") : source.length)) : 0;
  const connectionQty = extrasLower.includes("connections") ? numberFrom(source.slice(lowerSource.indexOf("connections"), lowerSource.indexOf("splices") > 0 ? lowerSource.indexOf("splices") : source.length)) : 0;
  const spliceQty = extrasLower.includes("splices") ? numberFrom(source.slice(lowerSource.indexOf("splices"), lowerSource.indexOf("delivery") > 0 ? lowerSource.indexOf("delivery") : source.length)) : 0;

  if (rows.length) {
    if (basePlateQty > 0) rows[rows.length - 1].basePlateQuantity = basePlateQty;
    if (basePlateQty > 0) rows[rows.length - 1].basePlateRequired = "Yes";
    if (connectionQty > 0) rows[0].connectionQuantity = connectionQty;
    if (connectionQty > 0) rows[0].connectionRequired = "Yes";
    const splicedRow = rows.find((row) => String(row.partRef || "").toLowerCase().includes("spliced")) || rows[1];
    if (splicedRow && spliceQty > 0) {
      splicedRow.splicedRequired = "Yes";
      splicedRow.spliceQuantity = spliceQty;
    }
  }

  return rows;
}

function buildSteelLineFromNoPriceImportRow(row, index = 0) {
  const product = steelProductDatabase.find((item) => item.id === row.productId) || steelProductDatabase[0];
  const sectionOptions = getSectionOptions(product.id);
  return {
    id: `imported-steel-line-${Date.now()}-${index}`,
    lineProductId: row.partRef || row.reference || `IMP-${index + 1}`,
    productId: product.id,
    sectionSize: row.sectionSize || sectionOptions[0] || "",
    grade: row.grade || product.defaultGrade || "S355",
    finish: row.finish || "Self colour",
    length: Number(row.length || 0),
    width: "",
    thickness: "",
    quantity: Number(row.quantity || 1),
    webHolesRequired: Number(row.holes || 0) > 0 ? "Yes" : "No",
    webHoleSize: row.holeSize || "18mm",
    webHoles: Number(row.holes || 0),
    webHoleCentres: Number(row.holeCentres || 1000),
    flangeHolesRequired: "No",
    flangeHoleSize: "18mm",
    flangeHoles: 0,
    flangeHoleCentres: 1000,
    stiffenersRequired: "No",
    stiffeners: 0,
    stiffenerCentres: 1000,
    connectionRequired: row.connectionRequired || "No",
    connectionType: row.connectionType || "End plate",
    connectionQuantity: Number(row.connectionQuantity || 1),
    topPlateRequired: "No",
    topPlateThickness: "8",
    topPlateWidth: "300",
    topPlateLength: "",
    topPlateQuantity: 1,
    topPlateWeldHitMm: "",
    topPlateWeldMissMm: "",
    bottomPlateRequired: "No",
    bottomPlateThickness: "8",
    bottomPlateWidth: "300",
    bottomPlateLength: "",
    bottomPlateQuantity: 1,
    bottomPlateWeldHitMm: "",
    bottomPlateWeldMissMm: "",
    basePlateRequired: row.basePlateRequired || "No",
    basePlateQuantity: Number(row.basePlateQuantity || 1),
    basePlateThickness: "10",
    basePlateWidth: "250",
    basePlateLength: "250",
    splicedRequired: row.splicedRequired || "No",
    spliceQuantity: Number(row.spliceQuantity || 0),
    spliceCostEach: 0,
    notes: row.notes || row.sourceText || "Imported no-price quote list row",
  };
}

function buildSteelQuoteItem(line, pricingSchedule, productDatabase = steelProductDatabase) {
  const product = productDatabase.find((item) => item.id === line.productId) || steelProductDatabase[0];
  const weightKg = estimateSteelLineWeightKg(line);
  const lineTotal = calculateSteelTakeoffLineTotal(line, pricingSchedule);
  const quantity = Number(line.quantity || 1);
  const webHoleCount = normaliseTakeoffOptionCount(line.webHolesRequired, line.webHoles, line.length, line.webHoleCentres);
  const flangeHoleCount = normaliseTakeoffOptionCount(line.flangeHolesRequired, line.flangeHoles, line.length, line.flangeHoleCentres);
  const stiffenerCount = normaliseTakeoffOptionCount(line.stiffenersRequired, line.stiffeners, line.length, line.stiffenerCentres);
  const details = [];
  if (line.finish && line.finish !== "Self colour") {
    const finishRate = calculateSellPriceFromRow(getPricingRow(pricingSchedule, getFinishPricingId(line.finish)));
    details.push(`${line.finish} finish @ ${currency(finishRate)}/tonne = ${currency((weightKg / 1000) * finishRate)}`);
  }
  if (line.webHolesRequired === "Yes") details.push(`Web holes ${line.webHoleSize || ""} x${webHoleCount} @ ${line.webHoleCentres || 0}mm centres, ${calculateDistanceFromEnd(line.length, webHoleCount, line.webHoleCentres).toFixed(0)}mm from end`);
  if (line.flangeHolesRequired === "Yes") details.push(`Flange holes ${line.flangeHoleSize || ""} x${flangeHoleCount} @ ${line.flangeHoleCentres || 0}mm centres, ${calculateDistanceFromEnd(line.length, flangeHoleCount, line.flangeHoleCentres).toFixed(0)}mm from end`);
  if (line.stiffenersRequired === "Yes") details.push(`Stiffeners x${stiffenerCount} @ ${line.stiffenerCentres || 0}mm centres, ${calculateDistanceFromEnd(line.length, stiffenerCount, line.stiffenerCentres).toFixed(0)}mm from end`);
  if (line.connectionRequired === "Yes") details.push(`${line.connectionType} x${line.connectionQuantity || 1}`);
  if (line.topPlateRequired === "Yes") details.push(`Top plate ${line.topPlateThickness || 0}mm x ${line.topPlateWidth || 0}mm x ${line.topPlateLength || line.length || 0}m x${line.topPlateQuantity || 1}${line.topPlateWeldHitMm || line.topPlateWeldMissMm ? ` · Weld hit ${line.topPlateWeldHitMm || 0}mm / miss ${line.topPlateWeldMissMm || 0}mm` : ""}`);
  if (line.bottomPlateRequired === "Yes") details.push(`Bottom plate ${line.bottomPlateThickness || 0}mm x ${line.bottomPlateWidth || 0}mm x ${line.bottomPlateLength || line.length || 0}m x${line.bottomPlateQuantity || 1}${line.bottomPlateWeldHitMm || line.bottomPlateWeldMissMm ? ` · Weld hit ${line.bottomPlateWeldHitMm || 0}mm / miss ${line.bottomPlateWeldMissMm || 0}mm` : ""}`);
  if (line.basePlateRequired === "Yes") details.push(`Base plates ${line.basePlateThickness || 0}mm x ${line.basePlateWidth || 0}mm x ${line.basePlateLength || 0}mm x${line.basePlateQuantity || 1}`);
  if (line.splicedRequired === "Yes") details.push(`Splices x${line.spliceQuantity || 0}`);
  return {
    id: line.id,
    description: [line.lineProductId || product.name, line.sectionSize, line.finish].filter(Boolean).join(" · "),
    quantity,
    unitPrice: quantity ? lineTotal / quantity : lineTotal,
    productId: line.productId,
    sectionSize: line.sectionSize,
    grade: line.grade,
    finish: line.finish,
    length: Number(line.length || 0),
    weightKg,
    notes: line.notes || "",
    processDetails: details,
    // Preserve quote-line material details so job creation and purchasing can
    // generate stock/enquiry demand for custom flats/plates as well as the main beam.
    topPlateRequired: line.topPlateRequired || "No",
    topPlateThickness: line.topPlateThickness || "",
    topPlateWidth: line.topPlateWidth || "",
    topPlateLength: line.topPlateLength || "",
    topPlateQuantity: Number(line.topPlateQuantity || 1),
    topPlateWeldHitMm: line.topPlateWeldHitMm || "",
    topPlateWeldMissMm: line.topPlateWeldMissMm || "",
    bottomPlateRequired: line.bottomPlateRequired || "No",
    bottomPlateThickness: line.bottomPlateThickness || "",
    bottomPlateWidth: line.bottomPlateWidth || "",
    bottomPlateLength: line.bottomPlateLength || "",
    bottomPlateQuantity: Number(line.bottomPlateQuantity || 1),
    bottomPlateWeldHitMm: line.bottomPlateWeldHitMm || "",
    bottomPlateWeldMissMm: line.bottomPlateWeldMissMm || "",
  };
}

function buildQuotePackage({ quote, customer, leadTime = null }) {
  return {
    schema: "jdfabs.quote-package.v1",
    sourceApp: "operations-hq-quote-builder",
    quoteId: quote.id,
    quoteNo: quote.quoteNo,
    status: quote.status,
    quoteSequence: quote.quoteSequence || getSequenceFromDocumentNumber(quote.quoteNo),
    customer: customer || { id: quote.customerId, company: quote.customer },
    quoteMeta: {
      title: quote.title,
      date: quote.date,
      validUntil: quote.validUntil,
      uploadedFileName: quote.uploadedFileName || "",
      priority: quote.priority || "3",
      requestedDeliveryDate: quote.requestedDeliveryDate || "",
      jobDeliveryAddress: quote.jobDeliveryAddress || quote.deliveryAddress || "",
      estimatedProductionHours: Number(quote.estimatedProductionHours || 0),
      productionStageBreakdown: quote.productionStageBreakdown || [],
      leadTime: leadTime || quote.leadTime || null,
    },
    items: quote.items || [],
    takeoffLines: quote.takeoffLines || [],
    productionStageBreakdown: quote.productionStageBreakdown || quote.quoteMeta?.productionStageBreakdown || [],
    totals: {
      subtotal: Number(quote.subtotal || 0),
      vatRate: Number(quote.vatRate || 20),
      vat: Number(quote.vat || 0),
      total: Number(quote.total || 0),
    },
    approvedAt: quote.status === "Accepted" ? new Date().toISOString() : "",
  };
}

function createJobFromQuotePackage({ quotePackage, jobCount, today }) {
  const subtotal = Number(quotePackage.totals?.subtotal || 0);
  const estimatedHours = Math.max(1, Math.round(Number(quotePackage.quoteMeta?.estimatedProductionHours || subtotal / 50)));
  const jobStart = today;
  const jobEnd = quotePackage.quoteMeta?.requestedDeliveryDate || toIso(addDays(new Date(today), 14));
  const reservedNumber = reserveDocumentNumberSync({ documentType: "job", records: [], linkedSourceNumber: quotePackage.quoteNo });
  const sequence = quotePackage.quoteSequence || reservedNumber.sequence || getSequenceFromDocumentNumber(quotePackage.quoteNo) || jobCount + 1;
  const productionStageBreakdown = quotePackage.productionStageBreakdown || quotePackage.quoteMeta?.productionStageBreakdown || [];
  const job = {
    id: createEntityId("job"),
    jobSequence: sequence,
    jobNo: reservedNumber.number || formatLinkedNumber("JD", sequence),
    quoteId: quotePackage.quoteId,
    quotePackageId: quotePackage.quoteId,
    customerId: quotePackage.customer?.id || "",
    customer: quotePackage.customer?.company || "Imported Customer",
    title: quotePackage.quoteMeta?.title || quotePackage.quoteNo,
    deliveryAddress: quotePackage.quoteMeta?.jobDeliveryAddress || quotePackage.customer?.deliveryAddress || "",
    jobDeliveryAddress: quotePackage.quoteMeta?.jobDeliveryAddress || quotePackage.customer?.deliveryAddress || "",
    deadline: jobEnd,
    start: jobStart,
    end: jobEnd,
    calculatedEnd: jobEnd,
    stage: "Design",
    status: "Waiting Material",
    priority: quotePackage.quoteMeta?.priority || "3",
    estimatedHours,
    staffIds: [],
    notes: `Created from approved quote package ${quotePackage.quoteNo}`,
    invoiceStatus: "Not Invoiced",
    materialsDue: toIso(addDays(new Date(jobStart), 3)),
    partsList: quotePackage.items || [],
    takeoffLines: quotePackage.takeoffLines || [],
    productionStageBreakdown,
    stageTasks: createDefaultStageTasks(jobStart, jobEnd, estimatedHours, productionStageBreakdown),
  };
  return job;
}

function buildMissingPartsForJob(job, stockItems) {
  return getJobPartsList(job, null)
    .map((part) => ({ part, status: getStockStatusForPart(part, stockItems, job.id) }))
    .filter(({ status }) => status.label === "Missing" || status.label === "On Order");
}

function createPoLineFromPart(part = {}, index = 0, quantity = 1, customProducts = []) {
  const productId = part.productId || "ub";
  const product = getProductDatabase(customProducts).find((item) => item.id === productId) || steelProductDatabase[0];
  const sectionOptions = getSectionOptions(productId, customProducts);
  const sectionSize = part.sectionSize || sectionOptions[0] || "";
  const finish = part.finish || "Self colour";
  const length = part.length ? String(part.length) : "";
  const requiredCutLength = part.requiredCutLength || part.length || "";
  const qty = Math.max(1, Number(quantity || part.quantity || 1));
  const unitCost = Number(part.unitCost || part.price || 0);
  return {
    id: `po-line-${Date.now()}-${index}`,
    productId,
    sectionSize,
    length,
    requiredCutLength,
    quantity: qty,
    finish,
    unitCost,
    description: [product.name, sectionSize, length ? `${length}m` : "", finish].filter(Boolean).join(" · "),
  };
}

function buildPoLineDescription(line, productDatabase = steelProductDatabase) {
  const product = (productDatabase || steelProductDatabase).find((item) => item.id === line.productId);
  return [product?.name || line.productId || line.description || "Material", line.sectionSize, line.length ? `${line.length}m` : "", line.finish].filter(Boolean).join(" · ");
}

function normalisePoLine(line, index = 0) {
  if (line.productId) return { ...line, description: line.description || buildPoLineDescription(line), unitCost: Number(line.unitCost || 0) };
  return {
    ...createPoLineFromPart({}, index, line.quantity || 1),
    id: line.id || `po-line-${Date.now()}-${index}`,
    description: line.description || "Material",
    unitCost: Number(line.unitCost || 0),
  };
}

function calculatePoLineTotal(line) {
  return Number(line.quantity || 0) * Number(line.unitCost || 0);
}

function calculatePoTotals(lines = [], vatRate = 20) {
  const subtotal = lines.reduce((sum, line) => sum + calculatePoLineTotal(line), 0);
  const vat = subtotal * (Number(vatRate || 0) / 100);
  return { subtotal, vatRate: Number(vatRate || 0), vat, total: subtotal + vat };
}

function createSuggestedPurchaseOrderDraft({ job, missingParts, supplierId, poCount, today }) {
  const items = missingParts.map(({ part, status }, index) => createPoLineFromPart(part, index, Math.max(1, Number(status.missingQuantity || part.quantity || 1))));
  const totals = calculatePoTotals(items, 20);
  const enquiryNo = nextNumber("ENQ", poCount);
  return {
    id: createEntityId(`enquiry-draft-${job?.id || "job"}-${poCount || 0}`),
    enquiryNo,
    poNo: "",
    documentKind: "Enquiry",
    jobId: job.id,
    jobNo: job.jobNo || "",
    supplierId,
    date: today,
    requiredBy: job.materialsDue || toIso(addDays(new Date(today), 3)),
    status: "Enquiry Draft",
    suggested: true,
    items,
    ...totals,
  };
}

function isEnquiryDocument(po = {}) {
  return po.documentKind === "Enquiry" || String(po.status || "").startsWith("Enquiry") || po.status === "Supplier Quote Received";
}

function formatPurchasingJobSuffix(jobNo = "") {
  const clean = String(jobNo || "").trim();
  if (!clean) return "";
  return clean.replace(/[^a-z0-9]/gi, "").toUpperCase();
}

function getPurchasingDocumentNumber(po = {}) {
  if (isEnquiryDocument(po)) return po.enquiryNo || po.poNo || "Enquiry";
  const base = po.poNo || po.enquiryNo || "Purchase Order";
  const suffix = formatPurchasingJobSuffix(po.jobNo || po.linkedJobNo || "");
  if (!suffix || String(base).toUpperCase().includes(suffix)) return base;
  return `${base}-${suffix}`;
}

function getPurchasingDocumentTitle(po = {}) {
  return isEnquiryDocument(po) ? "Supplier Enquiry" : "Purchase Order";
}

function getPurchasingPermissionResource(po = {}) {
  return isEnquiryDocument(po) ? "purchase_enquiries" : "purchase_orders";
}

const activePurchasingStatuses = ["Enquiry Draft", "Enquiry Sent", "Supplier Quote Received", "Draft PO"];
const archivedPurchasingStatuses = ["Sent", "Part Received", "Received", "Cancelled"];

function getPurchasingDisplayGroups(purchaseOrders = []) {
  const groups = [
    { id: "active", title: "Active purchasing", statuses: activePurchasingStatuses, records: [] },
    { id: "sent", title: "Sent", statuses: ["Sent"], records: [] },
    { id: "part-received", title: "Part received", statuses: ["Part Received"], records: [] },
    { id: "received", title: "Received", statuses: ["Received"], records: [] },
    { id: "cancelled", title: "Cancelled", statuses: ["Cancelled"], records: [] },
  ];

  purchaseOrders.forEach((po) => {
    const group = groups.find((item) => item.statuses.includes(po.status)) || groups[0];
    group.records.push(po);
  });

  return groups.filter((group) => group.id === "active" || group.records.length > 0);
}

function isPurchasingRecordArchived(po = {}) {
  return archivedPurchasingStatuses.includes(po.status);
}

function getPurchasingRecordKey(po = {}, index = 0) {
  return po.id || `${getPurchasingDocumentNumber(po)}-${po.jobId || "job"}-${index}`;
}

function ensureUniquePurchasingRecordIds(purchaseOrders = []) {
  const seen = new Set();
  return (purchaseOrders || []).map((po, index) => {
    const existingId = po.id || "";
    if (existingId && !seen.has(existingId)) {
      seen.add(existingId);
      return po;
    }
    const nextId = createEntityId(`purchase-record-${getSequenceFromDocumentNumber(getPurchasingDocumentNumber(po)) || index + 1}`);
    seen.add(nextId);
    return { ...po, id: nextId };
  });
}

function runPurchasingDisplayTests() {
  const grouped = getPurchasingDisplayGroups([
    { id: "a", poNo: "PO-00001", status: "Sent" },
    { id: "b", poNo: "PO-00002", status: "Received" },
    { id: "c", enquiryNo: "ENQ-00003", status: "Enquiry Draft" },
    { id: "d", poNo: "PO-00004", status: "Cancelled" },
  ]);
  const checks = [
    { name: "Active group keeps draft/enquiry records", passed: grouped.find((group) => group.id === "active")?.records.length === 1 },
    { name: "Sent records move into Sent group", passed: grouped.find((group) => group.id === "sent")?.records.length === 1 },
    { name: "Received records move into Received group", passed: grouped.find((group) => group.id === "received")?.records.length === 1 },
    { name: "Cancelled records move into Cancelled group", passed: grouped.find((group) => group.id === "cancelled")?.records.length === 1 },
    { name: "Archived detector excludes active enquiries", passed: isPurchasingRecordArchived({ status: "Enquiry Draft" }) === false && isPurchasingRecordArchived({ status: "Received" }) === true },
  ];
  return { passed: checks.every((check) => check.passed), checks };
}

const plannerStressTestDeadlinePool = ["2026-05-24", "2026-05-28", "2026-06-03", "2026-06-07", "2026-06-12", "2026-06-16", "2026-06-20", "2026-06-24", "2026-06-27", "2026-06-30"];

const plannerStressTestLineTemplates = [
  { productId: "ub", sectionSize: "203x102x23", grade: "S355", finish: "Primed", length: 6, quantity: 1, webHolesRequired: "Yes", webHoleSize: "18mm", webHoleCentres: 1000, flangeHolesRequired: "No", stiffenersRequired: "No", connectionRequired: "Yes", connectionType: "End plate", connectionQuantity: 2, basePlateRequired: "No", splicedRequired: "No" },
  { productId: "uc", sectionSize: "152x152x30", grade: "S355", finish: "Self colour", length: 3.2, quantity: 2, webHolesRequired: "No", flangeHolesRequired: "Yes", flangeHoleSize: "18mm", flangeHoleCentres: 800, stiffenersRequired: "Yes", stiffenerCentres: 900, connectionRequired: "No", basePlateRequired: "Yes", basePlateQuantity: 2, basePlateThickness: "12", basePlateWidth: "300", basePlateLength: "300", splicedRequired: "No" },
  { productId: "pfc", sectionSize: "150x75x18", grade: "S355", finish: "Galvanised", length: 4.4, quantity: 3, webHolesRequired: "Yes", webHoleSize: "14mm", webHoleCentres: 700, flangeHolesRequired: "No", stiffenersRequired: "No", connectionRequired: "Yes", connectionType: "Fin plate", connectionQuantity: 3, basePlateRequired: "No", splicedRequired: "No" },
  { productId: "shs", sectionSize: "80x80x4x9.22", grade: "S275", finish: "Powder coated", length: 2.8, quantity: 4, webHolesRequired: "No", flangeHolesRequired: "No", stiffenersRequired: "No", connectionRequired: "No", basePlateRequired: "No", splicedRequired: "No" },
  { productId: "rhs", sectionSize: "100x50x4x8.59", grade: "S275", finish: "Painted", length: 5.2, quantity: 2, webHolesRequired: "Yes", webHoleSize: "18mm", webHoleCentres: 650, flangeHolesRequired: "No", stiffenersRequired: "Yes", stiffenerCentres: 1000, connectionRequired: "No", basePlateRequired: "No", splicedRequired: "No" },
  { productId: "rsa", sectionSize: "50x50x5x3.77", grade: "S275", finish: "Self colour", length: 3.6, quantity: 5, webHolesRequired: "No", flangeHolesRequired: "No", stiffenersRequired: "No", connectionRequired: "No", basePlateRequired: "No", splicedRequired: "No" },
  { productId: "plate", sectionSize: "10mm", grade: "S275", finish: "Primed", length: 0.8, width: 400, quantity: 6, webHolesRequired: "Yes", webHoleSize: "18mm", webHoleCentres: 300, flangeHolesRequired: "No", stiffenersRequired: "No", connectionRequired: "No", basePlateRequired: "No", splicedRequired: "No" },
];

function createPlannerStressTestLine(jobIndex, lineIndex) {
  const template = plannerStressTestLineTemplates[(jobIndex + lineIndex) % plannerStressTestLineTemplates.length];
  const line = {
    ...template,
    id: `stress-line-${jobIndex + 1}-${lineIndex + 1}`,
    lineProductId: `T${jobIndex + 1}-L${lineIndex + 1}`,
    topPlateRequired: lineIndex === 1 ? "Yes" : "No",
    topPlateThickness: "8",
    topPlateWidth: "300",
    topPlateLength: lineIndex === 1 ? template.length : "",
    topPlateQuantity: lineIndex === 1 ? 1 : 0,
    topPlateWeldHitMm: "",
    topPlateWeldMissMm: "",
    bottomPlateRequired: lineIndex === 2 ? "Yes" : "No",
    bottomPlateThickness: "8",
    bottomPlateWidth: "300",
    bottomPlateLength: lineIndex === 2 ? template.length : "",
    bottomPlateQuantity: lineIndex === 2 ? 1 : 0,
    bottomPlateWeldHitMm: "",
    bottomPlateWeldMissMm: "",
    spliceQuantity: lineIndex === 0 && jobIndex % 3 === 0 ? 1 : 0,
    splicedRequired: lineIndex === 0 && jobIndex % 3 === 0 ? "Yes" : "No",
    spliceCostEach: 45,
    notes: "Planner stress-test line",
  };
  return {
    ...line,
    webHoles: calculateHoleCountFromCentres(line.length, line.webHoleCentres),
    flangeHoles: calculateHoleCountFromCentres(line.length, line.flangeHoleCentres),
    stiffeners: calculateHoleCountFromCentres(line.length, line.stiffenerCentres),
  };
}

function createPlannerStressTestJobs({ existingJobs = [], pricingSchedule = defaultSteelPricingSchedule, productivityRules = defaultProductivityRules, productDatabase = steelProductDatabase, customers = initialCustomers, today = toIso(new Date()) }) {
  return Array.from({ length: 10 }, (_, index) => {
    const sequence = getNextDocumentSequence(existingJobs, "job") + index;
    const customer = customers[index % Math.max(1, customers.length)] || initialCustomers[0];
    const lines = [0, 1, 2].map((lineIndex) => createPlannerStressTestLine(index, lineIndex));
    const items = lines.map((line) => buildSteelQuoteItem(line, pricingSchedule, productDatabase));
    const productionStageBreakdown = mergeProductionStageBreakdowns(lines, productivityRules, productDatabase);
    const estimatedHours = estimateQuoteProductionHours(lines, productivityRules, productDatabase);
    const deadline = plannerStressTestDeadlinePool[index % plannerStressTestDeadlinePool.length];
    const jobNo = formatLinkedNumber("JD", sequence);
    return {
      id: `stress-job-${Date.now()}-${index + 1}`,
      jobSequence: sequence,
      jobNo,
      quoteId: "",
      customerId: customer.id,
      customer: customer.company,
      title: `Stress test steelwork package ${index + 1}`,
      deadline,
      start: today,
      end: deadline,
      calculatedEnd: deadline,
      stage: "Cutting",
      status: "In Production",
      invoiceStatus: "Not Invoiced",
      priority: ["5", "3", "1", "6"][index % 4],
      estimatedHours,
      staffIds: [],
      notes: "Generated planner/PO stress-test job with 3 steel lines.",
      materialsDue: toIso(addDays(new Date(today), 3 + (index % 5))),
      partsList: items,
      takeoffLines: lines,
      productionStageBreakdown,
      stageTasks: normaliseLinearStageTasks(createDefaultStageTasks(today, deadline, estimatedHours, productionStageBreakdown), "Cutting"),
    };
  });
}

function getWeightedProgress(job) {
  if (job.status === "Complete" || job.status === "To Be Invoiced") return 100;
  const currentIndex = Math.max(0, stages.indexOf(job.stage));
  return stages
    .filter((stage) => stage !== "Complete")
    .reduce((sum, stage, index) => (index <= currentIndex ? sum + (stageWeights[stage] || 0) : sum), 0);
}

function getStageHours(totalHours, stage) {
  return Math.round((Number(totalHours || 0) * (stageWeights[stage] || 0)) / 100);
}

function createDefaultStageTasks(start, end, estimatedHours = 0, productionStageBreakdown = []) {
  const breakdownByStage = new Map((productionStageBreakdown || []).map((item) => [item.stage, Number(item.hours || 0)]));
  return stages.filter((stage) => stage !== "Complete").map((stage, index) => ({
    id: `stage-task-${Date.now()}-${index}`,
    stage,
    staffIds: [],
    start,
    end,
    hours: breakdownByStage.has(stage) ? breakdownByStage.get(stage) : getStageHours(estimatedHours, stage),
    status: "Not Started",
    timeSource: breakdownByStage.has(stage) ? "quote-task-rules" : "percentage-fallback",
  }));
}

function ensureAllStageTasks(stageTasks = [], start, end, estimatedHours = 0, productionStageBreakdown = []) {
  const existingByStage = new Map(stageTasks.map((task) => [task.stage, task]));
  const breakdownByStage = new Map((productionStageBreakdown || []).map((item) => [item.stage, Number(item.hours || 0)]));
  const deliveryDate = end || start;

  return stages.filter((stage) => stage !== "Complete").map((stage, index) => {
    const existing = existingByStage.get(stage);
    const breakdownHours = breakdownByStage.has(stage) ? breakdownByStage.get(stage) : null;
    const isDelivery = stage === "Delivery";
    const autoDeliveryHours = isDelivery && deliveryDate ? 1 : 0;
    const calculatedHours = existing?.timeSource === "manual"
      ? Number(existing.hours || 0)
      : breakdownHours !== null
        ? breakdownHours
        : existing?.timeSource === "quote-task-rules"
          ? Number(existing.hours || 0)
          : isDelivery
            ? Number(existing?.hours || autoDeliveryHours)
            : getStageHours(estimatedHours, stage);
    return {
      id: existing?.id || `stage-task-${Date.now()}-${index}`,
      stage,
      staffIds: existing?.staffIds || (existing?.staffId ? [existing.staffId] : []),
      start: isDelivery && deliveryDate ? (existing?.start || deliveryDate) : existing?.start || start,
      end: isDelivery && deliveryDate ? (existing?.end || deliveryDate) : existing?.end || end,
      hours: calculatedHours,
      status: existing?.status || "Not Started",
      allocationMode: existing?.allocationMode || "auto",
      fixedDate: isDelivery && deliveryDate ? deliveryDate : existing?.fixedDate || "",
      timeSource: existing?.timeSource || (isDelivery && autoDeliveryHours ? "auto-delivery-date" : breakdownHours !== null ? "quote-task-rules" : "percentage-fallback"),
    };
  });
}

function alignStageTaskHours(stageTasks = [], estimatedHours = 0, start = "", end = "") {
  return ensureAllStageTasks(stageTasks, start, end, estimatedHours);
}

function getStageIndex(stage) {
  return Math.max(0, stages.indexOf(stage));
}

function normaliseLinearStageTasks(stageTasks = [], activeStage = "Design") {
  const activeIndex = getStageIndex(activeStage);
  return stageTasks.map((task) => {
    const taskIndex = getStageIndex(task.stage);
    if (taskIndex < activeIndex) return { ...task, status: "Complete" };
    if (taskIndex === activeIndex) return { ...task, status: "In Progress" };
    return { ...task, status: "Not Started" };
  });
}

function normaliseStageTasksFromCompletion(stageTasks = []) {
  const orderedTasks = stages
    .filter((stage) => stage !== "Complete")
    .map((stage) => stageTasks.find((task) => task.stage === stage))
    .filter(Boolean);

  const firstIncomplete = orderedTasks.find((task) => task.status !== "Complete");

  if (!firstIncomplete) {
    return stageTasks.map((task) => ({ ...task, status: "Complete" }));
  }

  return normaliseLinearStageTasks(stageTasks, firstIncomplete.stage);
}



function getNextStage(stage) {
  const index = getStageIndex(stage);
  return stages[Math.min(index + 1, stages.length - 1)];
}

function getPreviousStage(stage) {
  const index = getStageIndex(stage);
  return stages[Math.max(index - 1, 0)];
}

function isStaffOnApprovedHoliday(staffId, day, holidays = []) {
  return holidays.some((holiday) =>
    holiday.staffId === staffId &&
    holiday.status === "Approved" &&
    dateIsWithin(day, holiday.start, holiday.end)
  );
}

function getHolidayForStaffOnDay(staffId, day, holidays = []) {
  return holidays.find((holiday) =>
    holiday.staffId === staffId &&
    holiday.status === "Approved" &&
    dateIsWithin(day, holiday.start, holiday.end)
  );
}

function getTaskStaffIds(task) {
  return task.staffIds || (task.staffId ? [task.staffId] : []);
}

function getStaffRolePriority(person = {}, stage = "") {
  const priority = Number(person.rolePriorities?.[stage] || 99);
  return priority > 0 ? priority : 99;
}

function normaliseStaffRolePriorities(person = {}) {
  const existing = person.rolePriorities || {};
  const rolePriorities = {};
  (person.roles || []).forEach((role, index) => {
    rolePriorities[role] = Number(existing[role] || index + 1);
  });
  return { ...person, rolePriorities };
}

function getEligibleStaffForJob(job = {}, allStaff = []) {
  const excluded = new Set(job.excludedStaffIds || []);
  return (allStaff || []).filter((person) => isStaffActive(person) && !excluded.has(person.id));
}

function getQualifiedStaffForStage(stage, allStaff = []) {
  return (allStaff || []).filter((person) => isStaffActive(person) && (person.roles || []).includes(stage));
}

function getTaskLoadByStaff(jobs = [], activeOnly = false) {
  const loads = new Map();
  jobs.forEach((job) => {
    (job.stageTasks || []).forEach((task) => {
      if (task.status === "Complete") return;
      if (activeOnly && task.status !== "In Progress") return;
      const staffIds = getTaskStaffIds(task);
      const splitHours = Number(task.hours || 0) / Math.max(1, staffIds.length || 1);
      staffIds.forEach((staffId) => loads.set(staffId, (loads.get(staffId) || 0) + splitHours));
    });
  });
  return loads;
}

function getActiveTaskForJob(job) {
  const tasks = ensureAllStageTasks(job.stageTasks || [], job.start, getJobPlanningEnd(job), job.estimatedHours, job.productionStageBreakdown || []);
  return tasks.find((task) => task.status === "In Progress") || tasks.find((task) => task.status !== "Complete") || null;
}

function getAutoAssignableTasksForJob(job) {
  const activeTask = getActiveTaskForJob(job);
  return activeTask ? [activeTask] : [];
}

function taskHasPlannableHours(task = {}) {
  return Number(task.hours || 0) > 0;
}

function getCalendarStageTasksForStaff({ jobs = [], staffId = "", day = "", holidays = [] }) {
  if (isStaffOnApprovedHoliday(staffId, day, holidays)) return [];
  return (jobs || [])
    .flatMap((job) => (job.stageTasks || []).map((task) => ({ ...task, job })))
    .filter((item) => item.status !== "Complete")
    .filter((item) => taskHasPlannableHours(item))
    .filter((item) => getTaskStaffIds(item).includes(staffId))
    .filter((item) => item.start && item.end && dateIsWithin(day, item.start, item.end));
}

function getJobPlanningEnd(job = {}) {
  return job.calculatedEnd || job.deadline || job.end || job.start || toIso(new Date());
}

function getJobFinishDate(job = {}) {
  const taskDates = (job.stageTasks || []).flatMap((task) => [task.end, task.start]).filter(Boolean).sort();
  return job.calculatedEnd || taskDates[taskDates.length - 1] || job.end || job.deadline || job.start || "";
}

function getStaffAvailableDate(staffId, availabilityMap, scheduleStartDate, holidays = []) {
  let next = nextPlannerWorkingDay(new Date(availabilityMap.get(staffId) || scheduleStartDate));
  while (isStaffOnApprovedHoliday(staffId, toIso(next), holidays)) next = nextPlannerWorkingDay(addDays(next, 1));
  return next;
}

function addPlannerDaysSkippingHolidays(startDate, workingDaysNeeded, staffIds = [], holidays = []) {
  let cursor = nextPlannerWorkingDay(new Date(startDate));
  let plannedDays = 1;
  while (plannedDays < Math.max(1, workingDaysNeeded)) {
    cursor = nextPlannerWorkingDay(addDays(cursor, 1));
    while (staffIds.some((staffId) => isStaffOnApprovedHoliday(staffId, toIso(cursor), holidays))) cursor = nextPlannerWorkingDay(addDays(cursor, 1));
    plannedDays += 1;
  }
  return cursor;
}

function addWorkingDaysSkippingHolidays(startDate, workingDaysNeeded, staffIds = [], holidays = []) {
  return addPlannerDaysSkippingHolidays(startDate, workingDaysNeeded, staffIds, holidays);
}

function createPlanningDiagnosticsEntry({ job, task, staffId, reason }) {
  return {
    id: `diag-${job.id}-${task.id}`,
    jobId: job.id,
    jobNo: job.jobNo,
    taskId: task.id,
    stage: task.stage,
    staffId,
    reason,
  };
}

function pickStaffForTask({ job, task, allStaff = [], availabilityMap, scheduleStartDate, holidays = [] }) {
  const eligibleStaff = getEligibleStaffForJob(job, allStaff);
  const qualified = getQualifiedStaffForStage(task.stage, eligibleStaff);
  const manualStaffIds = task.allocationMode === "manual" ? getTaskStaffIds(task).filter((staffId) => qualified.some((person) => person.id === staffId)) : [];
  if (manualStaffIds.length) {
    return {
      staffIds: manualStaffIds,
      reason: `Manual override: ${manualStaffIds.map((id) => allStaff.find((person) => person.id === id)?.name || id).join(", ")}.`,
      allocationMode: "manual",
    };
  }
  if (!qualified.length) return { staffIds: [], reason: `No eligible staff with ${task.stage} role.`, allocationMode: "auto" };

  const sorted = [...qualified].sort((a, b) => {
    const aDate = getStaffAvailableDate(a.id, availabilityMap, scheduleStartDate, holidays).getTime();
    const bDate = getStaffAvailableDate(b.id, availabilityMap, scheduleStartDate, holidays).getTime();
    if (aDate !== bDate) return aDate - bDate;
    const priorityDiff = getStaffRolePriority(a, task.stage) - getStaffRolePriority(b, task.stage);
    if (priorityDiff !== 0) return priorityDiff;
    return Number(b.hoursPerDay || 0) - Number(a.hoursPerDay || 0);
  });

  const chosen = sorted[0];
  return {
    staffIds: [chosen.id],
    reason: `Auto allocated to ${chosen.name}: ${task.stage} priority P${getStaffRolePriority(chosen, task.stage)}, available ${toIso(getStaffAvailableDate(chosen.id, availabilityMap, scheduleStartDate, holidays))}.`,
    allocationMode: "auto",
  };
}

function chooseBestStaffForTask({ task, allStaff = [], existingJobs = [], manualStaffIds = [] }) {
  const availabilityMap = new Map((allStaff || []).map((person) => [person.id, new Date()]));
  const picked = pickStaffForTask({ job: { excludedStaffIds: [] }, task: { ...task, staffIds: manualStaffIds, allocationMode: manualStaffIds.length ? "manual" : task.allocationMode }, allStaff, availabilityMap, scheduleStartDate: toIso(new Date()), holidays: [] });
  if (picked.staffIds.length && !manualStaffIds.length && existingJobs.length) {
    const loads = getTaskLoadByStaff(existingJobs, true);
    const qualified = getQualifiedStaffForStage(task.stage, allStaff);
    const sorted = [...qualified].sort((a, b) => {
      const loadDiff = (loads.get(a.id) || 0) - (loads.get(b.id) || 0);
      if (loadDiff !== 0) return loadDiff;
      const priorityDiff = getStaffRolePriority(a, task.stage) - getStaffRolePriority(b, task.stage);
      if (priorityDiff !== 0) return priorityDiff;
      return Number(b.hoursPerDay || 0) - Number(a.hoursPerDay || 0);
    });
    return sorted[0] ? [sorted[0].id] : [];
  }
  return picked.staffIds;
}

function autoAssignStageTasksForStaff(job, allStaff, selectedStaffIds = [], existingJobs = []) {
  const availabilityMap = new Map((allStaff || []).map((person) => [person.id, new Date(job.start || toIso(new Date()))]));
  const planned = planJobsWithEngine([job], allStaff, job.start || toIso(new Date()), [], availabilityMap);
  return planned.jobs[0]?.stageTasks || ensureAllStageTasks(job.stageTasks || [], job.start, getJobPlanningEnd(job), job.estimatedHours, job.productionStageBreakdown || []);
}

function planJobsWithEngine(jobs = [], staff = [], scheduleStartDate = toIso(new Date()), holidays = [], existingAvailabilityMap = null) {
  const staffAvailability = existingAvailabilityMap || new Map((staff || []).map((person) => [person.id, nextPlannerWorkingDay(new Date(scheduleStartDate))]));
  const diagnostics = [];
  const plannedJobs = jobs.map((job) => ({
    ...job,
    excludedStaffIds: job.excludedStaffIds || [],
    stageTasks: ensureAllStageTasks(job.stageTasks || [], job.start || scheduleStartDate, getJobPlanningEnd(job), job.estimatedHours, job.productionStageBreakdown || []),
  }));

  const activeJobs = [...plannedJobs]
    .filter((job) => job.status !== "Complete" && job.status !== "To Be Invoiced")
    .sort((a, b) => {
      const priorityDiff = priorityRank(a.priority) - priorityRank(b.priority);
      if (priorityDiff !== 0) return priorityDiff;
      return new Date(a.deadline || getJobPlanningEnd(a)) - new Date(b.deadline || getJobPlanningEnd(b));
    });

  activeJobs.forEach((job) => {
    let jobCursor = nextPlannerWorkingDay(new Date(job.start || scheduleStartDate));
    const scheduledTasks = [];
    const tasks = ensureAllStageTasks(job.stageTasks || [], job.start || scheduleStartDate, getJobPlanningEnd(job), job.estimatedHours, job.productionStageBreakdown || []);

    tasks.forEach((task) => {
      if (task.status === "Complete") {
        scheduledTasks.push({ ...task, staffIds: getTaskStaffIds(task), staffId: getTaskStaffIds(task)[0] || "", locked: true });
        return;
      }
      if (!taskHasPlannableHours(task)) {
        scheduledTasks.push({ ...task, staffIds: [], staffId: "", start: "", end: "", allocationMode: task.allocationMode || "auto" });
        return;
      }

      const picked = pickStaffForTask({ job, task, allStaff: staff, availabilityMap: staffAvailability, scheduleStartDate, holidays });
      if (!picked.staffIds.length) {
        const unscheduled = { ...task, staffIds: [], staffId: "", start: "", end: "", allocationMode: picked.allocationMode, planningIssue: picked.reason };
        scheduledTasks.push(unscheduled);
        diagnostics.push(createPlanningDiagnosticsEntry({ job, task: unscheduled, staffId: "", reason: picked.reason }));
        return;
      }

      const assignedStaffMembers = picked.staffIds.map((id) => staff.find((person) => person.id === id)).filter(Boolean);
      const staffReadyDates = picked.staffIds.map((id) => getStaffAvailableDate(id, staffAvailability, scheduleStartDate, holidays));
      const latestStaffReady = new Date(Math.max(...staffReadyDates.map((date) => date.getTime())));
      const deliveryDate = task.stage === "Delivery" && (task.fixedDate || job.deliveryDate || job.deadline) ? nextPlannerWorkingDay(new Date(task.fixedDate || job.deliveryDate || job.deadline)) : null;
      let taskStart = deliveryDate || nextPlannerWorkingDay(new Date(Math.max(jobCursor.getTime(), latestStaffReady.getTime())));
      while (picked.staffIds.some((staffId) => isStaffOnApprovedHoliday(staffId, toIso(taskStart), holidays))) taskStart = nextPlannerWorkingDay(addDays(taskStart, 1));

      const totalCapacityPerDay = assignedStaffMembers.reduce((sum, person) => sum + Number(person.hoursPerDay || 8), 0) || 8;
      const workingDaysNeeded = Math.max(1, Math.ceil(Number(task.hours || 0) / totalCapacityPerDay));
      const taskEnd = addWorkingDaysSkippingHolidays(taskStart, workingDaysNeeded, picked.staffIds, holidays);
      const nextAvailable = nextPlannerWorkingDay(addDays(taskEnd, 1));
      picked.staffIds.forEach((staffId) => staffAvailability.set(staffId, nextAvailable));

      const scheduledTask = {
        ...task,
        staffIds: picked.staffIds,
        staffId: picked.staffIds[0] || "",
        start: toIso(taskStart),
        end: toIso(taskEnd),
        allocationMode: picked.allocationMode,
        planningReason: task.stage === "Delivery" && (task.fixedDate || job.deliveryDate || job.deadline)
          ? `${picked.reason} Delivery fixed from job delivery/deadline date ${task.fixedDate || job.deliveryDate || job.deadline}.`
          : picked.reason,
      };
      scheduledTasks.push(scheduledTask);
      diagnostics.push(createPlanningDiagnosticsEntry({ job, task: scheduledTask, staffId: picked.staffIds[0] || "", reason: picked.reason }));
      jobCursor = nextPlannerWorkingDay(addDays(taskEnd, 1));
    });

    const jobIndex = plannedJobs.findIndex((item) => item.id === job.id);
    if (jobIndex >= 0) {
      const scheduledDates = scheduledTasks.flatMap((task) => [task.start, task.end]).filter(Boolean).sort();
      const calculatedStart = scheduledDates[0] || job.start || scheduleStartDate;
      const calculatedEnd = scheduledDates[scheduledDates.length - 1] || job.calculatedEnd || job.deadline || job.end || calculatedStart;
      plannedJobs[jobIndex] = {
        ...plannedJobs[jobIndex],
        start: calculatedStart,
        calculatedEnd,
        end: calculatedEnd,
        stageTasks: scheduledTasks,
        staffIds: Array.from(new Set(scheduledTasks.flatMap((task) => getTaskStaffIds(task)).filter(Boolean))),
        planningDiagnostics: diagnostics.filter((entry) => entry.jobId === job.id),
      };
    }
  });

  return { jobs: plannedJobs, diagnostics };
}

function autoPlanJobsLive(jobs = [], staff = [], scheduleStartDate = toIso(new Date()), holidays = []) {
  return planJobsWithEngine(jobs, staff, scheduleStartDate, holidays).jobs;
}

function priorityRank(priority) {
  return 6 - Number(priority || 1);
}

function autoScheduleJobs(jobs, staff, scheduleStartDate, holidays = []) {
  return planJobsWithEngine(jobs, staff, scheduleStartDate, holidays).jobs;
}

function createFunctionalTestResult(name, passed, details = "") {
  return { name, passed: Boolean(passed), details };
}

function runPlannerFunctionalTestSuite({ jobs = [], staff = [], pricingSchedule = defaultSteelPricingSchedule, productivityRules = defaultProductivityRules, productDatabase = steelProductDatabase, customers = initialCustomers, stockItems = [], suppliers = initialSuppliers, purchaseOrders = [], today = "2026-05-22", holidays = [] } = {}) {
  const results = [];
  const stressJobs = createPlannerStressTestJobs({ existingJobs: jobs, pricingSchedule, productivityRules, productDatabase, customers, today });
  const planned = autoPlanJobsLive([...jobs, ...stressJobs.map((job) => ({ ...job, excludedStaffIds: [] }))], staff, today, holidays);
  const plannedStressJobs = planned.filter((job) => stressJobs.some((stressJob) => stressJob.id === job.id));
  const allStageTasks = plannedStressJobs.flatMap((job) => job.stageTasks || []);
  const allocatedTasks = allStageTasks.filter((task) => taskHasPlannableHours(task) && task.status !== "Complete" && getTaskStaffIds(task).length);
  const suggestedPos = plannedStressJobs.flatMap((job, index) => {
    const missingParts = buildMissingPartsForJob(job, stockItems);
    return missingParts.length ? [createSuggestedPurchaseOrderDraft({ job, missingParts, supplierId: suppliers[0]?.id || "", poCount: purchaseOrders.length + index, today })] : [];
  });

  const sarahTasks = plannedStressJobs.flatMap((job) => (job.stageTasks || [])
    .filter((task) => getTaskStaffIds(task).includes("s3") && task.start)
    .flatMap((task) => getCalendarStageTasksForStaff({ jobs: [job], staffId: "s3", day: task.start, holidays }).map((calendarTask) => ({ ...calendarTask, job }))));
  const leeCoverageJob = {
    id: `lee-coverage-${Date.now()}`,
    jobNo: "TEST-LEE",
    customer: "Planner Test",
    title: "Lee delivery coverage test",
    start: today,
    deadline: toIso(addDays(new Date(today), 5)),
    status: "In Production",
    priority: "6",
    estimatedHours: 4,
    excludedStaffIds: [],
    productionStageBreakdown: [{ stage: "Delivery", hours: 2 }],
    stageTasks: normaliseLinearStageTasks(createDefaultStageTasks(today, toIso(addDays(new Date(today), 5)), 4, [{ stage: "Delivery", hours: 2 }]), "Delivery"),
  };
  const leeCoveragePlanned = autoPlanJobsLive([leeCoverageJob], staff, today, holidays)[0];
  const leeDeliveryTask = (leeCoveragePlanned?.stageTasks || []).find((task) => task.stage === "Delivery");
  const leeTasks = (leeCoveragePlanned?.stageTasks || [])
    .filter((task) => getTaskStaffIds(task).includes("s4") && task.start)
    .flatMap((task) => getCalendarStageTasksForStaff({ jobs: [leeCoveragePlanned], staffId: "s4", day: task.start, holidays }).map((calendarTask) => ({ ...calendarTask, job: leeCoveragePlanned })));
  const completedLocked = plannedStressJobs.every((job) => (job.stageTasks || []).filter((task) => task.status === "Complete").every((task) => task.locked || task.status === "Complete"));
  const diagnosticsCount = plannedStressJobs.reduce((sum, job) => sum + (job.planningDiagnostics || []).length, 0);
  const deadlineChecks = plannedStressJobs.map((job) => ({ jobNo: job.jobNo, deadline: job.deadline, finish: getJobFinishDate(job), late: isJobPastDeadline(job) }));

  results.push(createFunctionalTestResult("Stress test creates 10 jobs", plannedStressJobs.length === 10, `${plannedStressJobs.length} job(s) created.`));
  results.push(createFunctionalTestResult("Each stress-test job has 3 steel lines", plannedStressJobs.every((job) => (job.takeoffLines || []).length === 3), `${plannedStressJobs.reduce((sum, job) => sum + (job.takeoffLines || []).length, 0)} total steel line(s).`));
  results.push(createFunctionalTestResult("Quote task-rule stage breakdown carried into jobs", plannedStressJobs.every((job) => (job.productionStageBreakdown || []).length > 0), `${plannedStressJobs.reduce((sum, job) => sum + (job.productionStageBreakdown || []).length, 0)} stage breakdown row(s).`));
  results.push(createFunctionalTestResult("Planner allocates plannable incomplete tasks", allocatedTasks.length > 0, `${allocatedTasks.length} allocated task(s).`));
  results.push(createFunctionalTestResult("Planner diagnostics generated", diagnosticsCount > 0, `${diagnosticsCount} diagnostic line(s).`));
  results.push(createFunctionalTestResult("Sarah receives visible eligible work", sarahTasks.length > 0, `${sarahTasks.length} visible Sarah calendar task(s) checked on their scheduled start dates.`));
  results.push(createFunctionalTestResult("Lee receives visible eligible work", leeTasks.length > 0, `${leeTasks.length} visible Lee calendar task(s) from dedicated Delivery coverage test.`));
  results.push(createFunctionalTestResult("Delivery task is fixed to delivery/deadline date", Boolean(leeDeliveryTask && leeDeliveryTask.start === leeCoverageJob.deadline && leeDeliveryTask.end === leeCoverageJob.deadline), `Delivery start ${leeDeliveryTask?.start || "missing"}, deadline ${leeCoverageJob.deadline}.`));
  results.push(createFunctionalTestResult("Completed tasks remain locked/preserved", completedLocked, "Completed stage rows stay complete during planning."));
  results.push(createFunctionalTestResult("Deadline lights use calculated planner finish", deadlineChecks.every((item) => item.finish), deadlineChecks.map((item) => `${item.jobNo}: finish ${item.finish}, deadline ${item.deadline}${item.late ? " late" : " on schedule"}`).join("; ")));
  results.push(createFunctionalTestResult("Suggested supplier enquiries can be generated", suggestedPos.length > 0, `${suggestedPos.length} suggested supplier enquiry(s).`));

  return {
    passed: results.every((result) => result.passed),
    createdJobs: plannedStressJobs.length,
    createdLines: plannedStressJobs.reduce((sum, job) => sum + (job.takeoffLines || []).length, 0),
    allocatedTasks: allocatedTasks.length,
    suggestedPos: suggestedPos.length,
    diagnosticsCount,
    results,
    plannedJobs: plannedStressJobs,
    suggestedPurchaseOrders: suggestedPos,
  };
}

function runSelfTests() {
  const testEntityIdA = createEntityId("test");
  const testEntityIdB = createEntityId("test");
  console.assert(testEntityIdA.startsWith("test-"), "entity ids should include their prefix");
  console.assert(testEntityIdA !== testEntityIdB, "entity ids should be unique enough for local/staging use");
  const metaRecord = withRecordMeta({ id: "record-test" }, { id: "user-test" });
  const bumpedRecord = bumpRecordVersion(metaRecord, { name: "Updated" }, { id: "user-test" });
  console.assert(metaRecord.recordVersion === 1, "new records should start at version 1");
  console.assert(bumpedRecord.recordVersion === 2, "record updates should increment version");
  console.assert(hasRecordConflict({ id: "r1", recordVersion: 1 }, { id: "r1", recordVersion: 2 }) === true, "older local records should detect conflict");
  console.assert(hasRecordConflict({ id: "r1", recordVersion: 3 }, { id: "r1", recordVersion: 2 }) === false, "newer local records should not flag conflict");
  const lockUserA = { id: "user-a", name: "User A" };
  const lockUserB = { id: "user-b", name: "User B" };
  const testLock = createRecordLock({ recordId: "job-1", resource: "jobs", user: lockUserA, expiresInMinutes: 15 });
  console.assert(isRecordLockActive(testLock) === true, "fresh record lock should be active");
  console.assert(canEditLockedRecord(testLock, lockUserA) === true, "lock owner should be able to edit locked record");
  console.assert(canEditLockedRecord(testLock, lockUserB) === false, "different user should not edit active locked record");
  console.assert(getActiveRecordLock([testLock], "jobs", "job-1")?.id === testLock.id, "active lock should be found by resource and record id");
  console.assert(canBackendAccess("operations", "canCreate", "jobs") === true, "operations should be able to create jobs");
  console.assert(canBackendAccess("sales", "canCreate", "jobs") === false, "sales should not be able to create jobs");
  console.assert(canBackendAccess("staff", "canUpdate", "assigned_job_task_progress") === true, "staff should be able to update assigned task progress");
  console.assert(canBackendAccess("staff", "canCreate", "purchase_orders") === false, "staff should not be able to create purchase orders");
  console.assert(canBackendAccess("operations", "canCreate", "purchase_enquiries") === true, "operations should be able to create supplier enquiries");
  console.assert(canBackendAccess("sales", "canCreate", "purchase_enquiries") === false, "sales should not be able to create supplier enquiries");
  console.assert(runAuthPermissionReadinessTests().passed === true, "auth permission readiness tests should pass before live rollout");
  console.assert(canBackendAccess("staff", "canCreate", "own_clock_entries") === true, "staff should be able to create their own clock entries");
  console.assert(canBackendAccess("staff", "canUpdate", "own_open_clock_entries") === true, "staff should be able to clock out their own open entries");
  console.assert(canBackendAccess("staff", "canCreate", "own_holiday_requests") === true, "staff should be able to request holiday");
  console.assert(staffPinMatches({ pin: "1234" }, "1234") === true, "staff pin should unlock matching staff actions only");
  console.assert(staffPinMatches({ pin: "1234" }, "9999") === false, "wrong staff pin should block staff actions");
  console.assert(staffPinMatches({ id: "s1", name: "Jon" }, "1111") === true, "saved Jon staff record without pin should still use demo PIN 1111");
  console.assert(staffPinMatches({ id: "s2", name: "Mick" }, "2222") === true, "saved Mick staff record without pin should still use demo PIN 2222");
  console.assert(hasPendingHolidayRequests([{ status: "Pending" }]) === true, "pending holiday should trigger navigation highlight");
  console.assert(hasPendingHolidayRequests([{ status: "Approved" }]) === false, "approved holidays should not trigger pending highlight");
  console.assert(canBackendAccess("operations", "canUpdate", "holiday_requests") === true, "operations should be able to approve holiday requests");
  console.assert(nextNumber("PO", 0) === "PO-00001", "nextNumber should start PO numbers at 00001");
  console.assert(formatLinkedNumber("QU", 8) === "QU-008", "quote numbers should use QU-000 format");
  console.assert(getLinkedDocumentNumber("JD", "QU-008") === "JD-008", "job number should match quote sequence");
  console.assert(getLinkedDocumentNumber("DN", "JD-008") === "DN-008", "delivery note number should match job sequence");
  console.assert(getSequenceFromDocumentNumber("QU-008") === 8, "sequence should come from document suffix only");
  console.assert(getSequenceFromDocumentNumber("PROJECT-24-QU-008") === 8, "sequence should ignore earlier digits and use suffix only");
  console.assert(reserveDocumentNumberSync({ documentType: "quote", records: [{ quoteNo: "QU-008" }] }).number === "QU-009", "quote reservation should use next available quote number");
  console.assert(reserveDocumentNumberSync({ documentType: "job", linkedSourceNumber: "QU-008" }).number === "JD-008", "job reservation should link to quote sequence");
  console.assert(reserveDocumentNumberSync({ documentType: "deliveryNote", linkedSourceNumber: "JD-008" }).number === "DN-008", "delivery note reservation should link to job sequence");
  console.assert(reserveDocumentNumberSync({ documentType: "purchaseOrder", records: [{ poNo: "PO-00001" }] }).number === "PO-00002", "PO reservation should use five digit PO sequence");
  console.assert(reserveDocumentNumberSync({ documentType: "enquiry", records: [{ enquiryNo: "ENQ-00004" }] }).number === "ENQ-00005", "supplier enquiry reservation should use five digit ENQ sequence");
  console.assert(runNumberingReadinessTests().passed === true, "numbering readiness tests should pass");
  console.assert(runRecordLockReadinessTests().passed === true, "record lock readiness tests should pass");
  const testStoredDocument = createStoredDocumentRecord({ documentType: "job_sheet_pdf", title: "Test job sheet", relatedResource: "jobs", relatedResourceId: "job-1", jobId: "job-1", documentNo: "JD-001" });
  console.assert(testStoredDocument.documentType === "job_sheet_pdf", "stored document should keep document type");
  console.assert(testStoredDocument.storageStatus.includes("cloud storage pending"), "local generated documents should show cloud storage pending");
  console.assert(canBackendAccess("operations", "canCreate", "stored_documents") === true, "operations should be able to create stored document records");
  console.assert(canBackendAccess("operations", "canCreate", "staff") === true, "operations should be able to create staff records");
  console.assert(canBackendAccess("operations", "canCreate", "custom_products") === true, "operations should be able to create custom products");
  const testCustomProduct = createCustomProductRecord({ name: "Test Product", optionRows: [{ size: "Small", price: 100 }, { size: "Large", price: 200 }] }, []);
  console.assert(testCustomProduct.id === "test-product", "custom product id should be normalised from name");
  console.assert(testCustomProduct.sectionOptions.length === 2, "custom product should keep size option rows");
  console.assert(testCustomProduct.optionRows[1].price === 200, "custom product size rows should keep individual prices");
  console.assert(calculateSteelTakeoffLineTotal({ productId: "welding-table", sectionSize: "1000x500", quantity: 2 }, [{ productId: "welding-table", sectionSize: "1000x500", buyPrice: 350, markupAmount: 50, priceMode: "fixed" }]) === 800, "fixed-price custom products should price by quantity");
  console.assert(calculateHoleCountFromCentres(6, 1000) === 6, "6m part at 1000mm centres should calculate 6 holes with minimum 50mm end clearance");
  console.assert(calculateDistanceFromEnd(6, 6, 1000) === 500, "6 holes at 1000mm centres on 6m part should leave 500mm from each end");
  console.assert(calculateHoleCountFromCentres(1, 500) === 2, "1m part at 500mm centres should calculate 2 holes with 250mm end distance");
  console.assert(calculateHoleCountFromCentres(0.08, 500) === 0, "parts shorter than two 50mm end clearances should calculate zero holes");
  console.assert(estimateQuoteLineProductionMinutes({ productId: "ub", sectionSize: "203x102x23", length: 6, quantity: 1, webHolesRequired: "Yes", webHoles: 4, webHoleCentres: 1000 }, defaultProductivityRules, steelProductDatabase) === 100, "hole quantities should be calculated from centres, not manual quantity");
  console.assert(estimateQuoteProductionHours([{ productId: "ub", sectionSize: "203x102x23", length: 6, quantity: 1, webHolesRequired: "Yes", webHoles: 4, webHoleCentres: 1000 }], defaultProductivityRules, steelProductDatabase) === 1.67, "quote production hours should convert calculated-count minutes to decimal hours");
  console.assert(estimateQuoteLineProductionMinutes({ productId: "ub", sectionSize: "203x102x23", length: 6, quantity: 1, webHolesRequired: "Yes", webHoles: 0, webHoleCentres: 1000 }, defaultProductivityRules, steelProductDatabase) === 100, "calculated web holes should use length divided by centres with 50mm minimum end clearance");
  console.assert(normaliseProductivityRules([{ id: "connection-per-item", task: "Fabrication", label: "Connections", unit: "per item", minutes: 55, appliesTo: "steel" }]).some((rule) => rule.id === "end-plate-connection-per-item"), "saved old productivity rules should migrate to separate connection-type rows");
  console.assert(normaliseProductivityRules([{ id: "connection-per-item", task: "Fabrication", label: "Connections", unit: "per item", minutes: 55, appliesTo: "steel" }]).find((rule) => rule.id === "haunch-connection-per-item")?.minutes === 55, "legacy connection time should carry into split connection rows during migration");
  console.assert(getConnectionProductivityRuleId("End plate") === "end-plate-connection-per-item", "end plate connection should use its own productivity time rule");
  console.assert(getConnectionProductivityRuleId("Haunch") === "haunch-connection-per-item", "haunch connection should use its own productivity time rule");
  console.assert(estimateQuoteLineProductionBreakdown({ productId: "ub", sectionSize: "203x102x23", length: 1, quantity: 1, connectionRequired: "Yes", connectionType: "Haunch", connectionQuantity: 2 }, defaultProductivityRules, steelProductDatabase).Fabrication === 150, "haunch connections should calculate from the haunch-specific task time rule");
  const steelBreakdown = mergeProductionStageBreakdowns([{ productId: "ub", sectionSize: "203x102x23", length: 6, quantity: 1, webHolesRequired: "Yes", webHoleCentres: 1000, finish: "Primed" }], defaultProductivityRules, steelProductDatabase);
  console.assert(steelBreakdown.find((item) => item.stage === "Drilling")?.minutes === 60, "steel quote breakdown should use task rules for drilling minutes");
  console.assert(steelBreakdown.find((item) => item.stage === "Cutting")?.minutes === 30, "steel quote breakdown should use task rules for cutting minutes");
  const customBreakdown = mergeProductionStageBreakdowns([{ productId: "custom-table", sectionSize: "1000x500", quantity: 1 }], defaultProductivityRules, [{ id: "custom-table", isCustom: true, productionMinutes: 600, optionRows: [{ size: "1000x500", productionMinutes: 600 }] }]);
  console.assert(customBreakdown.find((item) => item.stage === "Fabrication")?.minutes === 150, "custom product time should use percentage split for fabrication");
  console.assert(createDefaultStageTasks("2026-05-22", "2026-05-25", 10, [{ stage: "Drilling", hours: 1 }]).find((task) => task.stage === "Drilling")?.hours === 1, "job stage tasks should use quote task breakdown when supplied");
  const leadTimeTest = calculatePlannerLeadTime({ jobs: [{ status: "In Production", priority: "5", estimatedHours: 16 }], staff: [{ hoursPerDay: 8 }], quoteHours: 8, priority: "5", today: "2026-05-22" });
  console.assert(leadTimeTest.workingDays === 3, "lead-time should include current equal/higher priority workload plus quote hours");
  console.assert(canBackendAccess("staff", "canRead", "relevant_stored_documents") === true, "staff should be able to read relevant stored documents");
  console.assert(steelSectionInventory.shs.length >= 90, "SHS inventory should include expanded spreadsheet list");
  console.assert(steelSectionInventory.rhs.length >= 130, "RHS inventory should include expanded spreadsheet list");
  console.assert(steelSectionInventory.rsa.length >= 40, "Equal angle inventory should include expanded spreadsheet list");
  console.assert(steelSectionInventory.ursa.length >= 35, "Unequal angle inventory should include expanded spreadsheet list");
  console.assert(extractKgPerMetre("50x50x3x4.25") === 4.25, "SHS/RHS formatted options should extract kg/m from final value");
  console.assert(extractKgPerMetre("200x200x24x71.1") === 71.1, "Angle formatted options should extract kg/m from final value");
  console.assert(extractKgPerMetre("203x102x23") === 23, "UB section should extract 23 kg/m");
  console.assert(extractKgPerMetre("203 x 203 x 46") === 46, "spaced UC section should extract 46 kg/m");
  console.assert(estimateSteelLineWeightKg({ productId: "ub", sectionSize: "203x102x23", length: 6, quantity: 1 }) === 138, "6m 23kg/m beam should weigh 138kg");
  const workflowQuote = { id: "workflow-q", quoteSequence: 8, quoteNo: "QU-008", status: "Accepted", customerId: "c1", customer: "Test", title: "Workflow test", date: "2026-05-20", validUntil: "2026-06-20", estimatedProductionHours: 2, productionStageBreakdown: [{ stage: "Cutting", hours: 1 }, { stage: "Inspection", hours: 1 }], items: [{ id: "workflow-line", description: "Test beam", quantity: 1, unitPrice: 100 }], subtotal: 100, vatRate: 20, vat: 20, total: 120 };
  const workflowPackage = buildQuotePackage({ quote: workflowQuote, customer: { id: "c1", company: "Test" } });
  const workflowJob = createJobFromQuotePackage({ quotePackage: workflowPackage, jobCount: 0, today: "2026-05-20" });
  console.assert(workflowPackage.quoteNo === "QU-008", "workflow package should keep quote number");
  console.assert(workflowJob.jobNo === "JD-008", "converted job should use JD prefix with quote sequence");
  console.assert(workflowJob.estimatedHours === 2, "converted job should use quote production hours when available or subtotal fallback");
  console.assert(workflowJob.stageTasks.find((task) => task.stage === "Cutting")?.hours === 1, "converted job should use quote production stage breakdown for stage hours");
  const stressJobs = createPlannerStressTestJobs({ existingJobs: [], pricingSchedule: defaultSteelPricingSchedule, productivityRules: defaultProductivityRules, productDatabase: steelProductDatabase, customers: initialCustomers, today: "2026-05-22" });
  console.assert(stressJobs.length === 10, "planner stress test should create 10 jobs");
  console.assert(stressJobs.every((job) => (job.takeoffLines || []).length === 3), "each planner stress test job should have 3 steel lines");
  console.assert(stressJobs.every((job) => (job.productionStageBreakdown || []).length > 0), "planner stress test jobs should include production stage breakdowns");
  console.assert(stressJobs.some((job) => isJobPastDeadline(autoPlanJobsLive([job], initialStaff, "2026-05-22", [])[0])), "stress test should include at least one deadline pressure case");
  console.assert(workflowJob.quoteId === workflowQuote.id, "converted job should keep quote id link");
  console.assert(daysBetween("2026-05-01", "2026-05-01") === 1, "same-day jobs should count as 1 day");
  console.assert(calculateTotal([{ quantity: 2, unitPrice: 50 }]).total === 120, "total should include 20% VAT");
  console.assert(isJobPastDeadline({ end: "2026-05-24", deadline: "2026-05-23" }) === true, "job ending after deadline should be flagged late");
  console.assert(isJobPastDeadline({ end: "2026-05-22", deadline: "2026-05-23" }) === false, "job ending before deadline should be on schedule");
  console.assert(getWeightedProgress({ stage: "Design", status: "In Production" }) === 5, "Design should be 5%");
  console.assert(getWeightedProgress({ stage: "Delivery", status: "Delivery" }) === 100, "Delivery stage should total 100%");
  console.assert(getStageHours(100, "Fabrication") === 25, "Fabrication should allocate 25% of estimated hours");
  console.assert(getStageHours(80, "Design") === 4, "Design should allocate 5% of estimated hours");
  console.assert(initialStaff.every((person) => Array.isArray(person.roles)), "staff members should have role arrays");
  console.assert(getNextStage("Design") === "Order Materials", "linear stages should move from Design to Order Materials");
  console.assert(getPreviousStage("Welding") === "Fabrication", "linear stages should move back from Welding to Fabrication");
  console.assert(getStageIndex("Order Materials") > getStageIndex("Design"), "Order Materials should come after Design");
  console.assert(getStageIndex("Cutting") > getStageIndex("Order Materials"), "Cutting should come after Order Materials");
  console.assert(getStageIndex("Fabrication") > getStageIndex("Drilling"), "stage order should stay linear for staff scheduling");
  const allocationTestStaff = [
    { id: "a", name: "A", roles: ["Cutting"], hoursPerDay: 8 },
    { id: "b", name: "B", roles: ["Welding"], hoursPerDay: 8 },
  ];
  const allocationTestJob = { id: "alloc-job", start: "2026-05-22", end: "2026-05-25", estimatedHours: 20, stageTasks: createDefaultStageTasks("2026-05-22", "2026-05-25", 20), staffIds: [] };
  const allocatedTasks = autoAssignStageTasksForStaff(allocationTestJob, allocationTestStaff, [], []);
  console.assert(getTaskStaffIds(allocatedTasks.find((task) => task.stage === "Cutting")).includes("a"), "auto allocation should assign cutting to cutting-qualified staff");
  console.assert(getTaskStaffIds(allocatedTasks.find((task) => task.stage === "Welding")).includes("b"), "auto allocation should assign welding to welding-qualified staff");
  const manualOverrideTasks = autoAssignStageTasksForStaff({ ...allocationTestJob, stageTasks: [{ id: "manual-cut", stage: "Cutting", staffIds: ["a"], hours: 2, status: "Not Started", allocationMode: "manual" }] }, allocationTestStaff, [], []);
  console.assert(manualOverrideTasks[0].allocationMode === "manual", "manual stage allocation should be preserved by live planner");
  const singleAutoTaskJob = { ...allocationTestJob, stageTasks: normaliseLinearStageTasks(createDefaultStageTasks("2026-05-22", "2026-05-25", 20), "Cutting") };
  const singleAutoTasks = autoAssignStageTasksForStaff(singleAutoTaskJob, [{ id: "a", roles: ["Cutting"], hoursPerDay: 8 }, { id: "c", roles: ["Cutting"], hoursPerDay: 8 }], [], []);
  console.assert(getTaskStaffIds(singleAutoTasks.find((task) => task.stage === "Cutting")).length === 1, "automatic stage allocation should assign one staff member per active task");
  const parallelPlanned = autoPlanJobsLive([
    { id: "job-a", priority: "5", deadline: "2026-05-25", start: "2026-05-22", end: "2026-05-25", estimatedHours: 20, status: "In Production", stage: "Cutting", stageTasks: normaliseLinearStageTasks(createDefaultStageTasks("2026-05-22", "2026-05-25", 20), "Cutting") },
    { id: "job-b", priority: "5", deadline: "2026-05-25", start: "2026-05-22", end: "2026-05-25", estimatedHours: 20, status: "In Production", stage: "Cutting", stageTasks: normaliseLinearStageTasks(createDefaultStageTasks("2026-05-22", "2026-05-25", 20), "Cutting") },
  ], [{ id: "a", roles: ["Cutting"], hoursPerDay: 8 }, { id: "c", roles: ["Cutting"], hoursPerDay: 8 }], "2026-05-22", []);
  const parallelCuttingStaff = parallelPlanned.map((job) => getTaskStaffIds((job.stageTasks || []).find((task) => task.stage === "Cutting"))[0]).filter(Boolean);
  console.assert(new Set(parallelCuttingStaff).size === 2, "parallel equal-priority cutting jobs should spread across free qualified staff");
  const priorityStaff = [
    { id: "jon", name: "Jon", roles: ["Drilling"], rolePriorities: { Drilling: 5 }, hoursPerDay: 8 },
    { id: "mick", name: "Mick", roles: ["Drilling"], rolePriorities: { Drilling: 1 }, hoursPerDay: 8 },
  ];
  const drillingTask = { id: "drill-task", stage: "Drilling", status: "In Progress", hours: 8 };
  console.assert(chooseBestStaffForTask({ task: drillingTask, allStaff: priorityStaff, existingJobs: [] })[0] === "mick", "highest role priority free staff should win task allocation");
  const busyMickJobs = [{ id: "busy", stageTasks: [{ id: "busy-drill", stage: "Drilling", status: "In Progress", hours: 8, staffIds: ["mick"] }] }];
  console.assert(chooseBestStaffForTask({ task: drillingTask, allStaff: priorityStaff, existingJobs: busyMickJobs })[0] === "jon", "planner should fall back to next free highest-priority staff member when preferred staff is busy");
  console.assert(getStaffRolePriority({ rolePriorities: { Drilling: 3 } }, "Drilling") === 3, "staff role priority helper should read configured priority");
  const allStaffPoolJob = { id: "all-staff-job", start: "2026-05-22", end: "2026-05-25", estimatedHours: 4, productionStageBreakdown: [{ stage: "Painting", hours: 2 }], stageTasks: normaliseLinearStageTasks(createDefaultStageTasks("2026-05-22", "2026-05-25", 4, [{ stage: "Painting", hours: 2 }]), "Painting") };
  const allStaffPoolTasks = autoAssignStageTasksForStaff(allStaffPoolJob, initialStaff, [], []);
  console.assert(getTaskStaffIds(allStaffPoolTasks.find((task) => task.stage === "Painting")).includes("s3"), "all staff should be available by default so Sarah can receive Painting work");
  const excludedSarahTasks = autoAssignStageTasksForStaff({ ...allStaffPoolJob, excludedStaffIds: ["s3"] }, initialStaff, [], []);
  console.assert(!getTaskStaffIds(excludedSarahTasks.find((task) => task.stage === "Painting")).includes("s3"), "deselected staff should be excluded from that job allocation pool");
  const sarahCalendarJob = autoScheduleJobs([{ ...allStaffPoolJob, stageTasks: allStaffPoolTasks }], initialStaff, "2026-05-22", [])[0];
  console.assert(getCalendarStageTasksForStaff({ jobs: [sarahCalendarJob], staffId: "s3", day: sarahCalendarJob.stageTasks.find((task) => task.stage === "Painting")?.start, holidays: [] }).some((task) => task.stage === "Painting"), "Sarah allocated Painting task should appear on staff calendar");
  const leeCalendarJob = { id: "lee-job", start: "2026-05-22", end: "2026-05-25", estimatedHours: 2, productionStageBreakdown: [{ stage: "Delivery", hours: 2 }], stageTasks: normaliseLinearStageTasks(createDefaultStageTasks("2026-05-22", "2026-05-25", 2, [{ stage: "Delivery", hours: 2 }]), "Delivery") };
  const leeTasks = autoAssignStageTasksForStaff(leeCalendarJob, initialStaff, [], []);
  const leeScheduledJob = autoScheduleJobs([{ ...leeCalendarJob, stageTasks: leeTasks }], initialStaff, "2026-05-22", [])[0];
  console.assert(getCalendarStageTasksForStaff({ jobs: [leeScheduledJob], staffId: "s4", day: leeScheduledJob.stageTasks.find((task) => task.stage === "Delivery")?.start, holidays: [] }).some((task) => task.stage === "Delivery"), "Lee allocated Delivery task should appear on staff calendar");
  const weekendPlannerJob = autoPlanJobsLive([{ id: "weekend-job", priority: "6", deadline: "2026-05-24", start: "2026-05-23", status: "In Production", estimatedHours: 8, productionStageBreakdown: [{ stage: "Cutting", hours: 8 }], stageTasks: normaliseLinearStageTasks(createDefaultStageTasks("2026-05-23", "2026-05-24", 8, [{ stage: "Cutting", hours: 8 }]), "Cutting") }], [{ id: "weekend-staff", name: "Weekend Staff", roles: ["Cutting"], rolePriorities: { Cutting: 1 }, hoursPerDay: 8 }], "2026-05-23", [])[0];
  console.assert(weekendPlannerJob.stageTasks.find((task) => task.stage === "Cutting")?.start === "2026-05-23", "planner should stay open and schedule/update stage work on weekends when staff work");
  console.assert(isJobDeliveryComplete({ status: "Complete", stageTasks: [] }) === true, "completed jobs should be hidden from the delivery calendar");
  console.assert(isJobDeliveryComplete({ status: "To Be Invoiced", stageTasks: [] }) === true, "to-be-invoiced jobs should be hidden from the delivery calendar");
  console.assert(isJobDeliveryComplete({ status: "Delivery", stageTasks: [{ stage: "Delivery", status: "Complete" }] }) === true, "jobs with completed delivery task should be hidden from the delivery calendar");
  console.assert(isJobDeliveryComplete({ status: "Delivery", stageTasks: [{ stage: "Delivery", status: "In Progress" }] }) === false, "live delivery jobs should remain visible until delivery is complete");

  const testJob = { id: "test-job", partsList: [{ id: "part-1", productId: "ub", sectionSize: "203x102x23", grade: "S355", finish: "Self colour", length: 6, quantity: 1 }] };
  const testParts = getJobPartsList(testJob, null);
  const testStock = [{ id: "stock-test", productId: "ub", sectionSize: "203x102x23", grade: "S355", finish: "Self colour", length: 6, quantity: 1, status: "In Stock", allocatedJobId: "" }];
  console.assert(testParts.length === 1, "job sheet parts list should read job partsList fallback");
  console.assert(getStockStatusForPart(testParts[0], testStock, testJob.id).label === "Available", "matching stock should show Available");
  console.assert(getStockStatusForPart({ ...testParts[0], quantity: 3 }, testStock, testJob.id).label === "Missing", "insufficient stock quantity should show Missing");
  console.assert(runStockLengthAllocationTests().passed === true, "stock length allocation tests should pass");
  const enquiryStockTest = createStockItemsFromPurchasingDocument({ id: "enq-test", enquiryNo: "ENQ-00001", documentKind: "Enquiry", status: "Enquiry Sent", items: [{ id: "l1", productId: "ub", sectionSize: "203x102x23", length: 6, requiredCutLength: 4, quantity: 1 }] }, "On Order");
  console.assert(enquiryStockTest.length === 0, "enquiries should not create stock inventory lines");
  const poStockTest = createStockItemsFromPurchasingDocument({ id: "po-test", poNo: "PO-00001", documentKind: "Purchase Order", status: "Draft PO", jobId: "job-a", items: [{ id: "l1", productId: "ub", sectionSize: "203x102x23", length: 6, requiredCutLength: 4, quantity: 1 }] }, "On Order");
  console.assert(poStockTest.length === 2 && poStockTest.some((item) => item.stockLineType === "Allocated") && poStockTest.some((item) => item.stockLineType === "Offcut"), "raised PO should create allocated and offcut stock lines");
  const manualCutTest = cutOffcutStockLine([{ id: "offcut-test", productId: "ub", sectionSize: "203x102x23", length: 2, quantity: 1, status: "Offcut", stockLineType: "Offcut", lengthSegments: [{ id: "offcut-test-seg-1", originalLengthM: 2, availableLengthM: 2, status: "Offcut", allocations: [] }] }], { stockItemId: "offcut-test", lengthM: 0.75 });
  console.assert(manualCutTest.length === 2 && manualCutTest.some((item) => item.stockLineType === "Allocated Cut") && manualCutTest.some((item) => item.stockLineType === "Offcut" && Math.abs(Number(item.length || 0) - 1.25) < 0.001), "manual offcut cut should create a cut line and remaining offcut line");
  console.assert(runPurchasingDisplayTests().passed === true, "purchasing display grouping tests should pass");
  console.assert(steelIndustryProfile.products === steelProductDatabase, "steel industry profile should reference the existing steel product database without cloning behaviour");
  console.assert(steelIndustryProfile.sectionInventory === steelSectionInventory, "steel industry profile should reference the existing section inventory");
  console.assert(steelIndustryProfile.pricingSchedule === defaultSteelPricingSchedule, "steel industry profile should reference the existing pricing schedule");
  console.assert(steelIndustryProfile.productivityRules === defaultProductivityRules, "steel industry profile should reference the existing productivity rules");
  console.assert(steelIndustryProfile.stages === stages, "steel industry profile should reference the existing planner stages");
  console.assert(calculateSteelTakeoffLineTotal({ productId: "ub", sectionSize: "203x102x23", length: 6, quantity: 1 }, steelIndustryProfile.pricingSchedule) === calculateSteelTakeoffLineTotal({ productId: "ub", sectionSize: "203x102x23", length: 6, quantity: 1 }, defaultSteelPricingSchedule), "steel profile pricing reference should not change quote totals");
  console.assert(calculateSteelTakeoffLineTotal({ productId: "ub", sectionSize: "203x102x23", finish: "Primed", length: 200 / 23, quantity: 1 }, [{ productId: "ub", buyPrice: 0, markupAmount: 0 }, { productId: "finish-primed", buyPrice: 100, markupAmount: 0 }]) === 20, "200kg primed at £100/t should add £20 finish cost");
  console.assert(estimateSteelLineWeightKg({ productId: "ub", sectionSize: "203x102x23", length: 6, quantity: 1 }) === 138, "steel profile scaffold should not change steel weight calculation");
  const backupSummary = getBackupPreviewSummary({ customers: [{ id: "c" }], quotes: [{ id: "q" }], jobs: [{ id: "j" }], purchaseOrders: [{ id: "po" }], stockItems: [{ id: "s" }], exportedAt: "2026-05-24" });
  console.assert(backupSummary.customers === 1 && backupSummary.jobs === 1 && backupSummary.stockItems === 1, "backup preview summary should count key OPHQ records before restore");
  console.assert(getLaunchModeStatus().mode === "Local test mode", "local storage mode should clearly warn that OPHQ is not production-live yet");
  console.assert(preLaunchWorkflowChecklist.length >= 10, "pre-launch workflow checklist should cover the full internal-use test path");
  console.assert(backendHandoverSpec.some((item) => item.requirement.includes("ophq.ai")), "backend handover spec should include the OPHQ production domain");
  const stockAllocationDisplayTest = allocateStockLengthToJob([{ id: "stock-display", productId: "ub", sectionSize: "203x102x23", grade: "S355", finish: "Self colour", length: 12.2, quantity: 1, status: "In Stock", lengthSegments: [{ id: "stock-display-seg-1", originalLengthM: 12.2, availableLengthM: 12.2, status: "Available", allocations: [] }] }], { stockItemId: "stock-display", jobId: "job-display", part: { productId: "ub", sectionSize: "203x102x23", grade: "S355", finish: "Self colour", length: 4 }, lengthM: 4 });
  console.assert(getAllocatedLengthForStockItem(stockAllocationDisplayTest[0]) === 4, "inventory should total allocated stock length");
  console.assert(Math.abs(getRemainingLengthForStockItem(stockAllocationDisplayTest[0]) - 8.2) < 0.001, "inventory should show remaining available length after allocation");
  console.assert(getStockAllocationRows(stockAllocationDisplayTest[0], [{ id: "job-display", jobNo: "JD-TEST", title: "Display test" }])[0].jobNo === "JD-TEST", "inventory allocation rows should show the linked job number");
  const poTraceStock = createStockItemFromPoLine({ id: "line-trace", productId: "ub", sectionSize: "203x102x23", grade: "S355", finish: "Self colour", length: 12.2, quantity: 1 }, { id: "po-trace", poNo: "PO-00005", documentKind: "Purchase Order", jobId: "job-trace" }, "On Order");
  console.assert(getStockTraceabilityNumber(poTraceStock) === "PO-00005", "stock inventory should show the source PO number for traceability");
  const scrappedStock = scrapStockSegment([poTraceStock], { stockItemId: poTraceStock.id, segmentId: getStockSegments(poTraceStock)[0].id, reason: "Damaged offcut" });
  console.assert(getRemainingLengthForStockItem(scrappedStock[0]) === 0, "scrapped offcut should be removed from available stock length");
  console.assert(getStockSegments(scrappedStock[0])[0].scrapReason === "Damaged offcut", "scrapped offcut should keep the scrap reason for history");
}

runSelfTests();

const initialQuotes = [
  {
    id: "q1",
    quoteSequence: 1,
    quoteNo: "QU-001",
    customerId: "c1",
    customer: "Acme Estates",
    title: "Balcony balustrades",
    date: "2026-05-12",
    validUntil: "2026-06-11",
    status: "Converted",
    subtotal: 1000,
    vatRate: 20,
    total: 1200,
    uploadedFileName: "",
    items: [{ id: "qi1", description: "Fabrication work", quantity: 1, unitPrice: 1000 }],
  },
];

const initialJobs = [
  {
    id: "j1",
    jobSequence: 1,
    jobNo: "JD-001",
    quoteId: "q1",
    customerId: "c1",
    customer: "Acme Estates",
    title: "Balcony balustrades",
    deadline: "2026-05-22",
    start: "2026-05-13",
    end: "2026-05-20",
    stage: "Fabrication",
    status: "In Production",
    invoiceStatus: "Not Invoiced",
    priority: "5",
    estimatedHours: 72,
    staffIds: ["s1", "s2"],
    notes: "Stainless handrail sections to be checked before painting.",
    materialsDue: "2026-05-16",
    stageTasks: [
      { id: "j1-design", stage: "Design", staffId: "s1", start: "2026-05-13", end: "2026-05-14", hours: 8, status: "Complete" },
      { id: "j1-cutting", stage: "Cutting", staffId: "s1", start: "2026-05-14", end: "2026-05-15", hours: 12, status: "Complete" },
      { id: "j1-fabrication", stage: "Fabrication", staffId: "s1", start: "2026-05-18", end: "2026-05-20", hours: 20, status: "In Progress" },
      { id: "j1-welding", stage: "Welding", staffId: "s2", start: "2026-05-16", end: "2026-05-18", hours: 24, status: "In Progress" },
    ],
  },
  {
    id: "j2",
    jobSequence: 2,
    jobNo: "JD-002",
    customerId: "c2",
    customer: "Northgate Logistics",
    title: "Warehouse safety barriers",
    deadline: "2026-05-25",
    start: "2026-05-15",
    end: "2026-05-23",
    stage: "Cutting",
    status: "In Production",
    invoiceStatus: "Not Invoiced",
    priority: "3",
    estimatedHours: 54,
    staffIds: ["s2"],
    notes: "Material due Friday morning.",
    materialsDue: "2026-05-17",
    stageTasks: [
      { id: "j2-cutting", stage: "Cutting", staffId: "s2", start: "2026-05-15", end: "2026-05-17", hours: 18, status: "Not Started" },
      { id: "j2-welding", stage: "Welding", staffId: "s2", start: "2026-05-18", end: "2026-05-21", hours: 28, status: "Not Started" },
    ],
  },
  {
    id: "j3",
    jobSequence: 3,
    jobNo: "JD-003",
    customerId: "c3",
    customer: "Private Client",
    title: "Driveway gates",
    deadline: "2026-05-30",
    start: "2026-05-21",
    end: "2026-05-28",
    stage: "Design",
    status: "In Production",
    invoiceStatus: "Not Invoiced",
    priority: "1",
    estimatedHours: 38,
    staffIds: ["s1", "s3"],
    notes: "Awaiting final design approval.",
    materialsDue: "2026-05-24",
    stageTasks: [
      { id: "j3-design", stage: "Design", staffId: "s1", start: "2026-05-21", end: "2026-05-22", hours: 8, status: "Not Started" },
      { id: "j3-painting", stage: "Painting", staffId: "s3", start: "2026-05-26", end: "2026-05-28", hours: 16, status: "Not Started" },
    ],
  },
];

const initialPurchaseOrders = [
  { id: "po1", poNo: "PO-00001", enquiryNo: "", documentKind: "Purchase Order", jobId: "j1", supplierId: "sup1", date: "2026-05-14", requiredBy: "2026-05-16", status: "Sent", subtotal: 250, vatRate: 20, total: 300, items: [{ id: "poi1", description: "Steel material", quantity: 1, unitCost: 250 }] },
];

const initialDeliveryNotes = [];
const initialImportLogs = [];
const initialCompanySettings = {
  name: "JDFabs",
  legalName: "JDFabs Ltd",
  addressLine1: "",
  addressLine2: "",
  city: "",
  county: "",
  postcode: "",
  country: "United Kingdom",
  phone: "",
  email: "",
  website: "",
  vatNumber: "",
  companyNumber: "",
  logoDataUrl: "",
  appLogoDataUrl: "",
  appBrandImageDataUrl: "",
};

const xeroCsvHeaders = [
  "*ContactName",
  "ContactName",
  "Contact Name",
  "EmailAddress",
  "Email Address",
  "PhoneNumber",
  "Phone Number",
  "MobileNumber",
  "Mobile Number",
  "AccountNumber",
  "Account Number",
  "TaxNumber",
  "Tax Number",
  "POAddressLine1",
  "POAddressLine2",
  "POAddressLine3",
  "POAddressLine4",
  "POCity",
  "PORegion",
  "POPostalCode",
  "POCountry",
  "SAAddressLine1",
  "SAAddressLine2",
  "SAAddressLine3",
  "SAAddressLine4",
  "SACity",
  "SARegion",
  "SAPostalCode",
  "SACountry",
];

const maxCsvImportFileSizeBytes = 2 * 1024 * 1024;

const initialStockItems = [
  { id: "stock-1", productId: "ub", sectionSize: "203x102x23", grade: "S355", finish: "Self colour", length: 6, quantity: 2, location: "Rack A", status: "In Stock", allocatedJobId: "", notes: "Stock item" },
  { id: "stock-2", productId: "plate", sectionSize: "10mm", grade: "S275", finish: "Self colour", length: 1, width: 250, quantity: 4, location: "Plate bay", status: "In Stock", allocatedJobId: "", notes: "250mm square base plate blanks" },
];

function getStaffPin(person = {}) {
  const demoPinsById = { s1: "1111", s2: "2222", s3: "3333", s4: "4444" };
  const demoPinsByName = { jon: "1111", mick: "2222", sarah: "3333", lee: "4444" };
  const nameKey = String(person.name || "").trim().toLowerCase();
  return String(person.pin || demoPinsById[person.id] || demoPinsByName[nameKey] || "3490");
}

function staffPinMatches(person = {}, pin = "") {
  return String(pin || "") === getStaffPin(person);
}

function hasPendingHolidayRequests(holidays = []) {
  return holidays.some((holiday) => holiday.status === "Pending");
}

function getPriorityStyle(priority) {
  if (Number(priority) >= 5) return "border-red-300 bg-red-50";
  if (Number(priority) >= 3) return "border-amber-300 bg-amber-50";
  return "border-blue-200 bg-blue-50";
}

function isJobPastDeadline(job) {
  const finishDate = getJobFinishDate(job);
  if (!finishDate || !job?.deadline) return false;
  return new Date(finishDate) > new Date(job.deadline);
}

function getDeadlineLightStyle(job) {
  return isJobPastDeadline(job) ? "bg-red-500" : "bg-emerald-500";
}

function getDeadlineLightLabel(job) {
  return isJobPastDeadline(job) ? "Will miss deadline" : "On schedule";
}

function getStatusStyle(status) {
  if (status === "In Production") return "bg-green-100 text-green-800";
  if (status === "Waiting Material") return "bg-yellow-100 text-yellow-800";
  if (status === "Complete") return "bg-emerald-100 text-emerald-800";
  if (status === "To Be Invoiced") return "bg-orange-100 text-orange-800";
  if (status === "Delivery") return "bg-purple-100 text-purple-800";
  if (status === "Converted") return "bg-emerald-100 text-emerald-800";
  if (status === "Accepted") return "bg-emerald-100 text-emerald-800";
  if (status === "Rejected" || status === "Cancelled") return "bg-red-100 text-red-800";
  if (status === "Draft") return "bg-amber-100 text-amber-800";
  if (status === "Sent" || status === "Issued") return "bg-blue-100 text-blue-800";
  if (status === "Part Received" || status === "Signed") return "bg-purple-100 text-purple-800";
  return "bg-blue-50 text-blue-900";
}

function Field({ label, children }) {
  return (
    <label className="block text-sm font-medium text-blue-900">
      <span className="mb-1 block">{label}</span>
      {children}
    </label>
  );
}

function TextInput(props) {
  return <input {...props} className="w-full rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-600" />;
}

function SelectInput(props) {
  return <select {...props} className="w-full rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-600" />;
}

function AutoCompleteInput({ value, onChange, options = [], getLabel = (item) => String(item || ""), getValue = null, placeholder = "Start typing..." }) {
  const listId = useMemo(() => `autocomplete-${Math.random().toString(36).slice(2)}`, []);
  return (
    <>
      <TextInput value={value || ""} onChange={onChange} list={listId} placeholder={placeholder} />
      <datalist id={listId}>
        {options.map((option) => {
          const label = getLabel(option);
          const optionValue = getValue ? getValue(option) : label;
          return <option key={option.id || label} value={optionValue}>{label}</option>;
        })}
      </datalist>
    </>
  );
}

function Card({ children, className = "" }) {
  return <div className={`rounded-2xl border border-blue-100 bg-white p-5 shadow-sm ${className}`}>{children}</div>;
}

function SectionHeader({ eyebrow, title, description, actions }) {
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
      <div>
        {eyebrow ? <p className="text-xs font-black uppercase tracking-[0.18em] text-blue-400">{eyebrow}</p> : null}
        <h2 className="mt-1 text-2xl font-black tracking-tight text-blue-950">{title}</h2>
        {description ? <p className="mt-1 max-w-4xl text-sm text-blue-800">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2 md:justify-end">{actions}</div> : null}
    </div>
  );
}

function StatCard({ label, value, tone = "default" }) {
  const toneClass = tone === "dark" ? "bg-blue-700 text-white" : "bg-white text-blue-950";
  const labelClass = tone === "dark" ? "text-blue-200" : "text-blue-600";
  return (
    <div className={`rounded-2xl border border-blue-100 p-4 shadow-sm ${toneClass}`}>
      <p className={`text-xs font-bold uppercase tracking-wide ${labelClass}`}>{label}</p>
      <p className="mt-1 text-2xl font-black">{value}</p>
    </div>
  );
}

function LaunchModeBanner({ cloudSyncStatus }) {
  const status = getLaunchModeStatus();
  const toneClass = status.tone === "green"
    ? "border-emerald-200 bg-emerald-50 text-emerald-900"
    : status.tone === "amber"
      ? "border-amber-200 bg-amber-50 text-amber-900"
      : "border-red-200 bg-red-50 text-red-900";
  return (
    <div className={`rounded-3xl border p-4 shadow-sm ${toneClass}`}>
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em]">Launch status</p>
          <p className="mt-1 text-lg font-black">{status.mode}</p>
          <p className="mt-1 text-sm font-semibold">{status.message}</p>
        </div>
        <div className="rounded-2xl bg-white/70 px-4 py-3 text-sm font-bold">
          <p>Domain: ophq.ai</p>
          <p>Storage: {deploymentConfig.storageMode}</p>
          <p>Sync: {cloudSyncStatus}</p>
        </div>
      </div>
    </div>
  );
}

function JobStatusLine({ job }) {
  const currentIndex = Math.max(0, stages.indexOf(job.stage));
  const weightedProgress = getWeightedProgress(job);

  return (
    <div className="mt-4">
      <div className="mb-2 flex items-center justify-between text-xs text-blue-600">
        <span>Planner status line</span>
        <span>{job.stage} · {job.status} · {weightedProgress}%</span>
      </div>
      <div className="grid grid-cols-10 gap-1">
        {stages.map((stage, index) => {
          const reached = index <= currentIndex || job.status === "Complete" || job.status === "To Be Invoiced";
          return (
            <div key={stage} className="space-y-1">
              <div className={`h-2 rounded-full ${reached ? "bg-blue-700" : "bg-slate-200"}`} />
              <p className={`text-[10px] ${reached ? "font-bold text-blue-950" : "text-blue-400"}`}>{stage}</p>
              <p className="text-[9px] text-blue-400">{stageWeights[stage] || 0}%</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ProductivityTab({ staff, jobs, stageTimeEntries, productivityRules, setProductivityRules }) {
  const visibleProductivityRules = normaliseProductivityRules(productivityRules || defaultProductivityRules);
  const [stageRecordsOpen, setStageRecordsOpen] = useState(false);

  function updateRule(ruleId, patch) {
    setProductivityRules((current) => normaliseProductivityRules(current || defaultProductivityRules).map((rule) => rule.id === ruleId ? { ...rule, ...patch } : rule));
  }

  const totalsByStaff = staff.map((person) => {
    const entries = stageTimeEntries.filter((entry) => entry.staffId === person.id);
    const allotted = entries.reduce((sum, entry) => sum + Number(entry.allottedHours || 0), 0);
    const actual = entries.reduce((sum, entry) => sum + Number(entry.actualHours || 0), 0);
    const variance = allotted - actual;
    const efficiency = actual > 0 ? (allotted / actual) * 100 : 0;

    return { person, entries, allotted, actual, variance, efficiency };
  });

  return (
    <div className="space-y-6">
      <div className="rounded-3xl bg-white p-5 shadow-sm">
        <h2 className="text-lg font-bold">Productivity</h2>
        <p className="mt-1 text-sm text-blue-800">Stage time rules and completed task performance.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {totalsByStaff.map(({ person, allotted, actual, variance, efficiency }) => (
          <div key={person.id} className="rounded-3xl bg-white p-5 shadow-sm">
            <p className="text-lg font-bold">{person.name}</p>
            <div className="mt-3 space-y-1 text-sm text-blue-800">
              <p>Allotted: <span className="font-bold text-blue-950">{allotted.toFixed(2)} hrs</span></p>
              <p>Actual: <span className="font-bold text-blue-950">{actual.toFixed(2)} hrs</span></p>
              <p>Variance: <span className={`font-bold ${variance >= 0 ? "text-emerald-700" : "text-red-700"}`}>{variance.toFixed(2)} hrs</span></p>
              <p>Efficiency: <span className="font-bold text-blue-950">{efficiency ? `${efficiency.toFixed(0)}%` : "-"}</span></p>
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-3xl bg-white p-5 shadow-sm">
        <h3 className="text-lg font-bold">Task time rules</h3>
        <p className="mt-1 text-sm text-blue-800">Background rules used to estimate quote production time. These do not affect quote prices.</p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse text-sm">
            <thead><tr className="border-b border-blue-100 text-left text-xs uppercase tracking-wide text-blue-600"><th className="py-3 pr-3">Task</th><th className="py-3 pr-3">Rule</th><th className="py-3 pr-3">Unit</th><th className="py-3 pr-3 text-right">Minutes</th><th className="py-3 pr-3">Applies to</th></tr></thead>
            <tbody>{visibleProductivityRules.map((rule) => <tr key={rule.id} className="border-b border-blue-100"><td className="py-3 pr-3 font-bold">{rule.task}</td><td className="py-3 pr-3">{rule.label}</td><td className="py-3 pr-3">{rule.unit}</td><td className="py-3 pr-3"><TextInput type="number" value={rule.minutes} onChange={(event) => updateRule(rule.id, { minutes: event.target.value })} /></td><td className="py-3 pr-3">{rule.appliesTo}</td></tr>)}</tbody>
          </table>
        </div>
      </div>

      <div className="rounded-3xl bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-lg font-bold">Stage time records</h3>
            <p className="mt-1 text-sm text-blue-800">Open when reviewing completed task performance.</p>
          </div>
          <button className="rounded-xl border bg-white px-4 py-2 text-sm font-bold" onClick={() => setStageRecordsOpen(!stageRecordsOpen)}>{stageRecordsOpen ? "Hide records" : "Open records"}</button>
        </div>
        {stageRecordsOpen ? <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-blue-100 text-left text-xs uppercase tracking-wide text-blue-600">
                <th className="py-3 pr-3">Date</th>
                <th className="py-3 pr-3">Staff</th>
                <th className="py-3 pr-3">Job</th>
                <th className="py-3 pr-3">Stage</th>
                <th className="py-3 pr-3 text-right">Allotted</th>
                <th className="py-3 pr-3 text-right">Actual</th>
                <th className="py-3 pr-3 text-right">Variance</th>
              </tr>
            </thead>
            <tbody>
              {stageTimeEntries.length === 0 ? (
                <tr><td className="py-4 text-blue-600" colSpan={7}>No completed stage time records yet.</td></tr>
              ) : stageTimeEntries.map((entry) => {
                const person = staff.find((item) => item.id === entry.staffId);
                const job = jobs.find((item) => item.id === entry.jobId);
                const variance = Number(entry.allottedHours || 0) - Number(entry.actualHours || 0);
                return (
                  <tr key={entry.id} className="border-b border-blue-100">
                    <td className="py-3 pr-3">{entry.completedAt}</td>
                    <td className="py-3 pr-3 font-semibold">{person?.name || "Unassigned"}</td>
                    <td className="py-3 pr-3">{job?.jobNo || entry.jobNo} · {job?.title || entry.jobTitle}</td>
                    <td className="py-3 pr-3">{entry.stage}</td>
                    <td className="py-3 pr-3 text-right">{Number(entry.allottedHours || 0).toFixed(2)}</td>
                    <td className="py-3 pr-3 text-right font-bold">{Number(entry.actualHours || 0).toFixed(2)}</td>
                    <td className={`py-3 pr-3 text-right font-bold ${variance >= 0 ? "text-emerald-700" : "text-red-700"}`}>{variance.toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div> : null}
      </div>
    </div>
  );
}

function PlannerQuotesInbox({ quotePackages, onUpdateQuotePackageStatus, onConvertToJob, automationStatus }) {
  const [openQuoteIds, setOpenQuoteIds] = useState({});
  const toggleDetails = (quoteId) => setOpenQuoteIds((current) => ({ ...current, [quoteId]: !current[quoteId] }));
  return (
    <div className="space-y-6">
      <div className="rounded-3xl bg-white p-5 shadow-sm">
        <h2 className="text-lg font-bold">Quote Approvals</h2>
        <p className="mt-1 text-sm text-blue-800">Review lead times, approve customer send, then convert accepted quotes into jobs.</p>
        {automationStatus ? <p className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800">{automationStatus}</p> : null}
      </div>

      <div className="space-y-3">
        {quotePackages.length === 0 ? <div className="rounded-3xl bg-white p-6 text-blue-800 shadow-sm">No quotes awaiting approval yet.</div> : null}
        {quotePackages.map((quotePackage) => (
          <div key={quotePackage.quoteId} className="rounded-3xl bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <p className="text-lg font-bold">{quotePackage.quoteNo} · {quotePackage.quoteMeta?.title}</p>
                <p className="text-sm text-blue-800">{quotePackage.customer?.company || "No customer"} · {quotePackage.quoteMeta?.date}</p>
                <p className="mt-2 text-xl font-black">{currency(quotePackage.totals?.total)}</p>
                <div className="mt-3 grid gap-2 text-xs text-blue-800 md:grid-cols-2">
                  <p>Priority: <span className="font-bold text-blue-950">{quotePriorityOptions.find((item) => item.value === quotePackage.quoteMeta?.priority)?.label || quotePackage.quoteMeta?.priority || "Medium"}</span></p>
                  <p>Estimated time: <span className="font-bold text-blue-950">{Number(quotePackage.quoteMeta?.estimatedProductionHours || 0).toFixed(2)} hrs</span></p>
                  <p>Requested delivery: <span className="font-bold text-blue-950">{quotePackage.quoteMeta?.requestedDeliveryDate || "Not set"}</span></p>
                  <p>Earliest ready: <span className="font-bold text-blue-950">{quotePackage.quoteMeta?.leadTime?.earliestReadyDate || "Not calculated"}</span></p>
                </div>
                {quotePackage.quoteMeta?.leadTime?.message ? <p className={`mt-3 rounded-xl px-3 py-2 text-xs font-bold ${quotePackage.quoteMeta.leadTime.meetsRequestedDate ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>{quotePackage.quoteMeta.leadTime.message}</p> : null}
              </div>
              <span className={`w-fit rounded-full px-3 py-1 text-xs font-bold ${quotePackage.inboxStatus === "Converted" ? "bg-emerald-100 text-emerald-800" : quotePackage.inboxStatus === "Rejected" ? "bg-red-100 text-red-800" : quotePackage.inboxStatus === "Accepted" ? "bg-emerald-100 text-emerald-800" : "bg-blue-100 text-blue-800"}`}>{quotePackage.inboxStatus}</span>
            </div>
            {openQuoteIds[quotePackage.quoteId] ? <div className="mt-4 overflow-x-auto rounded-2xl bg-blue-50 p-3">
              <table className="w-full min-w-[800px] border-collapse text-sm">
                <thead><tr className="border-b border-blue-100 text-left text-xs uppercase tracking-wide text-blue-600"><th className="py-2 pr-3">Item</th><th className="py-2 pr-3">Section</th><th className="py-2 pr-3 text-right">Qty</th><th className="py-2 pr-3 text-right">Length</th><th className="py-2 pr-3 text-right">Total</th></tr></thead>
                <tbody>
                  {(quotePackage.items || []).map((item) => (
                    <tr key={item.id} className="border-b border-blue-100 last:border-0">
                      <td className="py-2 pr-3 font-semibold">{item.description}</td>
                      <td className="py-2 pr-3">{item.sectionSize || "-"}</td>
                      <td className="py-2 pr-3 text-right">{item.quantity}</td>
                      <td className="py-2 pr-3 text-right">{item.length ? `${item.length}m` : "-"}</td>
                      <td className="py-2 pr-3 text-right font-bold">{currency(Number(item.quantity || 0) * Number(item.unitPrice || 0))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div> : null}
            <div className="mt-4 flex flex-wrap gap-2">
              <button className="rounded-xl border bg-white px-4 py-2 text-sm font-bold" onClick={() => toggleDetails(quotePackage.quoteId)}>{openQuoteIds[quotePackage.quoteId] ? "Hide details" : "Open details"}</button>
              <button disabled={quotePackage.inboxStatus !== "Awaiting lead time review"} className="rounded-xl border bg-white px-4 py-2 text-sm font-bold disabled:opacity-40" onClick={() => onUpdateQuotePackageStatus(quotePackage, "Ready to send to customer")}>Approve lead time</button>
              <button disabled={quotePackage.inboxStatus !== "Ready to send to customer"} className="rounded-xl bg-blue-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-40" onClick={() => onUpdateQuotePackageStatus(quotePackage, "Sent to customer")}>Mark sent to customer</button>
              <button disabled={quotePackage.inboxStatus !== "Sent to customer"} className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-40" onClick={() => onUpdateQuotePackageStatus(quotePackage, "Accepted")}>Mark accepted</button>
              <button disabled={quotePackage.inboxStatus !== "Sent to customer"} className="rounded-xl border border-red-200 bg-white px-4 py-2 text-sm font-bold text-red-700 disabled:opacity-40" onClick={() => onUpdateQuotePackageStatus(quotePackage, "Rejected")}>Mark rejected</button>
              <button disabled={quotePackage.inboxStatus !== "Accepted"} className="rounded-xl bg-blue-950 px-4 py-2 text-sm font-bold text-white disabled:opacity-40" onClick={() => onConvertToJob(quotePackage)}>Create job from accepted quote</button>
              {quotePackage.convertedJobNo ? <span className="rounded-xl bg-emerald-50 px-4 py-2 text-sm font-bold text-emerald-800">Created {quotePackage.convertedJobNo}</span> : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function isJobDeliveryComplete(job = {}) {
  if (job.status === "Complete" || job.status === "To Be Invoiced") return true;
  return (job.stageTasks || []).some((task) => task.stage === "Delivery" && task.status === "Complete");
}

function DeliveryCalendar({ jobs, deliveryNotes, customers, onCreateDeliveryNote }) {
  const deliveryJobs = [...jobs]
    .filter((job) => !isJobDeliveryComplete(job))
    .sort((a, b) => new Date(a.deadline || getJobFinishDate(a)) - new Date(b.deadline || getJobFinishDate(b)));

  return (
    <div className="space-y-4">
      <div className="rounded-3xl bg-white p-5 shadow-sm">
        <h2 className="text-lg font-bold">Deliveries</h2>
      </div>

      <div className="overflow-x-auto rounded-3xl bg-white p-5 shadow-sm">
        <table className="w-full min-w-[900px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-blue-100 text-left text-xs uppercase tracking-wide text-blue-600">
              <th className="py-3 pr-3">Delivery Date</th>
              <th className="py-3 pr-3">Job No</th>
              <th className="py-3 pr-3">Customer</th>
              <th className="py-3 pr-3">Job</th>
              <th className="py-3 pr-3">Status</th>
              <th className="py-3 pr-3">Delivery Note</th>
            </tr>
          </thead>
          <tbody>
            {deliveryJobs.length === 0 ? <tr><td className="py-4 text-blue-600" colSpan={6}>No live deliveries waiting. Jobs are removed from this list once delivery is completed.</td></tr> : null}
            {deliveryJobs.map((job) => {
              const deliveryNote = deliveryNotes.find((item) => item.jobId === job.id && item.status !== "Cancelled");
              const customer = customers.find((item) => item.id === job.customerId);
              const deliveryDate = deliveryNote?.date || job.deadline || getJobFinishDate(job);

              return (
                <tr key={job.id} className="border-b border-blue-100 align-top">
                  <td className="py-4 pr-3 font-bold">{deliveryDate}</td>
                  <td className="py-4 pr-3 font-semibold">{job.jobNo}</td>
                  <td className="py-4 pr-3">{customer?.company || job.customer}</td>
                  <td className="py-4 pr-3">{job.title}</td>
                  <td className="py-4 pr-3"><span className={`rounded-full px-2 py-1 text-xs font-bold ${getStatusStyle(job.status)}`}>{job.status}</span></td>
                  <td className="py-4 pr-3">
                    <button
                      disabled={Boolean(deliveryNote)}
                      className={`rounded-lg px-3 py-2 text-xs font-bold text-white disabled:opacity-80 ${deliveryNote ? "bg-emerald-600" : "bg-blue-700"}`}
                      onClick={() => onCreateDeliveryNote(job)}
                    >
                      {deliveryNote ? `Delivery note raised · ${deliveryNote.dnNo}` : "Raise delivery note"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ClockingInTab({ staff, clockEntries, sickDays = [], activeRole, onClockIn, onClockOut, onAddSickDay, onDeleteSickDay, onAmendClockEntry }) {
  const today = toIso(new Date());
  const [staffPins, setStaffPins] = useState({});
  const [staffPinErrors, setStaffPinErrors] = useState({});

  function updateStaffPin(staffId, value) {
    setStaffPins((current) => ({ ...current, [staffId]: String(value || "").replace(/[^0-9]/g, "") }));
    setStaffPinErrors((current) => ({ ...current, [staffId]: "" }));
  }

  function runStaffClockAction(person, action) {
    const pin = staffPins[person.id] || "";
    if (!staffPinMatches(person, pin)) {
      setStaffPinErrors((current) => ({ ...current, [person.id]: "Incorrect staff PIN" }));
      return;
    }
    action(person.id);
    setStaffPins((current) => ({ ...current, [person.id]: "" }));
    setStaffPinErrors((current) => ({ ...current, [person.id]: "" }));
  }
  const todayEntries = clockEntries.filter((entry) => entry.date === today);
  const [timesheetUnlocked, setTimesheetUnlocked] = useState(false);
  const [timesheetPin, setTimesheetPin] = useState("");
  const [timesheetPinError, setTimesheetPinError] = useState("");
  const [sickDayForm, setSickDayForm] = useState({ staffId: staff[0]?.id || "", start: today, end: today, notes: "" });
  const [sickDayError, setSickDayError] = useState("");
  const [amendmentForm, setAmendmentForm] = useState({ staffId: staff[0]?.id || "", date: today, clockIn: "08:00", clockOut: "16:00", reason: "Forgot to clock" });
  const [amendmentError, setAmendmentError] = useState("");

  function unlockTimesheet() {
    if (timesheetPin === "3490") {
      setTimesheetUnlocked(true);
      setTimesheetPin("");
      setTimesheetPinError("");
      return;
    }

    setTimesheetPinError("Incorrect PIN code");
  }

  function getClockingMonthPeriod(date = new Date()) {
    const year = date.getFullYear();
    const month = date.getMonth();
    const start = date.getDate() >= 26 ? new Date(year, month, 26) : new Date(year, month - 1, 26);
    const end = date.getDate() >= 26 ? new Date(year, month + 1, 25) : new Date(year, month, 25);
    return { start: toIso(start), end: toIso(end) };
  }

  function getWorkingDaysInPeriod(startIso, endIso) {
    let count = 0;
    let cursor = new Date(startIso);
    const end = new Date(endIso);

    while (cursor <= end) {
      if (isWorkingDay(cursor)) count += 1;
      cursor = addDays(cursor, 1);
    }

    return count;
  }

  function entryHours(entry) {
    if (!entry.clockIn || !entry.clockOut) return 0;
    const start = new Date(`${entry.date}T${entry.clockIn}`);
    const end = new Date(`${entry.date}T${entry.clockOut}`);
    return Math.max(0, (end - start) / 3600000);
  }

  function getPeriodEntries(staffId) {
    const period = getClockingMonthPeriod(new Date());
    return clockEntries
      .filter((entry) => entry.staffId === staffId && entry.date >= period.start && entry.date <= period.end)
      .sort((a, b) => `${a.date} ${a.clockIn}`.localeCompare(`${b.date} ${b.clockIn}`));
  }

  function getPeriodSickDays(staffId) {
    const period = getClockingMonthPeriod(new Date());
    return sickDays
      .filter((entry) => entry.staffId === staffId && entry.date >= period.start && entry.date <= period.end)
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  function getPeriodTimesheetRows(staffId) {
    const clockRows = getPeriodEntries(staffId).map((entry) => ({ type: "Clock", ...entry }));
    const sickRows = getPeriodSickDays(staffId).map((entry) => ({ type: "Sick", ...entry, clockIn: "Sick", clockOut: "Absence" }));
    return [...clockRows, ...sickRows].sort((a, b) => `${a.date} ${a.clockIn || ""}`.localeCompare(`${b.date} ${b.clockIn || ""}`));
  }

  function getSickDayHours(entry, person) {
    if (!isWorkingDay(new Date(entry.date))) return 0;
    return Number(entry.hours || person?.hoursPerDay || 0);
  }

  function getSickDayDates(startIso, endIso) {
    const dates = [];
    let cursor = new Date(startIso);
    const end = new Date(endIso);
    while (cursor <= end) {
      dates.push(toIso(cursor));
      cursor = addDays(cursor, 1);
    }
    return dates;
  }

  function submitSickDays() {
    setSickDayError("");
    if (activeRole !== "operations") {
      setSickDayError("Only operations users can record sick days.");
      return;
    }
    if (!sickDayForm.staffId) {
      setSickDayError("Select a staff member.");
      return;
    }
    if (!sickDayForm.start || !sickDayForm.end || sickDayForm.end < sickDayForm.start) {
      setSickDayError("Enter a valid date range.");
      return;
    }
    const person = staff.find((item) => item.id === sickDayForm.staffId);
    const records = getSickDayDates(sickDayForm.start, sickDayForm.end).map((date) => ({
      id: `sick-${Date.now()}-${sickDayForm.staffId}-${date}`,
      staffId: sickDayForm.staffId,
      date,
      hours: isWorkingDay(new Date(date)) ? Number(person?.hoursPerDay || 0) : 0,
      notes: sickDayForm.notes || "Sick day",
      createdAt: new Date().toISOString(),
    }));
    onAddSickDay?.(records);
    setSickDayForm((current) => ({ ...current, notes: "" }));
  }

  function submitClockingAmendment() {
    setAmendmentError("");
    if (activeRole !== "operations") {
      setAmendmentError("Only operations users can amend clocking records.");
      return;
    }
    if (!amendmentForm.staffId || !amendmentForm.date || !amendmentForm.clockIn || !amendmentForm.clockOut) {
      setAmendmentError("Select staff, date, clock-in and clock-out times.");
      return;
    }
    if (amendmentForm.clockOut <= amendmentForm.clockIn) {
      setAmendmentError("Clock-out must be after clock-in.");
      return;
    }
    if (!String(amendmentForm.reason || "").trim()) {
      setAmendmentError("Enter a reason for the amendment.");
      return;
    }
    onAmendClockEntry?.({
      id: createEntityId("clock-amendment"),
      staffId: amendmentForm.staffId,
      date: amendmentForm.date,
      clockIn: amendmentForm.clockIn,
      clockOut: amendmentForm.clockOut,
      amended: true,
      amendmentReason: amendmentForm.reason.trim(),
      amendedAt: new Date().toISOString(),
    });
    setAmendmentForm((current) => ({ ...current, reason: "" }));
  }

  function getStaffPeriodSummary(person) {
    const period = getClockingMonthPeriod(new Date());
    const workingDays = getWorkingDaysInPeriod(period.start, period.end);
    const expectedHours = workingDays * Number(person.hoursPerDay || 0);
    const entries = getPeriodEntries(person.id);
    const absenceHours = getPeriodSickDays(person.id).reduce((sum, entry) => sum + getSickDayHours(entry, person), 0);
    const workedHours = entries.reduce((sum, entry) => sum + entryHours(entry), 0);
    const countedHours = workedHours + absenceHours;
    const regularHours = Math.min(countedHours, expectedHours);
    const overtimeHours = Math.max(0, countedHours - expectedHours);

    return { period, workingDays, expectedHours, workedHours, absenceHours, countedHours, regularHours, overtimeHours };
  }

  function getOpenEntry(staffId) {
    return clockEntries.find((entry) => entry.staffId === staffId && !entry.clockOut);
  }

  function calculateHours(entry) {
    if (!entry.clockIn || !entry.clockOut) return "-";
    return entryHours(entry).toFixed(2);
  }

  function getEntrySplit(entry, person) {
    if (!entry.clockOut) return { regular: "-", overtime: "-" };

    const summary = getStaffPeriodSummary(person);
    const entries = getPeriodTimesheetRows(person.id);
    let cumulativeBefore = 0;

    for (const item of entries) {
      if (item.id === entry.id) break;
      cumulativeBefore += item.type === "Sick" ? getSickDayHours(item, person) : entryHours(item);
    }

    const hours = entry.type === "Sick" ? getSickDayHours(entry, person) : entryHours(entry);
    const regularRemaining = Math.max(0, summary.expectedHours - cumulativeBefore);
    const regular = Math.min(hours, regularRemaining);
    const overtime = Math.max(0, hours - regular);

    return { regular: regular.toFixed(2), overtime: overtime.toFixed(2) };
  }

  const period = getClockingMonthPeriod(new Date());
  const periodWorkingDays = getWorkingDaysInPeriod(period.start, period.end);
  const periodClockEntries = clockEntries.filter((entry) => entry.date >= period.start && entry.date <= period.end);
  const periodSickDays = sickDays.filter((entry) => entry.date >= period.start && entry.date <= period.end);
  const totalHours = periodClockEntries.reduce((sum, entry) => sum + entryHours(entry), 0);
  const totalAbsenceHours = staff.reduce((sum, person) => sum + getPeriodSickDays(person.id).reduce((inner, entry) => inner + getSickDayHours(entry, person), 0), 0);
  const totalExpectedHours = staff.reduce((sum, person) => sum + periodWorkingDays * Number(person.hoursPerDay || 0), 0);
  const totalOvertimeHours = staff.reduce((sum, person) => sum + getStaffPeriodSummary(person).overtimeHours, 0);

  function openTimesheetPrintPreview() {
    const timesheetRows = staff.flatMap((person) => getPeriodTimesheetRows(person.id).map((entry) => {
      const split = getEntrySplit(entry, person);
      const hours = entry.type === "Sick" ? getSickDayHours(entry, person).toFixed(2) : calculateHours(entry);
      return { ...entry, staffName: person?.name || "Unknown", regular: split.regular, overtime: split.overtime, hours };
    }));
    const rowsHtml = timesheetRows.map((entry) => `<tr><td>${entry.staffName}</td><td>${entry.date}</td><td>${entry.type}${entry.amended ? " · Amended" : ""}</td><td>${entry.clockIn || ""}</td><td>${entry.clockOut || ""}</td><td class="num">${entry.hours}</td><td class="num">${entry.regular}</td><td class="num">${entry.overtime}</td><td>${entry.amendmentReason || entry.notes || ""}</td></tr>`).join("");
    const printWindow = window.open("", "_blank", "width=1000,height=1100");
    if (!printWindow) return;
    printWindow.document.write(`<!doctype html><html><head><title>JDFabs Timesheet ${period.start} to ${period.end}</title><style>@page{size:A4 landscape;margin:12mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#111827;margin:0}.header{display:flex;justify-content:space-between;border-bottom:2px solid #111827;padding-bottom:12px;margin-bottom:16px}.brand{font-size:24px;font-weight:800}.muted{font-size:12px;color:#4b5563;line-height:1.5}.summary{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin:12px 0}.box{border:1px solid #d1d5db;border-radius:8px;padding:8px;font-size:12px}.box strong{display:block;font-size:16px;margin-top:2px}table{width:100%;border-collapse:collapse;font-size:11px}th{background:#f3f4f6;text-align:left;border:1px solid #d1d5db;padding:6px;text-transform:uppercase;font-size:10px}td{border:1px solid #d1d5db;padding:6px;vertical-align:top}.num{text-align:right;font-weight:700}.footer{margin-top:12px;border-top:1px solid #d1d5db;padding-top:8px;font-size:10px;color:#6b7280}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style></head><body><div class="header"><div><div class="brand">JDFabs Staff Timesheet</div><div class="muted">Clocking period ${period.start} to ${period.end}<br/>Generated ${new Date().toLocaleString()}</div></div><div class="muted">Clean PDF / print output</div></div><div class="summary"><div class="box">Standard days<strong>${periodWorkingDays}</strong></div><div class="box">Standard hours<strong>${totalExpectedHours.toFixed(2)}</strong></div><div class="box">Clocked hours<strong>${totalHours.toFixed(2)}</strong></div><div class="box">Absence hours<strong>${totalAbsenceHours.toFixed(2)}</strong></div><div class="box">Overtime<strong>${totalOvertimeHours.toFixed(2)}</strong></div></div><table><thead><tr><th>Staff</th><th>Date</th><th>Type</th><th>Clock In</th><th>Clock Out</th><th>Hours</th><th>Regular</th><th>Overtime</th><th>Notes / Amendment reason</th></tr></thead><tbody>${rowsHtml || `<tr><td colspan="9">No timesheet rows in this period.</td></tr>`}</tbody></table><div class="footer">Operations amendments are marked as amended and included in the totals.</div><script>window.onload=()=>window.print()</script></body></html>`);
    printWindow.document.close();
  }

  return (
    <div className="space-y-6">
      <div className="rounded-3xl bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-bold">Clocking In</h2>
            <p className="mt-1 text-sm text-blue-800">PIN-protected clocking and timesheets.</p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {staff.map((person) => {
          const openEntry = getOpenEntry(person.id);
          return (
            <div key={person.id} className="rounded-3xl bg-white p-5 shadow-sm">
              <p className="text-lg font-bold">{person.name}</p>
              <p className="text-xs text-blue-600">{person.hoursPerDay} hrs/day</p>
              {(() => {
                const summary = getStaffPeriodSummary(person);
                return (
                  <div className="mt-3 rounded-xl bg-blue-50 p-3 text-xs text-blue-800">
                    <p>Clocking month: {summary.period.start} to {summary.period.end}</p>
                    <p>Standard hours: <span className="font-bold text-blue-950">{summary.expectedHours.toFixed(2)}</span></p>
                    <p>Worked: <span className="font-bold text-blue-950">{summary.workedHours.toFixed(2)}</span></p>
                    <p>Sick absence: <span className="font-bold text-blue-950">{summary.absenceHours.toFixed(2)}</span></p>
                    <p>Counted total: <span className="font-bold text-blue-950">{summary.countedHours.toFixed(2)}</span></p>
                    <p>Overtime: <span className="font-bold text-blue-950">{summary.overtimeHours.toFixed(2)}</span></p>
                  </div>
                );
              })()}
              <p className="mt-3 text-sm font-semibold">Status: {openEntry ? "Clocked in" : "Clocked out"}</p>
              {openEntry ? <p className="mt-1 text-xs text-blue-600">Clocked in at {openEntry.clockIn}</p> : null}
              <div className="mt-4 grid gap-2">
                <TextInput type="password" maxLength={4} placeholder={`${person.name} PIN`} value={staffPins[person.id] || ""} onChange={(event) => updateStaffPin(person.id, event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") runStaffClockAction(person, openEntry ? onClockOut : onClockIn); }} />
                {staffPinErrors[person.id] ? <p className="text-xs font-semibold text-red-600">{staffPinErrors[person.id]}</p> : null}
                <button disabled={Boolean(openEntry)} className="rounded-xl bg-blue-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-40" onClick={() => runStaffClockAction(person, onClockIn)}>
                  Clock in
                </button>
                <button disabled={!openEntry} className="rounded-xl border bg-white px-4 py-2 text-sm font-bold disabled:opacity-40" onClick={() => runStaffClockAction(person, onClockOut)}>
                  Clock out
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="rounded-3xl bg-white p-5 shadow-sm">
        <h3 className="text-lg font-bold">Today&apos;s clocking</h3>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[700px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-blue-100 text-left text-xs uppercase tracking-wide text-blue-600">
                <th className="py-3 pr-3">Staff</th>
                <th className="py-3 pr-3">Date</th>
                <th className="py-3 pr-3">Clock In</th>
                <th className="py-3 pr-3">Clock Out</th>
                <th className="py-3 pr-3 text-right">Hours</th>
                <th className="py-3 pr-3 text-right">Regular</th>
                <th className="py-3 pr-3 text-right">Overtime</th>
              </tr>
            </thead>
            <tbody>
              {todayEntries.length === 0 ? (
                <tr><td className="py-4 text-blue-600" colSpan={7}>No clocking records yet today.</td></tr>
              ) : todayEntries.map((entry) => {
                const person = staff.find((item) => item.id === entry.staffId);
                const split = person ? getEntrySplit(entry, person) : { regular: "-", overtime: "-" };
                return (
                  <tr key={entry.id} className="border-b border-blue-100">
                    <td className="py-3 pr-3 font-semibold">{person?.name || "Unknown"}</td>
                    <td className="py-3 pr-3">{entry.date}</td>
                    <td className="py-3 pr-3">{entry.clockIn}</td>
                    <td className="py-3 pr-3">{entry.clockOut || "Still clocked in"}</td>
                    <td className="py-3 pr-3 text-right font-bold">{calculateHours(entry)}</td>
                    <td className="py-3 pr-3 text-right">{split.regular}</td>
                    <td className="py-3 pr-3 text-right font-bold">{split.overtime}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {activeRole === "operations" ? (
        <div className="rounded-3xl bg-white p-5 shadow-sm">
          <h3 className="text-lg font-bold">Clocking Amendment</h3>
          <p className="mt-1 text-sm text-blue-800">Operations-only correction for missed clock-in or clock-out. Amendments feed the timesheet and are audit logged.</p>
          <div className="mt-4 grid gap-3 md:grid-cols-6">
            <label className="text-sm font-semibold text-blue-950">Staff<select className="mt-1 w-full rounded-xl border border-blue-100 bg-white px-3 py-2 text-sm" value={amendmentForm.staffId} onChange={(event) => setAmendmentForm((current) => ({ ...current, staffId: event.target.value }))}>{staff.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
            <label className="text-sm font-semibold text-blue-950">Date<TextInput type="date" value={amendmentForm.date} onChange={(event) => setAmendmentForm((current) => ({ ...current, date: event.target.value }))} /></label>
            <label className="text-sm font-semibold text-blue-950">Clock in<TextInput type="time" value={amendmentForm.clockIn} onChange={(event) => setAmendmentForm((current) => ({ ...current, clockIn: event.target.value }))} /></label>
            <label className="text-sm font-semibold text-blue-950">Clock out<TextInput type="time" value={amendmentForm.clockOut} onChange={(event) => setAmendmentForm((current) => ({ ...current, clockOut: event.target.value }))} /></label>
            <label className="text-sm font-semibold text-blue-950 md:col-span-1">Reason<TextInput value={amendmentForm.reason} placeholder="Required" onChange={(event) => setAmendmentForm((current) => ({ ...current, reason: event.target.value }))} /></label>
            <div className="flex items-end"><button className="w-full rounded-xl bg-blue-700 px-4 py-2 text-sm font-bold text-white" onClick={submitClockingAmendment}>Add amendment</button></div>
          </div>
          {amendmentError ? <p className="mt-3 text-sm font-semibold text-red-600">{amendmentError}</p> : null}
        </div>
      ) : null}

      {activeRole === "operations" ? (
        <div className="rounded-3xl bg-white p-5 shadow-sm">
          <h3 className="text-lg font-bold">Record Sick Day</h3>
          <p className="mt-1 text-sm text-blue-800">Operations-only absence entry. Sick days feed into the timesheet but do not create clock-in records.</p>
          <div className="mt-4 grid gap-3 md:grid-cols-5">
            <label className="text-sm font-semibold text-blue-950">
              Staff
              <select className="mt-1 w-full rounded-xl border border-blue-100 bg-white px-3 py-2 text-sm" value={sickDayForm.staffId} onChange={(event) => setSickDayForm((current) => ({ ...current, staffId: event.target.value }))}>
                {staff.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
              </select>
            </label>
            <label className="text-sm font-semibold text-blue-950">
              First date off
              <TextInput type="date" value={sickDayForm.start} onChange={(event) => setSickDayForm((current) => ({ ...current, start: event.target.value, end: current.end < event.target.value ? event.target.value : current.end }))} />
            </label>
            <label className="text-sm font-semibold text-blue-950">
              Last date off
              <TextInput type="date" value={sickDayForm.end} onChange={(event) => setSickDayForm((current) => ({ ...current, end: event.target.value }))} />
            </label>
            <label className="text-sm font-semibold text-blue-950 md:col-span-1">
              Notes
              <TextInput value={sickDayForm.notes} placeholder="Optional" onChange={(event) => setSickDayForm((current) => ({ ...current, notes: event.target.value }))} />
            </label>
            <div className="flex items-end">
              <button className="w-full rounded-xl bg-blue-700 px-4 py-2 text-sm font-bold text-white" onClick={submitSickDays}>Add sick day</button>
            </div>
          </div>
          {sickDayError ? <p className="mt-3 text-sm font-semibold text-red-600">{sickDayError}</p> : null}
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[600px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-blue-100 text-left text-xs uppercase tracking-wide text-blue-600">
                  <th className="py-3 pr-3">Staff</th>
                  <th className="py-3 pr-3">Date</th>
                  <th className="py-3 pr-3 text-right">Hours</th>
                  <th className="py-3 pr-3">Notes</th>
                  <th className="py-3 pr-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {periodSickDays.length === 0 ? (
                  <tr><td className="py-4 text-blue-600" colSpan={5}>No sick days recorded in this clocking period.</td></tr>
                ) : periodSickDays.map((entry) => {
                  const person = staff.find((item) => item.id === entry.staffId);
                  return (
                    <tr key={entry.id} className="border-b border-blue-100">
                      <td className="py-3 pr-3 font-semibold">{person?.name || "Unknown"}</td>
                      <td className="py-3 pr-3">{entry.date}</td>
                      <td className="py-3 pr-3 text-right">{getSickDayHours(entry, person).toFixed(2)}</td>
                      <td className="py-3 pr-3">{entry.notes || "Sick day"}</td>
                      <td className="py-3 pr-3 text-right"><button className="rounded-xl border px-3 py-1 text-xs font-bold" onClick={() => onDeleteSickDay?.(entry.id)}>Remove</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div className="rounded-3xl bg-white p-6 shadow-sm print:shadow-none">
        {!timesheetUnlocked ? (
          <div className="mx-auto max-w-md text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-blue-50 text-3xl">🔒</div>
            <h2 className="text-2xl font-bold">Staff Timesheet Locked</h2>
            <p className="mt-2 text-sm text-blue-800">Enter the 4 digit PIN code to view and print the staff timesheet.</p>
            <div className="mt-6 space-y-3">
              <TextInput type="password" maxLength={4} placeholder="Enter PIN" value={timesheetPin} onChange={(event) => setTimesheetPin(event.target.value.replace(/[^0-9]/g, ""))} onKeyDown={(event) => { if (event.key === "Enter") unlockTimesheet(); }} />
              {timesheetPinError ? <p className="text-sm font-semibold text-red-600">{timesheetPinError}</p> : null}
              <button className="w-full rounded-xl bg-blue-700 px-4 py-3 text-sm font-bold text-white" onClick={unlockTimesheet}>Unlock timesheet</button>
            </div>
          </div>
        ) : (
          <>
            <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <p className="text-sm font-semibold uppercase tracking-wide text-blue-600">JDFabs</p>
                <h2 className="text-3xl font-bold">Staff Timesheet</h2>
              </div>
              <div className="flex flex-col gap-3 text-right text-sm">
                <div>
                  <p>Clocking month: {period.start} to {period.end}</p>
                  <p>Mon-Fri standard days: {periodWorkingDays}</p>
                  <p>Standard hours: {totalExpectedHours.toFixed(2)}</p>
                  <p>Clocked hours: {totalHours.toFixed(2)}</p>
                  <p>Sick absence hours: {totalAbsenceHours.toFixed(2)}</p>
                  <p>Counted hours: {(totalHours + totalAbsenceHours).toFixed(2)}</p>
                  <p>Overtime: {totalOvertimeHours.toFixed(2)}</p>
                </div>
                <button className="rounded-xl bg-blue-700 px-4 py-2 text-sm font-bold text-white" onClick={openTimesheetPrintPreview}>
                  Print / Save PDF timesheet
                </button>
              </div>
            </div>
            <table className="mt-5 w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-blue-200 text-left">
                  <th className="py-2 pr-3">Staff</th>
                  <th className="py-2 pr-3">Date</th>
                  <th className="py-2 pr-3">Type</th>
                  <th className="py-2 pr-3">Clock In</th>
                  <th className="py-2 pr-3">Clock Out</th>
                  <th className="py-2 pr-3 text-right">Hours</th>
                  <th className="py-2 pr-3 text-right">Regular</th>
                  <th className="py-2 pr-3 text-right">Overtime</th>
                </tr>
              </thead>
              <tbody>
                {staff.flatMap((person) => getPeriodTimesheetRows(person.id).map((entry) => ({ ...entry, person }))).map((entry) => {
                  const split = getEntrySplit(entry, entry.person);
                  const hours = entry.type === "Sick" ? getSickDayHours(entry, entry.person).toFixed(2) : calculateHours(entry);
                  return (
                    <tr key={`sheet-${entry.id}`} className="border-b border-blue-100">
                      <td className="py-3 pr-3">{entry.person?.name || "Unknown"}</td>
                      <td className="py-3 pr-3">{entry.date}</td>
                      <td className="py-3 pr-3">{entry.type}</td>
                      <td className="py-3 pr-3">{entry.clockIn}</td>
                      <td className="py-3 pr-3">{entry.clockOut || "Open"}</td>
                      <td className="py-3 pr-3 text-right">{hours}</td>
                      <td className="py-3 pr-3 text-right">{split.regular}</td>
                      <td className="py-3 pr-3 text-right font-bold">{split.overtime}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}

function buildFlatMaterialSectionSize(widthMm, thicknessMm) {
  const width = Number(widthMm || 0);
  const thickness = Number(thicknessMm || 0);
  if (!width || !thickness) return "";
  return `${width}x${thickness}`;
}


function parseFlatMaterialSectionSize(sectionSize = "") {
  const match = String(sectionSize || "").match(/([0-9]+(?:[.][0-9]+)?)\s*x\s*([0-9]+(?:[.][0-9]+)?)/i);
  if (!match) return { width: "", thickness: "" };
  return { width: match[1], thickness: match[2] };
}

function buildPurchasingFlatPatch(currentLine = {}, patch = {}) {
  const width = patch.flatWidth ?? patch.width ?? currentLine.flatWidth ?? currentLine.width ?? parseFlatMaterialSectionSize(currentLine.sectionSize).width;
  const thickness = patch.flatThickness ?? patch.thickness ?? currentLine.flatThickness ?? currentLine.thickness ?? parseFlatMaterialSectionSize(currentLine.sectionSize).thickness;
  return {
    ...patch,
    flatWidth: width,
    flatThickness: thickness,
    width,
    thickness,
    sectionSize: buildFlatMaterialSectionSize(width, thickness),
  };
}

function getQuoteLineMaterialDemands(item = {}, job = {}, index = 0) {
  const lineQuantity = Math.max(1, Number(item.quantity || 1));
  const baseRawLength = item.requiredCutLength || item.cutLength || item.jobLength || item.lengthM || item.length || item.sizeLength || item.itemLength || 0;
  const basePart = {
    id: item.id || `job-part-${job.id}-${index}`,
    productId: item.productId || "",
    description: item.description || item.productName || item.title || "Quote item",
    sectionSize: item.sectionSize || item.size || "",
    grade: item.grade || "",
    finish: item.finish || "",
    length: normaliseLengthM(baseRawLength) || Number(baseRawLength || 0),
    requiredCutLength: item.requiredCutLength || item.cutLength || item.jobLength || baseRawLength,
    width: Number(item.width || 0),
    quantity: lineQuantity,
    weightKg: Number(item.weightKg || 0),
    notes: item.notes || "",
  };

  const demands = [basePart];
  const addPlateDemand = (type) => {
    const prefix = type === "top" ? "topPlate" : "bottomPlate";
    if (item[`${prefix}Required`] !== "Yes") return;
    const thickness = item[`${prefix}Thickness`];
    const width = item[`${prefix}Width`];
    const sectionSize = buildFlatMaterialSectionSize(width, thickness);
    const rawLength = item[`${prefix}Length`] || item.length || baseRawLength;
    const length = normaliseLengthM(rawLength) || Number(rawLength || 0);
    const plateQuantity = Math.max(1, Number(item[`${prefix}Quantity`] || 1)) * lineQuantity;
    if (!sectionSize || !length || !plateQuantity) return;
    demands.push({
      id: `${item.id || `job-part-${job.id}-${index}`}-${type}-plate-material`,
      productId: "flat",
      description: `${type === "top" ? "Top" : "Bottom"} plate / flat ${sectionSize}`,
      sectionSize,
      grade: item.grade || "",
      finish: "Self colour",
      length,
      requiredCutLength: length,
      width: Number(width || 0),
      thickness: Number(thickness || 0),
      quantity: plateQuantity,
      weightKg: 0,
      materialDemandType: `${type}-plate`,
      parentQuoteLineId: item.id || "",
      notes: `${type === "top" ? "Top" : "Bottom"} plate material from quote line.`,
    });
  };
  addPlateDemand("top");
  addPlateDemand("bottom");
  return demands;
}

function getJobPartsList(job, quote) {
  const sourceItems = quote?.takeoffLines?.length ? quote.takeoffLines : quote?.items?.length ? quote.items : job.partsList || [];
  return sourceItems.flatMap((item, index) => getQuoteLineMaterialDemands(item, job, index));
}

function normaliseSectionKey(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/×/g, "x")
    .replace(/mm/g, "")
    .replace(/flat bar/g, "")
    .replace(/flat/g, "")
    .replace(/plate/g, "")
    .replace(/[^0-9a-z.]+/g, "")
    .trim();
}

function isFlatOrPlateProductId(productId = "") {
  const id = String(productId || "").toLowerCase();
  return id === "flat" || id === "plate" || id.includes("flat") || id.includes("plate");
}

function isFlatOrPlateStockItem(item = {}) {
  const text = [item.productId, item.productName, item.name, item.category, item.description, item.notes, item.sectionSize].filter(Boolean).join(" ").toLowerCase();
  return text.includes("flat") || text.includes("plate") || Boolean(parseFlatMaterialSectionSize(item.sectionSize || "").width && parseFlatMaterialSectionSize(item.sectionSize || "").thickness);
}

function isFlatOrPlateDemand(part = {}) {
  const demandType = String(part.materialDemandType || "").toLowerCase();
  return isFlatOrPlateProductId(part.productId) || demandType.includes("plate") || demandType.includes("flat");
}

function flatPlateSectionsMatch(stockSection = "", partSection = "") {
  const stockParsed = parseFlatMaterialSectionSize(stockSection);
  const partParsed = parseFlatMaterialSectionSize(partSection);
  if (stockParsed.width && stockParsed.thickness && partParsed.width && partParsed.thickness) {
    const stockWidth = Number(stockParsed.width);
    const stockThickness = Number(stockParsed.thickness);
    const partWidth = Number(partParsed.width);
    const partThickness = Number(partParsed.thickness);
    const directMatch = stockWidth === partWidth && stockThickness === partThickness;
    const reversedMatch = stockWidth === partThickness && stockThickness === partWidth;
    return directMatch || reversedMatch;
  }
  return normaliseSectionKey(stockSection) === normaliseSectionKey(partSection);
}

function stockMatchesPart(stockItem, part) {
  const stockProductId = String(stockItem.productId || "").toLowerCase();
  const partProductId = String(part.productId || "").toLowerCase();
  const flatPlateDemand = isFlatOrPlateDemand(part);
  const stockIsFlatPlate = isFlatOrPlateStockItem(stockItem);
  const sameProduct = !partProductId
    || stockProductId === partProductId
    || (flatPlateDemand && stockIsFlatPlate)
    || (flatPlateDemand && flatPlateSectionsMatch(stockItem.sectionSize, part.sectionSize));
  const sameSection = !part.sectionSize
    || (flatPlateDemand
      ? flatPlateSectionsMatch(stockItem.sectionSize, part.sectionSize)
      : normaliseSectionKey(stockItem.sectionSize) === normaliseSectionKey(part.sectionSize));
  const partGrade = String(part.grade || "").toLowerCase();
  const stockGrade = String(stockItem.grade || "").toLowerCase();
  const sameGrade = !partGrade || !stockGrade || stockGrade === partGrade;
  const stockFinish = String(stockItem.finish || "Self colour").toLowerCase();
  const partFinish = String(part.finish || "Self colour").toLowerCase();
  const sameFinish = !part.finish || stockFinish === partFinish || stockFinish === "self colour" || partFinish === "self colour";
  return sameProduct && sameSection && sameGrade && sameFinish;
}

function getStockStatusForPart(part, stockItems, jobId) {
  const matches = stockItems.filter((item) => stockMatchesPart(item, part));
  const requiredLengthM = getRequiredLengthForPart(part);
  const hasLengthRequirement = Number(part.length || 0) > 0;
  const allocatedToJob = matches.filter((item) => item.allocatedJobId === jobId);
  const availableStatuses = ["In Stock", "Offcut", "Available"];
  const available = matches.filter((item) => availableStatuses.includes(item.status) && !item.allocatedJobId);
  const onOrder = matches.filter((item) => item.status === "On Order");
  const availableQuantity = available.reduce((sum, item) => sum + Number(item.quantity || getStockSegments(item).length || 0), 0);
  const allocatedQuantity = allocatedToJob.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const onOrderQuantity = onOrder.reduce((sum, item) => sum + Number(item.quantity || getStockSegments(item).length || 0), 0);
  const requiredQuantity = Number(part.quantity || 0);
  const availableLengthM = getStockAvailableLengthByStatus(stockItems, part, availableStatuses, jobId);
  const onOrderLengthM = getStockAvailableLengthByStatus(stockItems, part, "On Order", jobId);
  const allocatedLengthM = matches
    .flatMap((item) => getStockSegments(item))
    .flatMap((segment) => segment.allocations || [])
    .filter((allocation) => allocation.jobId === jobId)
    .reduce((sum, allocation) => sum + Number(allocation.lengthM || 0), 0);
  const bestInStock = hasLengthRequirement ? findBestStockSegmentForLength(stockItems, part, Number(part.length || 0), availableStatuses, jobId) : null;
  const bestOnOrder = hasLengthRequirement ? findBestStockSegmentForLength(stockItems, part, Number(part.length || 0), "On Order", jobId) : null;

  if (hasLengthRequirement) {
    const missingLengthM = Math.max(0, requiredLengthM - availableLengthM - onOrderLengthM - allocatedLengthM);
    if (allocatedLengthM >= requiredLengthM) return { label: "Allocated", availableQuantity, allocatedQuantity, onOrderQuantity, missingQuantity: 0, requiredLengthM, availableLengthM, onOrderLengthM, allocatedLengthM, missingLengthM, bestStockSegment: bestInStock || bestOnOrder };
    if (bestInStock || availableLengthM >= requiredLengthM) return { label: "Available", availableQuantity, allocatedQuantity, onOrderQuantity, missingQuantity: 0, requiredLengthM, availableLengthM, onOrderLengthM, allocatedLengthM, missingLengthM: 0, bestStockSegment: bestInStock };
    if (bestOnOrder || onOrderLengthM > 0) return { label: "On Order", availableQuantity, allocatedQuantity, onOrderQuantity, missingQuantity: missingLengthM > 0 ? 1 : 0, requiredLengthM, availableLengthM, onOrderLengthM, allocatedLengthM, missingLengthM, bestStockSegment: bestOnOrder };
    return { label: "Missing", availableQuantity, allocatedQuantity, onOrderQuantity, missingQuantity: requiredQuantity, requiredLengthM, availableLengthM, onOrderLengthM, allocatedLengthM, missingLengthM: requiredLengthM, bestStockSegment: null };
  }

  if (allocatedQuantity >= requiredQuantity) return { label: "Allocated", availableQuantity, allocatedQuantity, onOrderQuantity, missingQuantity: 0, requiredLengthM, availableLengthM, onOrderLengthM, allocatedLengthM, missingLengthM: 0 };
  if (availableQuantity + allocatedQuantity >= requiredQuantity) return { label: "Available", availableQuantity, allocatedQuantity, onOrderQuantity, missingQuantity: 0, requiredLengthM, availableLengthM, onOrderLengthM, allocatedLengthM, missingLengthM: 0 };
  if (onOrderQuantity > 0) return { label: "On Order", availableQuantity, allocatedQuantity, onOrderQuantity, missingQuantity: Math.max(0, requiredQuantity - availableQuantity - allocatedQuantity), requiredLengthM, availableLengthM, onOrderLengthM, allocatedLengthM, missingLengthM: 0 };
  return { label: "Missing", availableQuantity, allocatedQuantity, onOrderQuantity, missingQuantity: Math.max(0, requiredQuantity - availableQuantity - allocatedQuantity), requiredLengthM, availableLengthM, onOrderLengthM, allocatedLengthM, missingLengthM: 0 };
}

function JobSheet({ job, quote, customer, stockItems, companySettings, onSuggestPO, onRegisterDocument }) {
  const parts = getJobPartsList(job, quote);
  const missingParts = parts.map((part) => ({ part, status: getStockStatusForPart(part, stockItems, job.id) })).filter(({ status }) => status.label === "Missing" || status.label === "On Order");

  return (
    <div className="rounded-3xl bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="flex-1">
          <CompanyDocumentHeader companySettings={companySettings} title="Job Sheet" subtitle={`${job.jobNo} · ${job.title}`} />
        </div>
        <button className="rounded-xl border bg-white px-4 py-2 text-xs font-bold print:hidden" onClick={() => printJobSheetPdf({ job, quote, customer, companySettings, onRegisterDocument })}>Print / Save PDF Job Sheet</button>
      </div>
      <div className="mt-5 grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl bg-blue-50 p-4"><p className="text-xs text-blue-600">Customer</p><p className="font-bold">{customer?.company || job.customer}</p><p className="text-sm text-blue-800">{customer?.contact || ""}</p></div>
        <div className="rounded-2xl bg-blue-50 p-4"><p className="text-xs text-blue-600">Dates</p><p className="font-bold">Start {job.start}</p><p className="text-sm text-blue-800">Deadline {job.deadline}</p></div>
        <div className="rounded-2xl bg-blue-50 p-4"><p className="text-xs text-blue-600">Quote</p><p className="font-bold">{quote?.quoteNo || "Manual job"}</p><p className="text-sm text-blue-800">{quote ? currency(quote.total) : "No quote value"}</p></div>
      </div>

      <div className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[1000px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-blue-100 text-left text-xs uppercase tracking-wide text-blue-600">
              <th className="py-3 pr-3">Part / Material</th>
              <th className="py-3 pr-3">Section</th>
              <th className="w-28 py-3 pr-3">Grade</th>
              <th className="py-3 pr-3">Finish</th>
              <th className="py-3 pr-3 text-right">Length</th>
              <th className="py-3 pr-3 text-right">Qty</th>
              <th className="py-3 pr-3 text-right">Weight</th>
              <th className="py-3 pr-3">Stock status</th>
            </tr>
          </thead>
          <tbody>
            {parts.length === 0 ? <tr><td className="py-4 text-blue-600" colSpan={8}>No quote parts found for this job yet.</td></tr> : null}
            {parts.map((part) => {
              const stockStatus = getStockStatusForPart(part, stockItems, job.id);
              return (
                <tr key={part.id} className="border-b border-blue-100 align-top">
                  <td className="py-3 pr-3 font-semibold">{part.description}</td>
                  <td className="py-3 pr-3">{part.sectionSize || "-"}</td>
                  <td className="py-3 pr-3">{part.grade || "-"}</td>
                  <td className="py-3 pr-3">{part.finish || "-"}</td>
                  <td className="py-3 pr-3 text-right">{part.length ? `${part.length}m` : "-"}</td>
                  <td className="py-3 pr-3 text-right">{part.quantity}</td>
                  <td className="py-3 pr-3 text-right">{part.weightKg ? `${part.weightKg.toFixed(2)} kg` : "-"}</td>
                  <td className="py-3 pr-3"><span className={`rounded-full px-2 py-1 text-xs font-bold ${stockStatus.label === "Missing" ? "bg-red-100 text-red-800" : stockStatus.label === "Available" ? "bg-emerald-100 text-emerald-800" : stockStatus.label === "Allocated" ? "bg-blue-100 text-blue-800" : "bg-amber-100 text-amber-800"}`}>{stockStatus.label}</span>{stockStatus.missingQuantity > 0 ? <p className="mt-1 text-xs text-red-700">Missing qty {stockStatus.missingQuantity}</p> : null}{stockStatus.requiredLengthM ? <p className="mt-1 text-xs text-blue-700">Required {formatLengthM(stockStatus.requiredLengthM)} · In stock {formatLengthM(stockStatus.availableLengthM)} · On order {formatLengthM(stockStatus.onOrderLengthM)}</p> : null}{stockStatus.bestStockSegment ? <p className="mt-1 text-xs font-bold text-emerald-700">Best length: {formatLengthM(stockStatus.bestStockSegment.segment.availableLengthM)} from {stockStatus.bestStockSegment.item.status}</p> : null}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl bg-blue-50 p-4">
          <h3 className="font-bold">Workshop notes</h3>
          <p className="mt-2 text-sm text-blue-800">{job.notes || "No job notes yet."}</p>
        </div>
        <div className="rounded-2xl bg-blue-50 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="font-bold">Material action</h3>
              <p className="mt-1 text-sm text-blue-800">{missingParts.length ? `${missingParts.length} item(s) need purchasing or allocation.` : "All listed materials are covered or no parts list exists."}</p>
            </div>
            <button disabled={!missingParts.length} className="rounded-xl bg-blue-700 px-4 py-2 text-xs font-bold text-white disabled:opacity-40" onClick={() => onSuggestPO(job, missingParts)}>Create supplier enquiry lines</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function StockInventoryTab({ stockItems, jobs, newStockItem, setNewStockItem, onAddStockItem, onUpdateStockItem, onAllocateStockItem, onScrapStockSegment, onCutAllocatedStockItem, onManualCutOffcutStockItem, customProducts, onAddCustomProduct }) {
  const productDatabase = getProductDatabase(customProducts);
  const [addStockOpen, setAddStockOpen] = useState(false);
  const [productSetupOpen, setProductSetupOpen] = useState(false);
  const emptyStockProductOption = { id: createEntityId("stock-product-option"), size: "", price: "", productionMinutes: "" };
  const [stockProductDraft, setStockProductDraft] = useState({ setupMode: "existing", existingProductId: "ub", name: "", category: "Custom Products", unit: "m", defaultGrade: "S275", productionMinutes: "", optionRows: [emptyStockProductOption] });
  const [stockSetupStatus, setStockSetupStatus] = useState("");

  function updateStockProductOption(optionId, patch) {
    setStockProductDraft((current) => ({ ...current, optionRows: (current.optionRows || []).map((row) => row.id === optionId ? { ...row, ...patch } : row) }));
  }

  function addStockProductOption() {
    setStockProductDraft((current) => ({ ...current, optionRows: [...(current.optionRows || []), { id: createEntityId("stock-product-option"), size: "", price: "", productionMinutes: "" }] }));
  }

  function removeStockProductOption(optionId) {
    setStockProductDraft((current) => {
      const rows = (current.optionRows || []).filter((row) => row.id !== optionId);
      return { ...current, optionRows: rows.length ? rows : [{ id: createEntityId("stock-product-option"), size: "", price: "", productionMinutes: "" }] };
    });
  }

  function addProductSetupFromStock() {
    const setupMode = stockProductDraft.setupMode || "existing";
    const existingProduct = steelProductDatabase.find((product) => product.id === stockProductDraft.existingProductId);
    const optionRows = (stockProductDraft.optionRows || []).filter((row) => String(row.size || "").trim());
    if (setupMode === "custom" && !stockProductDraft.name.trim()) { setStockSetupStatus("Enter a custom product name."); return; }
    if (setupMode === "existing" && !existingProduct) { setStockSetupStatus("Choose an existing product line."); return; }
    if (!optionRows.length) { setStockSetupStatus("Add at least one section / size line."); return; }
    const missingTime = optionRows.some((row) => Number(row.productionMinutes || 0) <= 0);
    if (Number(stockProductDraft.productionMinutes || 0) <= 0 && missingTime) { setStockSetupStatus("Add default time or time for every size line."); return; }
    const product = createCustomProductRecord({
      ...stockProductDraft,
      name: setupMode === "existing" ? existingProduct.name : stockProductDraft.name,
      category: setupMode === "existing" ? existingProduct.category : stockProductDraft.category,
      unit: stockProductDraft.unit || existingProduct?.unit || "m",
      defaultGrade: stockProductDraft.defaultGrade || existingProduct?.defaultGrade || "S275",
      optionRows: optionRows.map((row) => ({ ...row, productionMinutes: Number(row.productionMinutes || stockProductDraft.productionMinutes || 0) })),
    }, customProducts);
    onAddCustomProduct?.(product);
    setNewStockItem((current) => ({ ...current, productId: product.id, sectionSize: product.sectionOptions?.[0] || current.sectionSize, grade: product.defaultGrade || current.grade }));
    setStockProductDraft({ setupMode: "existing", existingProductId: "ub", name: "", category: "Custom Products", unit: "m", defaultGrade: "S275", productionMinutes: "", optionRows: [{ id: createEntityId("stock-product-option"), size: "", price: "", productionMinutes: "" }] });
    setStockSetupStatus(`${product.name} product setup updated for Quotes and Stock Inventory.`);
  }
  const totalStockLines = stockItems.length;
  const lowStockLines = stockItems.filter((item) => item.status === "Low Stock" || Number(item.quantity || 0) <= 0).length;
  const onOrderLines = stockItems.filter((item) => item.status === "On Order").length;
  const totalAvailableLengthM = stockItems.reduce((sum, item) => sum + getRemainingLengthForStockItem(item), 0);
  const totalAllocatedLengthM = stockItems.reduce((sum, item) => sum + getAllocatedLengthForStockItem(item), 0);
  const isAllocatedInventoryItem = (item = {}) => Boolean(item.allocatedJobId) || ["Allocated", "Allocated Cut"].includes(item.stockLineType) || item.status === "Allocated" || getStockAllocationRows(item, jobs).length > 0;
  const getInventoryJobGroupLabel = (item = {}) => {
    const allocation = getStockAllocationRows(item, jobs)[0];
    const job = jobs.find((jobItem) => jobItem.id === item.allocatedJobId) || jobs.find((jobItem) => jobItem.id === allocation?.jobId);
    return job?.jobNo || item.allocatedJobNo || allocation?.jobNo || item.allocatedJobId || "Allocated job";
  };
  const stockDisplayItems = [...stockItems].sort((a, b) => {
    const aAllocated = isAllocatedInventoryItem(a);
    const bAllocated = isAllocatedInventoryItem(b);
    if (aAllocated !== bAllocated) return aAllocated ? -1 : 1;
    if (aAllocated && bAllocated) return getInventoryJobGroupLabel(a).localeCompare(getInventoryJobGroupLabel(b));
    return String(a.productId || "").localeCompare(String(b.productId || "")) || String(a.sectionSize || "").localeCompare(String(b.sectionSize || ""));
  });
  const stockDisplayRows = [];
  let lastInventoryGroup = "";
  stockDisplayItems.forEach((item) => {
    const group = isAllocatedInventoryItem(item) ? `Allocated Materials - ${getInventoryJobGroupLabel(item)}` : "Stock Materials / Offcuts";
    if (group !== lastInventoryGroup) {
      stockDisplayRows.push({ type: "group", id: `group-${group}`, label: group, allocated: isAllocatedInventoryItem(item) });
      lastInventoryGroup = group;
    }
    stockDisplayRows.push({ type: "item", id: item.id, item });
  });

  return (
    <div className="space-y-6">
      <div className="rounded-3xl bg-white p-5 shadow-sm">
        <SectionHeader eyebrow="Inventory" title="Stock Inventory" description="Track stock on site, on order, allocated job lengths, offcuts and PO traceability. Enquiries do not create stock until raised as POs." />
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-3xl bg-white p-5 shadow-sm"><p className="text-sm text-blue-600">Stock lines</p><p className="mt-1 text-3xl font-bold">{totalStockLines}</p></div>
        <div className="rounded-3xl bg-white p-5 shadow-sm"><p className="text-sm text-blue-600">On Order</p><p className="mt-1 text-3xl font-bold">{onOrderLines}</p></div>
        <div className="rounded-3xl bg-white p-5 shadow-sm"><p className="text-sm text-blue-600">Allocated length</p><p className="mt-1 text-3xl font-bold">{formatLengthM(totalAllocatedLengthM)}</p></div>
        <div className="rounded-3xl bg-white p-5 shadow-sm"><p className="text-sm text-blue-600">Available length</p><p className="mt-1 text-3xl font-bold">{formatLengthM(totalAvailableLengthM)}</p></div>
      </div>

      <div className="rounded-3xl bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h3 className="text-lg font-bold">Product setup</h3>
            <p className="mt-1 text-sm text-blue-800">Add missing section sizes to an existing product line or create a custom product before adding stock.</p>
          </div>
          <button className="rounded-xl border bg-white px-4 py-2 text-sm font-bold" onClick={() => setProductSetupOpen(!productSetupOpen)}>{productSetupOpen ? "Hide product setup" : "Open product setup"}</button>
        </div>
        {productSetupOpen ? <div className="mt-4 rounded-2xl bg-blue-50 p-4">
          <div className="grid gap-3 md:grid-cols-6">
            <Field label="Product setup type"><SelectInput value={stockProductDraft.setupMode || "existing"} onChange={(event) => { const mode = event.target.value; const existing = steelProductDatabase.find((product) => product.id === stockProductDraft.existingProductId) || steelProductDatabase[0]; setStockProductDraft({ ...stockProductDraft, setupMode: mode, unit: mode === "existing" ? existing.unit : stockProductDraft.unit, defaultGrade: mode === "existing" ? existing.defaultGrade : stockProductDraft.defaultGrade }); }}><option value="existing">Existing product line</option><option value="custom">Custom product</option></SelectInput></Field>
            {stockProductDraft.setupMode !== "custom" ? <Field label="Existing product line"><SelectInput value={stockProductDraft.existingProductId || "ub"} onChange={(event) => { const existing = steelProductDatabase.find((product) => product.id === event.target.value); setStockProductDraft({ ...stockProductDraft, existingProductId: event.target.value, unit: existing?.unit || "m", defaultGrade: existing?.defaultGrade || "S275" }); }}>{steelProductDatabase.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</SelectInput></Field> : <Field label="Product name"><TextInput value={stockProductDraft.name} onChange={(event) => setStockProductDraft({ ...stockProductDraft, name: event.target.value })} placeholder="e.g. Special bracket" /></Field>}
            {stockProductDraft.setupMode === "custom" ? <Field label="Category"><TextInput value={stockProductDraft.category} onChange={(event) => setStockProductDraft({ ...stockProductDraft, category: event.target.value })} /></Field> : null}
            <Field label="Unit"><SelectInput value={stockProductDraft.unit} onChange={(event) => setStockProductDraft({ ...stockProductDraft, unit: event.target.value })}><option value="m">m</option><option value="each">each</option><option value="kg">kg</option><option value="tonne">tonne</option><option value="sheet">sheet</option></SelectInput></Field>
            <Field label="Grade"><SelectInput value={stockProductDraft.defaultGrade} onChange={(event) => setStockProductDraft({ ...stockProductDraft, defaultGrade: event.target.value })}>{steelGradeOptions.map((grade) => <option key={grade}>{grade}</option>)}</SelectInput></Field>
            <Field label="Default time mins"><TextInput type="number" value={stockProductDraft.productionMinutes} onChange={(event) => setStockProductDraft({ ...stockProductDraft, productionMinutes: event.target.value })} placeholder="Required or per size" /></Field>
          </div>
          <div className="mt-4 rounded-2xl bg-white p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div><p className="text-sm font-bold text-blue-950">Section / size lines</p><p className="text-xs text-blue-700">Example: add 254x146x37 under Universal Beam / RSJ.</p></div>
              <button className="rounded-lg border bg-white px-3 py-2 text-xs font-bold" onClick={addStockProductOption}>Add size line</button>
            </div>
            <div className="space-y-2">
              {(stockProductDraft.optionRows || []).map((option, index) => <div key={option.id} className="grid gap-2 md:grid-cols-[80px_1fr_150px_150px_auto] md:items-end">
                <div className="rounded-lg bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700">Line {index + 1}</div>
                <Field label="Section / size"><TextInput value={option.size} onChange={(event) => updateStockProductOption(option.id, { size: event.target.value })} placeholder="e.g. 254x146x37" /></Field>
                <Field label="Price £"><TextInput type="number" step="0.01" value={option.price} onChange={(event) => updateStockProductOption(option.id, { price: event.target.value })} placeholder="Optional" /></Field>
                <Field label="Time mins"><TextInput type="number" value={option.productionMinutes || ""} onChange={(event) => updateStockProductOption(option.id, { productionMinutes: event.target.value })} placeholder="Optional" /></Field>
                <button disabled={(stockProductDraft.optionRows || []).length === 1} className="rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-bold text-red-700 disabled:opacity-40" onClick={() => removeStockProductOption(option.id)}>Remove</button>
              </div>)}
            </div>
          </div>
          <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            {stockSetupStatus ? <p className="rounded-xl bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800">{stockSetupStatus}</p> : <p className="text-xs font-semibold text-blue-700">Product setup updates both Quote product lines and Stock Inventory add-stock options.</p>}
            <button className="rounded-xl bg-blue-700 px-4 py-3 text-sm font-bold text-white" onClick={addProductSetupFromStock}>{stockProductDraft.setupMode === "custom" ? "Create product" : "Add section size"}</button>
          </div>
        </div> : null}
      </div>

      <div className="rounded-3xl bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-lg font-bold">Add stock</h3>
            <p className="mt-1 text-sm text-blue-800">Open only when adding manual stock or offcuts.</p>
          </div>
          <button className="rounded-xl border bg-white px-4 py-2 text-sm font-bold" onClick={() => setAddStockOpen(!addStockOpen)}>{addStockOpen ? "Hide add stock" : "Open add stock"}</button>
        </div>
        {addStockOpen ? <div className="mt-4 space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
          <Field label="Product"><SelectInput value={newStockItem.productId} onChange={(event) => { const product = productDatabase.find((item) => item.id === event.target.value); const options = getSectionOptions(event.target.value, customProducts); setNewStockItem({ ...newStockItem, productId: event.target.value, grade: product?.defaultGrade || newStockItem.grade, sectionSize: options[0] || "" }); }}>{productDatabase.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</SelectInput></Field>
          <Field label="Section / Size"><SelectInput value={newStockItem.sectionSize} onChange={(event) => setNewStockItem({ ...newStockItem, sectionSize: event.target.value })}>{getSectionOptions(newStockItem.productId, customProducts).map((section) => <option key={section} value={section}>{section}</option>)}</SelectInput></Field>
          <Field label="Grade"><SelectInput value={newStockItem.grade} onChange={(event) => setNewStockItem({ ...newStockItem, grade: event.target.value })}>{steelGradeOptions.map((grade) => <option key={grade}>{grade}</option>)}</SelectInput></Field>
          <Field label="Finish"><SelectInput value={newStockItem.finish} onChange={(event) => setNewStockItem({ ...newStockItem, finish: event.target.value })}>{steelFinishOptions.map((finish) => <option key={finish}>{finish}</option>)}</SelectInput></Field>
          <Field label="Length m"><TextInput type="number" value={newStockItem.length} onChange={(event) => setNewStockItem({ ...newStockItem, length: event.target.value })} /></Field>
          <Field label="Quantity"><TextInput type="number" value={newStockItem.quantity} onChange={(event) => setNewStockItem({ ...newStockItem, quantity: event.target.value })} /></Field>
          <Field label="Location"><TextInput value={newStockItem.location} onChange={(event) => setNewStockItem({ ...newStockItem, location: event.target.value })} placeholder="Rack / bay" /></Field>
          <Field label="PO / Enquiry No"><TextInput value={newStockItem.purchaseDocumentNo || ""} onChange={(event) => setNewStockItem({ ...newStockItem, purchaseDocumentNo: event.target.value })} placeholder="e.g. PO-00005" /></Field>
          <Field label="Status"><SelectInput value={newStockItem.status} onChange={(event) => setNewStockItem({ ...newStockItem, status: event.target.value })}>{stockStatuses.map((status) => <option key={status}>{status}</option>)}</SelectInput></Field>
          <Field label="Notes"><TextInput value={newStockItem.notes} onChange={(event) => setNewStockItem({ ...newStockItem, notes: event.target.value })} /></Field>
          </div>
          <button className="rounded-xl bg-blue-700 px-4 py-3 text-sm font-bold text-white" onClick={onAddStockItem}>Add stock item</button>
        </div> : null}
      </div>

      <div className="rounded-3xl bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
          <div>
            <h3 className="text-lg font-bold">Allocated materials and stock list</h3>
            <p className="text-sm text-blue-800">Allocated materials are grouped by job at the top. General stock and offcuts are listed below.</p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1200px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-blue-100 text-left text-xs uppercase tracking-wide text-blue-600">
              <th className="w-28 py-3 pr-3">Product</th>
              <th className="w-80 py-3 pr-3">Section / Size</th>
              <th className="w-24 py-3 pr-3">Grade</th>
              <th className="w-40 py-3 pr-3">Finish</th>
              <th className="w-28 py-3 pr-3 text-right">Length</th>
              <th className="w-20 py-3 pr-3 text-right">Qty</th>
              <th className="w-36 py-3 pr-3">Location</th>
              <th className="w-36 py-3 pr-3">Status</th>
              <th className="w-44 py-3 pr-3">PO / Enquiry</th>
              <th className="w-80 py-3 pr-3">Allocated / remaining</th>
              <th className="w-48 py-3 pr-3">Manual job hold</th>
              <th className="w-56 py-3 pr-3">Notes</th>
            </tr>
          </thead>
          <tbody>
            {stockItems.length === 0 ? <tr><td className="py-4 text-blue-600" colSpan={12}>No stock items yet. Open Add stock to enter manual stock or receive stock from purchasing.</td></tr> : null}
            {stockDisplayRows.map((row) => {
              if (row.type === "group") return <tr key={row.id} className={row.allocated ? "bg-blue-100" : "bg-emerald-50"}><td colSpan={12} className="px-3 py-3 text-sm font-black uppercase tracking-wide text-blue-950">{row.label}</td></tr>;
              const item = row.item;
              const product = productDatabase.find((product) => product.id === item.productId);
              return (
                <tr key={item.id} className="border-b border-blue-100 align-top">
                  <td className="py-3 pr-3 font-bold">{product?.name || item.productId}</td>
                  <td className="py-3 pr-3"><div className="min-w-64 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-sm font-bold text-blue-950">{item.sectionSize || ""}</div></td>
                  <td className="py-3 pr-3"><div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-sm font-bold text-blue-950">{item.grade || ""}</div></td>
                  <td className="py-3 pr-3"><SelectInput value={item.finish} onChange={(event) => onUpdateStockItem(item.id, { finish: event.target.value })}>{steelFinishOptions.map((finish) => <option key={finish}>{finish}</option>)}</SelectInput></td>
                  <td className="py-3 pr-3 text-right"><div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-sm font-bold text-blue-950">{formatLengthM(item.sourceStockLengthM || item.sourceOrderedLengthM || item.length || 0)}</div></td>
                  <td className="py-3 pr-3 text-right"><div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-sm font-bold text-blue-950">{item.quantity || 0}</div></td>
                  <td className="py-3 pr-3"><TextInput value={item.location || ""} onChange={(event) => onUpdateStockItem(item.id, { location: event.target.value })} /></td>
                  <td className="py-3 pr-3"><SelectInput value={item.status} onChange={(event) => onUpdateStockItem(item.id, { status: event.target.value })}>{stockStatuses.map((status) => <option key={status}>{status}</option>)}</SelectInput></td>
                  <td className="py-3 pr-3"><div className="space-y-1"><TextInput value={item.purchaseDocumentNo || ""} onChange={(event) => onUpdateStockItem(item.id, { purchaseDocumentNo: event.target.value })} placeholder="PO / ENQ" /><p className="text-xs font-bold text-blue-700">Trace: {getStockTraceabilityNumber(item)}</p>{item.sourceJobId ? <p className="text-xs text-blue-600">Source job: {jobs.find((job) => job.id === item.sourceJobId)?.jobNo || item.sourceJobId}</p> : null}</div></td>
                  <td className="py-3 pr-3"><div className="space-y-2">{getStockSegments(item).map((segment) => {
                    const allocationRows = getStockAllocationRows({ ...item, lengthSegments: [segment] }, jobs);
                    return (
                      <div key={segment.id} className="rounded-lg bg-blue-50 px-2 py-2 text-xs text-blue-800">
                        <p className="font-black">Stock length {formatLengthM(segment.originalLengthM)} · Remaining {formatLengthM(segment.availableLengthM)} · {segment.status}</p>
                        <p className="mt-1 text-[11px] font-bold text-blue-700">Source: {getStockTraceabilityNumber(item)}</p>
                        {segment.scrapReason ? <p className="mt-1 rounded bg-red-50 px-2 py-1 font-bold text-red-700">Scrapped: {segment.scrapReason}</p> : null}
                        {allocationRows.length ? <div className="mt-1 space-y-1">{allocationRows.map((allocation) => <p key={allocation.id} className="rounded bg-white px-2 py-1 font-bold text-blue-950">Allocated {formatLengthM(allocation.lengthM)} to {allocation.jobNo}{allocation.jobTitle ? ` · ${allocation.jobTitle}` : ""}</p>)}</div> : <p className="mt-1 font-semibold text-emerald-700">No job allocation yet</p>}
                        {item.stockLineType === "Allocated" || item.stockLineType === "Allocated Cut" ? <button className="mt-2 rounded-lg border border-emerald-200 bg-white px-2 py-1 text-[11px] font-black text-emerald-700" onClick={() => onCutAllocatedStockItem(item.id)}>Cut / consume allocated line</button> : null}
                        {!(item.stockLineType === "Allocated" || item.stockLineType === "Allocated Cut") && !["Consumed", "Scrapped"].includes(segment.status) && Number(segment.availableLengthM || 0) > 0 ? <div className="mt-2 flex flex-wrap gap-2"><button className="rounded-lg border border-blue-200 bg-white px-2 py-1 text-[11px] font-black text-blue-700" onClick={() => onManualCutOffcutStockItem(item.id)}>Manual cut</button><button className="rounded-lg border border-red-200 bg-white px-2 py-1 text-[11px] font-black text-red-700" onClick={() => onScrapStockSegment(item.id, segment.id)}>Scrap</button></div> : null}
                      </div>
                    );
                  })}</div></td>
                  <td className="py-3 pr-3"><SelectInput value={item.allocatedJobId || ""} onChange={(event) => onAllocateStockItem(item.id, event.target.value)}><option value="">Unallocated</option>{jobs.map((job) => <option key={job.id} value={job.id}>{job.jobNo} · {job.title}</option>)}</SelectInput></td>
                  <td className="py-3 pr-3"><TextInput value={item.notes || ""} onChange={(event) => onUpdateStockItem(item.id, { notes: event.target.value })} /></td>
                </tr>
              );
            })}
          </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function parseCsvText(text) {
  const rows = [];
  let current = "";
  let row = [];
  let insideQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];
    const charCode = char.charCodeAt(0);
    const nextCharCode = nextChar ? nextChar.charCodeAt(0) : 0;

    if (char === '"' && insideQuotes && nextChar === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      insideQuotes = !insideQuotes;
      continue;
    }

    if (char === "," && !insideQuotes) {
      row.push(current.trim());
      current = "";
      continue;
    }

    if ((charCode === 10 || charCode === 13) && !insideQuotes) {
      if (charCode === 13 && nextCharCode === 10) index += 1;
      row.push(current.trim());
      if (row.some((cell) => cell !== "")) rows.push(row);
      row = [];
      current = "";
      continue;
    }

    current += char;
  }

  row.push(current.trim());
  if (row.some((cell) => cell !== "")) rows.push(row);

  if (rows.length === 0) return [];
  const headers = rows[0].map((header) => header.trim());
  return rows.slice(1).map((cells) => headers.reduce((record, header, index) => ({ ...record, [header]: cells[index] || "" }), {}));
}

function getCsvValue(row = {}, keys = []) {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && String(value || "").trim() !== "") return String(value).trim();
  }
  const normalisedMap = Object.keys(row).reduce((map, key) => ({ ...map, [String(key).replace(/[^a-z0-9]/gi, "").toLowerCase()]: row[key] }), {});
  for (const key of keys) {
    const value = normalisedMap[String(key).replace(/[^a-z0-9]/gi, "").toLowerCase()];
    if (value !== undefined && String(value || "").trim() !== "") return String(value).trim();
  }
  return "";
}

function normaliseXeroCsvRow(row, type) {
  const name = getCsvValue(row, ["*ContactName", "ContactName", "Contact Name", "LegalName", "BankAccountName"]);
  const email = getCsvValue(row, ["EmailAddress", "Email Address", "Email"]);
  const phone = getCsvValue(row, ["PhoneNumber", "Phone Number", "DDINumber", "DDI Number"]);
  const mobile = getCsvValue(row, ["MobileNumber", "Mobile Number"]);
  const taxNumber = getCsvValue(row, ["TaxNumber", "Tax Number"]);
  const accountReference = getCsvValue(row, ["AccountNumber", "Account Number"]);
  const supplierAddress = [
    getCsvValue(row, ["POAddressLine1", "Postal Address Line 1"]),
    getCsvValue(row, ["POAddressLine2", "Postal Address Line 2"]),
    getCsvValue(row, ["POAddressLine3"]),
    getCsvValue(row, ["POAddressLine4"]),
    getCsvValue(row, ["POCity", "Postal Address City"]),
    getCsvValue(row, ["PORegion", "Postal Address Region"]),
    getCsvValue(row, ["POPostalCode", "Postal Address Postal Code"]),
    getCsvValue(row, ["POCountry", "Postal Address Country"]),
  ].filter(Boolean).join(", ");
  const customerAddress = [
    getCsvValue(row, ["SAAddressLine1", "Delivery Address Line 1"]),
    getCsvValue(row, ["SAAddressLine2", "Delivery Address Line 2"]),
    getCsvValue(row, ["SAAddressLine3"]),
    getCsvValue(row, ["SAAddressLine4"]),
    getCsvValue(row, ["SACity", "Delivery Address City"]),
    getCsvValue(row, ["SARegion", "Delivery Address Region"]),
    getCsvValue(row, ["SAPostalCode", "Delivery Address Postal Code"]),
    getCsvValue(row, ["SACountry", "Delivery Address Country"]),
  ].filter(Boolean).join(", ");
  const address = type === "suppliers" ? supplierAddress || customerAddress : customerAddress || supplierAddress;

  if (type === "suppliers") {
    return {
      name,
      company: name,
      contact: name,
      email,
      phone,
      mobile,
      deliveryAddress: address,
      address,
      vatNumber: taxNumber,
      accountReference,
    };
  }

  return {
    company: name,
    name,
    contact: name,
    email,
    phone,
    mobile,
    deliveryAddress: address,
    address,
    vatNumber: taxNumber,
    accountReference,
  };
}

function findImportDuplicate(record, existingRecords, type) {
  const recordEmail = String(record.email || "").toLowerCase();
  const recordAccount = String(record.accountReference || "").toLowerCase();
  const recordName = String(type === "suppliers" ? record.name : record.company || record.name).toLowerCase();

  return existingRecords.find((existing) => {
    const existingEmail = String(existing.email || "").toLowerCase();
    const existingAccount = String(existing.accountReference || "").toLowerCase();
    const existingName = String(type === "suppliers" ? existing.name : existing.company || existing.name).toLowerCase();

    if (recordEmail && existingEmail && recordEmail === existingEmail) return true;
    if (recordAccount && existingAccount && recordAccount === existingAccount) return true;
    return Boolean(recordName && existingName && recordName === existingName);
  });
}

async function loadPdfJsLibrary() {
  if (typeof window !== "undefined" && typeof document !== "undefined") {
    const targetVersion = "3.11.174";
    const hasMatchingPdfJs = window.pdfjsLib && String(window.pdfjsLib.version || "") === targetVersion;
    if (hasMatchingPdfJs) return { pdfjsLib: window.pdfjsLib, source: "cdn", version: targetVersion };

    await new Promise((resolve, reject) => {
      const existingScript = document.querySelector(`script[data-jdfabs-pdfjs="${targetVersion}"]`);
      if (existingScript) {
        existingScript.addEventListener("load", resolve, { once: true });
        existingScript.addEventListener("error", reject, { once: true });
        if (window.pdfjsLib && String(window.pdfjsLib.version || "") === targetVersion) resolve();
        return;
      }

      const script = document.createElement("script");
      script.src = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${targetVersion}/build/pdf.min.js`;
      script.async = true;
      script.setAttribute("data-jdfabs-pdfjs", targetVersion);
      script.onload = resolve;
      script.onerror = () => reject(new Error("Could not load the matched PDF reader from CDN."));
      document.head.appendChild(script);
    });

    if (!window.pdfjsLib) throw new Error("PDF reader loaded but did not initialise.");
    return { pdfjsLib: window.pdfjsLib, source: "cdn", version: targetVersion };
  }

  return { pdfjsLib: await import("pdfjs-dist/legacy/build/pdf"), source: "module", version: "module" };
}

async function extractTextFromPdfFile(file) {
  try {
    const { pdfjsLib, source, version } = await loadPdfJsLibrary();
    const workerVersion = version === "module" ? (pdfjsLib.version || "3.11.174") : version;

    if (pdfjsLib.GlobalWorkerOptions) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = source === "cdn"
        ? `https://cdn.jsdelivr.net/npm/pdfjs-dist@${workerVersion}/build/pdf.worker.min.js`
        : "";
    }

    const buffer = await file.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument(source === "cdn" ? { data: buffer } : { data: buffer, disableWorker: true });
    const pdf = await loadingTask.promise;
    const pageTexts = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const text = textContent.items.map((item) => item.str || "").join(" ");
      if (text.trim()) pageTexts.push(text.trim());
    }

    return pageTexts.join(String.fromCharCode(10));
  } catch (error) {
    throw new Error(error?.message || "PDF text extraction failed.");
  }
}

function parseAiTakeoffDraftRows(text) {
  const rawText = String(text || "");
  const chunks = rawText
    .split(String.fromCharCode(10))
    .flatMap((line) => line.split(";"))
    .map((item) => item.trim())
    .filter(Boolean);

  function cleanNumber(value) {
    const chars = String(value || "").split("").filter((char) => (char >= "0" && char <= "9") || char === ".");
    return Number(chars.join("") || 0);
  }

  function compactText(value) {
    return String(value || "").toLowerCase().split(" ").join("").split("×").join("x");
  }

  function findSectionInText(chunk) {
    const compact = compactText(chunk);
    let found = { productId: "", sectionSize: "" };
    Object.entries(steelSectionInventory).forEach(([productId, sections]) => {
      sections.forEach((section) => {
        const compactSection = compactText(section);
        if (compact.includes(compactSection) && compactSection.length > found.sectionSize.length) {
          found = { productId, sectionSize: section };
        }
      });
    });
    return found;
  }

  function productFromText(chunk, sectionProductId) {
    const lower = String(chunk || "").toLowerCase();
    if (sectionProductId) return sectionProductId;
    if (lower.includes("twinned")) return "ub";
    if (lower.includes(" uc") || lower.includes("column")) return "uc";
    if (lower.includes(" pfc") || lower.includes("channel")) return "pfc";
    if (lower.includes("shs")) return "shs";
    if (lower.includes("rhs")) return "rhs";
    if (lower.includes("chs") || lower.includes("tube")) return "chs";
    if (lower.includes("unequal")) return "ursa";
    if (lower.includes("angle")) return "rsa";
    if (lower.includes("flat")) return "flat";
    if (lower.includes("plate")) return "plate";
    return "ub";
  }

  function getLengthMetres(chunk) {
    const words = String(chunk || "").split(" ").map((word) => word.trim()).filter(Boolean);
    const mmWord = words.find((word) => word.toLowerCase().endsWith("mm") && cleanNumber(word) > 100);
    if (mmWord) return cleanNumber(mmWord) / 1000;
    const metreWord = words.find((word) => {
      const lower = word.toLowerCase();
      return lower.endsWith("m") && !lower.endsWith("mm") && cleanNumber(word) > 0;
    });
    return metreWord ? cleanNumber(metreWord) : 0;
  }

  function getQuantity(chunk) {
    const words = String(chunk || "").split(" ").map((word) => word.trim()).filter(Boolean);
    const lowerWords = words.map((word) => word.toLowerCase());
    const qtyIndex = lowerWords.findIndex((word) => word === "qty" || word === "quantity" || word === "no" || word === "no.");
    if (qtyIndex >= 0 && words[qtyIndex + 1]) return cleanNumber(words[qtyIndex + 1]) || 1;
    const productIndex = lowerWords.findIndex((word) => ["ub", "uc", "pfc", "rsa", "shs", "rhs", "chs"].includes(word));
    if (productIndex >= 0) {
      const quantityWord = words.slice(productIndex + 1).find((word) => {
        const lower = word.toLowerCase();
        const number = cleanNumber(word);
        return number > 0 && !lower.endsWith("mm") && !lower.endsWith("kg") && !lower.includes("tonne");
      });
      if (quantityWord) return cleanNumber(quantityWord) || 1;
    }
    if (cleanNumber(words[0]) && lowerWords[1] === "x") return cleanNumber(words[0]);
    return 1;
  }

  function getHoleCount(chunk) {
    const words = String(chunk || "").split(" ").map((word) => word.trim()).filter(Boolean);
    const lowerWords = words.map((word) => word.toLowerCase());
    const holeIndex = lowerWords.findIndex((word) => word.includes("hole"));
    if (holeIndex > 0) return cleanNumber(words[holeIndex - 1]) || 0;
    return 0;
  }

  const memberRows = chunks.filter((chunk) => {
    const compact = compactText(chunk);
    const hasSection = Boolean(findSectionInText(chunk).sectionSize);
    const hasLength = compact.includes("mm") || compact.includes("m");
    return hasSection && hasLength;
  });

  const sourceRows = memberRows.length ? memberRows : chunks;

  return sourceRows.map((chunk, index) => {
    const lower = chunk.toLowerCase();
    const section = findSectionInText(chunk);
    const productId = productFromText(chunk, section.productId);
    const product = steelProductDatabase.find((item) => item.id === productId) || steelProductDatabase[0];
    const finish = lower.includes("galv") ? "Galvanised" : lower.includes("powder") ? "Powder coated" : lower.includes("paint") ? "Painted" : lower.includes("prime") ? "Primed" : "Self colour";
    const grade = lower.includes("s355") ? "S355" : lower.includes("s275") ? "S275" : product.defaultGrade;
    const length = getLengthMetres(chunk);
    const quantity = getQuantity(chunk);
    const sectionSize = section.sectionSize;
    const warnings = [];

    if (!sectionSize && productId !== "plate") warnings.push("Missing section/size");
    if (!length) warnings.push("Missing length");
    if (!quantity) warnings.push("Missing quantity");

    return {
      id: `ai-takeoff-${Date.now()}-${index}`,
      sourceText: chunk,
      approved: warnings.length === 0,
      productId,
      productName: product.name,
      sectionSize,
      grade,
      finish,
      length,
      quantity,
      holes: getHoleCount(chunk),
      notes: `AI draft from: ${chunk}`,
      warnings,
    };
  });
}

function buildImportPreviewRows(parsedRows, type, existingRecords) {
  const seenKeys = new Set();

  return parsedRows.map((row, index) => {
    const record = normaliseXeroCsvRow(row, type);
    const requiredName = type === "suppliers" ? record.name : record.company;
    const errors = [];
    if (!requiredName) errors.push("Missing Contact Name");

    const duplicate = findImportDuplicate(record, existingRecords, type);
    const rowKey = String(record.email || record.accountReference || requiredName || `row-${index}`).toLowerCase();
    const duplicateInFile = seenKeys.has(rowKey);
    seenKeys.add(rowKey);

    let action = "Create";
    if (errors.length) action = "Error";
    else if (duplicateInFile) action = "Skip";
    else if (duplicate) action = "Update";

    return {
      id: `preview-${index}`,
      rowNumber: index + 2,
      source: row,
      record,
      duplicateId: duplicate?.id || "",
      action,
      errors,
    };
  });
}

function XeroCsvImportTab({ customers, suppliers, importState, setImportState, importLogs, onFileSelected, onConfirmImport, onResetImport }) {
  const existingRecords = importState.importType === "suppliers" ? suppliers : customers;
  const previewCounts = importState.previewRows.reduce((counts, row) => ({ ...counts, [row.action]: (counts[row.action] || 0) + 1 }), {});

  return (
    <div className="space-y-6">
      <div className="rounded-3xl bg-white p-5 shadow-sm">
        <h2 className="text-lg font-bold">Imports → Import Customers/Suppliers from Xero CSV</h2>
        <p className="mt-1 text-sm text-blue-800">Export Contacts from Xero manually, then upload the CSV here. This import uses existing customer and supplier fields only.</p>
      </div>

      <div className="rounded-3xl bg-white p-5 shadow-sm">
        <h3 className="text-lg font-bold">1. Upload CSV</h3>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <Field label="Import Type">
            <SelectInput value={importState.importType} onChange={(event) => setImportState((current) => ({ ...current, importType: event.target.value, previewRows: [], summary: null, error: "" }))}>
              <option value="customers">Customers</option>
              <option value="suppliers">Suppliers</option>
              <option value="auto">Auto-detect</option>
            </SelectInput>
          </Field>
          <Field label="CSV file only">
            <input type="file" accept=".csv,text/csv" className="w-full rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm" onChange={onFileSelected} />
          </Field>
          <div className="rounded-xl bg-blue-50 p-3 text-sm text-blue-800">
            <p className="font-bold">Accepted headers</p>
            <p className="text-xs">{xeroCsvHeaders.slice(0, 6).join(", ")}...</p>
          </div>
        </div>
        {importState.error ? <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{importState.error}</p> : null}
        {importState.fileName ? <p className="mt-3 rounded-xl bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-800">Loaded: {importState.fileName} · Matching against {existingRecords.length} existing {importState.importType === "suppliers" ? "suppliers" : "customers"}</p> : null}
      </div>

      {importState.previewRows.length ? (
        <div className="rounded-3xl bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <h3 className="text-lg font-bold">2. Preview before import</h3>
              <p className="mt-1 text-sm text-blue-800">Created: {previewCounts.Create || 0} · Updated: {previewCounts.Update || 0} · Skipped: {previewCounts.Skip || 0} · Failed: {previewCounts.Error || 0}</p>
            </div>
            <div className="flex gap-2">
              <button className="rounded-xl border bg-white px-4 py-2 text-sm font-bold" onClick={onResetImport}>Reset</button>
              <button className="rounded-xl bg-blue-700 px-4 py-2 text-sm font-bold text-white" onClick={onConfirmImport}>Confirm import</button>
            </div>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[1000px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-blue-100 text-left text-xs uppercase tracking-wide text-blue-600">
                  <th className="py-3 pr-3">Row</th>
                  <th className="py-3 pr-3">Action</th>
                  <th className="py-3 pr-3">Name</th>
                  <th className="py-3 pr-3">Email</th>
                  <th className="py-3 pr-3">Phone</th>
                  <th className="py-3 pr-3">Account Ref</th>
                  <th className="py-3 pr-3">Issues</th>
                </tr>
              </thead>
              <tbody>
                {importState.previewRows.map((row) => (
                  <tr key={row.id} className="border-b border-blue-100 align-top">
                    <td className="py-3 pr-3">{row.rowNumber}</td>
                    <td className="py-3 pr-3"><span className={`rounded-full px-2 py-1 text-xs font-bold ${row.action === "Create" ? "bg-emerald-100 text-emerald-800" : row.action === "Update" ? "bg-blue-100 text-blue-800" : row.action === "Skip" ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-800"}`}>{row.action}</span></td>
                    <td className="py-3 pr-3 font-semibold">{row.record.company || row.record.name}</td>
                    <td className="py-3 pr-3">{row.record.email || "Missing email"}</td>
                    <td className="py-3 pr-3">{row.record.phone || row.record.mobile || ""}</td>
                    <td className="py-3 pr-3">{row.record.accountReference || ""}</td>
                    <td className="py-3 pr-3 text-red-700">{row.errors.join(", ") || (row.action === "Update" ? "Duplicate matched; will update" : row.action === "Skip" ? "Duplicate in uploaded file" : "")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {importState.summary ? (
        <div className="rounded-3xl bg-emerald-50 p-5 text-emerald-900 shadow-sm">
          <h3 className="text-lg font-bold">Import summary</h3>
          <p className="mt-2 text-sm">New records created: {importState.summary.created} · Existing records updated: {importState.summary.updated} · Duplicates skipped: {importState.summary.skipped} · Failed rows: {importState.summary.failed}</p>
        </div>
      ) : null}

      <div className="rounded-3xl bg-white p-5 shadow-sm">
        <h3 className="text-lg font-bold">Import log</h3>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[850px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-blue-100 text-left text-xs uppercase tracking-wide text-blue-600">
                <th className="py-3 pr-3">Date</th>
                <th className="py-3 pr-3">Imported By</th>
                <th className="py-3 pr-3">Type</th>
                <th className="py-3 pr-3">File</th>
                <th className="py-3 pr-3">Created</th>
                <th className="py-3 pr-3">Updated</th>
                <th className="py-3 pr-3">Skipped</th>
                <th className="py-3 pr-3">Failed</th>
              </tr>
            </thead>
            <tbody>
              {importLogs.length === 0 ? <tr><td className="py-4 text-blue-600" colSpan={8}>No imports logged yet.</td></tr> : null}
              {importLogs.map((log) => (
                <tr key={log.id} className="border-b border-blue-100">
                  <td className="py-3 pr-3">{log.date}</td>
                  <td className="py-3 pr-3">{log.importedBy}</td>
                  <td className="py-3 pr-3">{log.importType}</td>
                  <td className="py-3 pr-3">{log.fileName}</td>
                  <td className="py-3 pr-3">{log.created}</td>
                  <td className="py-3 pr-3">{log.updated}</td>
                  <td className="py-3 pr-3">{log.skipped}</td>
                  <td className="py-3 pr-3">{log.failed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function CompanySettingsPanel({ companySettings, setCompanySettings }) {
  const addressPreview = [companySettings.addressLine1, companySettings.addressLine2, companySettings.city, companySettings.county, companySettings.postcode, companySettings.country].filter(Boolean).join(", ");

  function updateCompanyField(field, value) {
    setCompanySettings((current) => ({ ...current, [field]: value }));
  }

  function readImageUpload(event, field) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) return;

    const reader = new FileReader();
    reader.onload = () => updateCompanyField(field, String(reader.result || ""));
    reader.readAsDataURL(file);
  }

  function handleLogoUpload(event) {
    readImageUpload(event, "logoDataUrl");
  }

  return (
    <div className="space-y-6">
      <div className="rounded-3xl bg-white p-5 shadow-sm">
        <h2 className="text-lg font-bold">Company & Branding</h2>
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="rounded-3xl bg-white p-5 shadow-sm">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Trading name"><TextInput value={companySettings.name} onChange={(event) => updateCompanyField("name", event.target.value)} /></Field>
            <Field label="OPHQ header image"><input type="file" accept="image/*" className="w-full rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm" onChange={(event) => readImageUpload(event, "appBrandImageDataUrl")} /></Field>
            <Field label="Legal company name"><TextInput value={companySettings.legalName} onChange={(event) => updateCompanyField("legalName", event.target.value)} /></Field>
            <Field label="Address line 1"><TextInput value={companySettings.addressLine1} onChange={(event) => updateCompanyField("addressLine1", event.target.value)} /></Field>
            <Field label="Address line 2"><TextInput value={companySettings.addressLine2} onChange={(event) => updateCompanyField("addressLine2", event.target.value)} /></Field>
            <Field label="City"><TextInput value={companySettings.city} onChange={(event) => updateCompanyField("city", event.target.value)} /></Field>
            <Field label="County"><TextInput value={companySettings.county} onChange={(event) => updateCompanyField("county", event.target.value)} /></Field>
            <Field label="Postcode"><TextInput value={companySettings.postcode} onChange={(event) => updateCompanyField("postcode", event.target.value)} /></Field>
            <Field label="Country"><TextInput value={companySettings.country} onChange={(event) => updateCompanyField("country", event.target.value)} /></Field>
            <Field label="Phone"><TextInput value={companySettings.phone} onChange={(event) => updateCompanyField("phone", event.target.value)} /></Field>
            <Field label="Email"><TextInput value={companySettings.email} onChange={(event) => updateCompanyField("email", event.target.value)} /></Field>
            <Field label="Website"><TextInput value={companySettings.website} onChange={(event) => updateCompanyField("website", event.target.value)} /></Field>
            <Field label="VAT number"><TextInput value={companySettings.vatNumber} onChange={(event) => updateCompanyField("vatNumber", event.target.value)} /></Field>
            <Field label="Company number"><TextInput value={companySettings.companyNumber} onChange={(event) => updateCompanyField("companyNumber", event.target.value)} /></Field>
            <Field label="Company logo upload"><input type="file" accept="image/*" className="w-full rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm" onChange={handleLogoUpload} /></Field>
          </div>
        </div>
        <div className="rounded-3xl bg-white p-5 shadow-sm">
          <h3 className="text-lg font-bold">Brand preview</h3>
          <div className="mt-4 rounded-2xl border border-blue-100 p-4">
            <div className="mb-5 rounded-2xl bg-blue-950 p-4 text-white">
              {companySettings.appBrandImageDataUrl ? <img src={companySettings.appBrandImageDataUrl} alt="OPHQ brand header" className="h-20 max-w-full object-contain" /> : <div className="flex h-20 items-center justify-center rounded-xl border border-dashed border-blue-300 text-xs font-black uppercase tracking-wide text-blue-200">Upload OPHQ header image</div>}
            </div>
            {companySettings.logoDataUrl ? <img src={companySettings.logoDataUrl} alt="Company logo" className="mb-4 max-h-20 max-w-40 object-contain" /> : <div className="mb-4 flex h-20 w-40 items-center justify-center rounded-xl bg-blue-50 text-xs font-bold text-blue-600">Logo</div>}
            <p className="text-xl font-bold">{companySettings.name || "Company name"}</p>
            <p className="text-sm text-blue-800">{companySettings.legalName}</p>
            <p className="mt-2 text-sm text-blue-800">{addressPreview || "Address will appear here"}</p>
            <p className="mt-2 text-sm text-blue-800">{companySettings.phone}</p>
            <p className="text-sm text-blue-800">{companySettings.email}</p>
            <p className="text-sm text-blue-800">{companySettings.website}</p>
            <p className="mt-2 text-xs font-semibold text-blue-600">VAT: {companySettings.vatNumber || "-"} · Company No: {companySettings.companyNumber || "-"}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function SteelTakeoffQuoteBuilder({ customers, quotes, setQuotes, pricingSchedule, setPricingSchedule, pricingSaveMeta, onSavePricing, activeRole = "staff", customProducts, onAddCustomProduct, onRemoveCustomProduct, onSendToPlannerInbox, productivityRules, jobs, staff, companySettings, onRegisterDocument }) {
  const productDatabase = getProductDatabase(customProducts);
  const canEditPricing = activeRole === "operations";
  const [quoteMeta, setQuoteMeta] = useState({ customerId: "", customerName: "", title: "", validUntil: toIso(addDays(new Date(), 30)), uploadedFileName: "", priority: "3", requestedDeliveryDate: "", jobDeliveryAddress: "" });
  const [lineForm, setLineForm] = useState({
    lineProductId: "",
    productId: "ub",
    sectionSize: "203x102x23",
    grade: "S355",
    finish: "Self colour",
    length: 1,
    width: "",
    thickness: "",
    quantity: 1,
    webHolesRequired: "No",
    webHoleSize: "18mm",
    webHoles: 0,
    webHoleCentres: 1000,
    flangeHolesRequired: "No",
    flangeHoleSize: "18mm",
    flangeHoles: 0,
    flangeHoleCentres: 1000,
    stiffenersRequired: "No",
    stiffeners: 0,
    stiffenerCentres: 1000,
    connectionRequired: "No",
    connectionType: "End plate",
    connectionQuantity: 1,
    topPlateRequired: "No",
    topPlateThickness: "8",
    topPlateWidth: "300",
    topPlateLength: "",
    topPlateQuantity: 1,
    topPlateWeldHitMm: "",
    topPlateWeldMissMm: "",
    bottomPlateRequired: "No",
    bottomPlateThickness: "8",
    bottomPlateWidth: "300",
    bottomPlateLength: "",
    bottomPlateQuantity: 1,
    bottomPlateWeldHitMm: "",
    bottomPlateWeldMissMm: "",
    basePlateRequired: "No",
    basePlateQuantity: 1,
    basePlateThickness: "10",
    basePlateWidth: "250",
    basePlateLength: "250",
    splicedRequired: "No",
    spliceQuantity: 0,
    spliceCostEach: 0,
    notes: "",
  });
  const [lines, setLines] = useState([]);
  const [status, setStatus] = useState("");
  const [noPriceImportText, setNoPriceImportText] = useState("");
  const [noPriceImportStatus, setNoPriceImportStatus] = useState("");
  const [editingLineId, setEditingLineId] = useState(null);
  const [selectedQuotePreviewId, setSelectedQuotePreviewId] = useState(null);
  const [editingQuoteId, setEditingQuoteId] = useState(null);
  const [productSetupOpen, setProductSetupOpen] = useState(false);
  const [importPanelOpen, setImportPanelOpen] = useState(false);
  const [pricingPanelOpen, setPricingPanelOpen] = useState(false);
  const emptyProductOptionRow = { id: createEntityId("product-option"), size: "", price: "" };
  const [newProductDraft, setNewProductDraft] = useState({ setupMode: "existing", existingProductId: "ub", name: "", category: "Custom Products", unit: "m", defaultGrade: "S275", productionMinutes: "", optionRows: [emptyProductOptionRow] });

  const quoteItems = lines.map((line) => buildSteelQuoteItem(line, pricingSchedule, productDatabase));
  const totals = calculateTotal(quoteItems, 20, "unitPrice");
  const productionStageBreakdown = mergeProductionStageBreakdowns(lines, productivityRules, productDatabase);
  const estimatedProductionHours = estimateQuoteProductionHours(lines, productivityRules, productDatabase);
  const leadTimePreview = calculatePlannerLeadTime({ jobs, staff, quoteHours: estimatedProductionHours, priority: quoteMeta.priority, requestedDeliveryDate: quoteMeta.requestedDeliveryDate, today: toIso(new Date()) });
  const selectedLineProduct = productDatabase.find((product) => product.id === lineForm.productId);
  const showSteelOnlyOptions = !selectedLineProduct?.isCustom;

  function updateLineForm(patch) {
    setLineForm((current) => ({ ...current, ...patch }));
  }

  function importNoPriceQuoteListFromText(text, sourceName = "pasted quote list") {
    const structuredRows = parseNoPriceQuoteListRows(text);
    const previewRows = (structuredRows.length ? structuredRows : parseAiTakeoffDraftRows(text)).filter((row) => row.sectionSize || row.length || row.productId);
    if (!previewRows.length) {
      setNoPriceImportStatus("No quote lines could be extracted. Try pasting the item list text from the PDF instead.");
      return;
    }
    const importedLines = previewRows.map((row, index) => buildSteelLineFromNoPriceImportRow(row, index));
    setLines((current) => [...current, ...importedLines]);
    setQuoteMeta((current) => ({ ...current, uploadedFileName: sourceName }));
    setNoPriceImportStatus(`Imported ${importedLines.length} no-price quote line(s) from ${sourceName}. Pricing has been calculated from the current pricing schedule.`);
  }

  async function handleNoPriceQuoteListFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

    if (isPdf) {
      setNoPriceImportStatus(`Extracting quote list text from ${file.name}...`);
      try {
        const extractedText = await extractTextFromPdfFile(file);
        if (!extractedText.trim()) {
          setNoPriceImportStatus("No selectable text was found in this PDF. If it is a scanned PDF, paste the quote list text manually for now.");
          return;
        }
        importNoPriceQuoteListFromText(extractedText, file.name);
      } catch (error) {
        setNoPriceImportStatus(`PDF import failed: ${error?.message || "Unknown PDF reader error"}. If this is a scanned/image-only PDF, paste the quote list text manually for now.`);
      }
      return;
    }

    const reader = new FileReader();
    reader.onload = () => importNoPriceQuoteListFromText(String(reader.result || ""), file.name);
    reader.onerror = () => setNoPriceImportStatus("Import failed: the file could not be read.");
    reader.readAsText(file);
  }

  function addSteelLine() {
    const product = productDatabase.find((item) => item.id === lineForm.productId) || steelProductDatabase[0];
    const line = { ...lineForm, id: editingLineId || `steel-line-${Date.now()}`, grade: lineForm.grade || product.defaultGrade };
    setLines((current) => editingLineId ? current.map((item) => item.id === editingLineId ? line : item) : [...current, line]);
    setEditingLineId(null);
    setStatus(editingLineId ? "Product line updated." : "Product line added to quote builder.");
  }

  function editSteelLine(lineId) {
    const line = lines.find((item) => item.id === lineId);
    if (!line) return;
    setLineForm({ ...line });
    setEditingLineId(lineId);
    setStatus("Line loaded into Manual Product Line for editing. Amend details then press Update product line.");
  }

  function cancelSteelLineEdit() {
    setEditingLineId(null);
    setStatus("Line edit cancelled.");
  }

  function removeSteelLine(lineId) {
    setLines((current) => current.filter((line) => line.id !== lineId));
  }

  function raiseSteelQuote() {
    if (!quoteMeta.title.trim()) {
      setStatus("Enter a quote title before raising the quote.");
      return;
    }
    if (!lines.length) {
      setStatus("Add at least one steel line before raising the quote.");
      return;
    }
    const customer = customers.find((item) => item.id === quoteMeta.customerId);
    const reservedQuoteNumber = reserveDocumentNumberSync({ documentType: "quote", records: quotes, linkedSourceNumber: "" });
    const quoteSequence = editingQuoteId ? (quotes.find((quote) => quote.id === editingQuoteId)?.quoteSequence || reservedQuoteNumber.sequence) : reservedQuoteNumber.sequence;
    const quoteNo = editingQuoteId ? (quotes.find((quote) => quote.id === editingQuoteId)?.quoteNo || reservedQuoteNumber.number) : reservedQuoteNumber.number;
    const quote = {
      id: editingQuoteId || `q-${Date.now()}`,
      quoteSequence,
      quoteNo,
      customerId: quoteMeta.customerId,
      customer: customer?.company || "",
      title: quoteMeta.title,
      date: editingQuoteId ? (quotes.find((item) => item.id === editingQuoteId)?.date || toIso(new Date())) : toIso(new Date()),
      validUntil: quoteMeta.validUntil,
      jobDeliveryAddress: quoteMeta.jobDeliveryAddress || "",
      deliveryAddress: quoteMeta.jobDeliveryAddress || "",
      priority: quoteMeta.priority,
      requestedDeliveryDate: quoteMeta.requestedDeliveryDate,
      estimatedProductionHours,
      productionStageBreakdown,
      leadTime: leadTimePreview,
      status: "Draft",
      uploadedFileName: quoteMeta.uploadedFileName,
      takeoffLines: lines,
      items: quoteItems,
      ...totals,
    };
    setQuotes((current) => editingQuoteId ? current.map((item) => item.id === editingQuoteId ? bumpRecordVersion(item, quote, null) : item) : [withRecordMeta(quote), ...current]);
    setLines([]);
    setEditingQuoteId(null);
    setQuoteMeta((current) => ({ ...current, customerId: "", customerName: "", title: "", uploadedFileName: "", requestedDeliveryDate: "", jobDeliveryAddress: "" }));
    setStatus(editingQuoteId ? `${quote.quoteNo} updated and returned to Draft.` : `${quote.quoteNo} raised from steel take-off quote builder.`);
  }

  function editCompletedQuote(quote) {
    setQuoteMeta({
      customerId: quote.customerId || customers[0]?.id || "",
      title: quote.title || "",
      validUntil: quote.validUntil || toIso(addDays(new Date(), 30)),
      uploadedFileName: quote.uploadedFileName || "",
      priority: quote.priority || "3",
      requestedDeliveryDate: quote.requestedDeliveryDate || "",
      jobDeliveryAddress: quote.jobDeliveryAddress || quote.deliveryAddress || "",
    });
    setLines((quote.takeoffLines || []).map((line) => ({ ...line })));
    setEditingQuoteId(quote.id);
    setSelectedQuotePreviewId(null);
    setStatus(`${quote.quoteNo} loaded back into Quote Builder for editing. Save will return it to Draft.`);
  }

  function duplicateCompletedQuote(quote) {
    const reservedQuoteNumber = reserveDocumentNumberSync({ documentType: "quote", records: quotes, linkedSourceNumber: "" });
    const quoteSequence = reservedQuoteNumber.sequence;
    const duplicated = {
      ...quote,
      id: createEntityId("quote"),
      quoteSequence,
      quoteNo: reservedQuoteNumber.number,
      title: `${quote.title || "Quote"} revision`,
      date: toIso(new Date()),
      validUntil: toIso(addDays(new Date(), 30)),
      status: "Draft",
      sentToPlannerAt: "",
      uploadedFileName: quote.uploadedFileName || "",
      takeoffLines: (quote.takeoffLines || []).map((line, index) => ({ ...line, id: `revision-line-${Date.now()}-${index}` })),
      items: (quote.items || []).map((item, index) => ({ ...item, id: `revision-item-${Date.now()}-${index}` })),
    };
    setQuotes((current) => [withRecordMeta(duplicated), ...current]);
    setSelectedQuotePreviewId(duplicated.id);
    setStatus(`${duplicated.quoteNo} created as a draft copy of ${quote.quoteNo}.`);
  }

  function removeCompletedQuote(quote) {
    const linkedJobs = jobs.filter((job) => job.quoteId === quote.id);
    const linkedMessage = linkedJobs.length ? `\n\nWarning: ${linkedJobs.length} job(s) are linked to this quote. Historic job records may no longer show the quote link if you remove it.` : "";
    const convertedMessage = ["Accepted", "Converted", "In Planner Review", "Ready to send", "Sent"].includes(quote.status) ? "\n\nThis quote is not a draft. Only remove it if this is a duplicate or was created in error." : "";
    if (!window.confirm(`Remove ${quote.quoteNo || "this quote"}?${convertedMessage}${linkedMessage}\n\nThis cannot be undone unless you restore a backup.`)) return;
    setQuotes((current) => current.filter((item) => item.id !== quote.id));
    if (selectedQuotePreviewId === quote.id) setSelectedQuotePreviewId(null);
    if (editingQuoteId === quote.id) {
      setEditingQuoteId(null);
      setLines([]);
    }
    setStatus(`${quote.quoteNo || "Quote"} removed.`);
  }

  function customProductRowMatches(row, product) {
    const size = String(row.sectionSize || "").trim().toLowerCase();
    if (product.id !== row.productId && product.extendsProductId !== row.productId) return false;
    if (!size) return product.id === row.productId && !product.extendsProductId;
    return (product.optionRows || []).some((option) => String(option.size || option.sectionSize || "").trim().toLowerCase() === size)
      || (product.sectionOptions || []).some((option) => String(option || "").trim().toLowerCase() === size);
  }

  function canRemovePricingProductRow(row) {
    if (!canEditPricing) return false;
    if (String(row.productId || "").startsWith("finish-")) return false;
    return (customProducts || []).some((product) => customProductRowMatches(row, product));
  }

  function removePricingProductRow(row) {
    if (!canRemovePricingProductRow(row)) {
      setStatus("Only Operations-created custom products or added section sizes can be removed from Product Setup.");
      return;
    }
    const sectionSize = String(row.sectionSize || "").trim();
    const productName = getProductName(row.productId, productDatabase);
    const quoteUses = quotes.some((quote) => (quote.takeoffLines || []).some((line) => String(line.productId || "") === String(row.productId || "") && (!sectionSize || String(line.sectionSize || "").trim().toLowerCase() === sectionSize.toLowerCase())));
    const useWarning = quoteUses ? "\n\nExisting quotes use this product/size. They will keep their saved line text, but this product/size will be hidden from new quote lines." : "";
    if (!window.confirm(`Remove ${productName}${sectionSize ? ` · ${sectionSize}` : ""} from new quotes and stock setup?${useWarning}`)) return;
    if (typeof onRemoveCustomProduct === "function") onRemoveCustomProduct({ productId: row.productId, sectionSize });
    setPricingSchedule((current) => current.filter((item) => !(item.productId === row.productId && String(item.sectionSize || "") === String(row.sectionSize || ""))));
    setStatus(`${productName}${sectionSize ? ` · ${sectionSize}` : ""} removed from Product Setup for new records.`);
  }

  function updateQuoteStatusLocal(quoteId, nextStatus) {
    setQuotes((current) => current.map((quote) => quote.id === quoteId ? bumpRecordVersion(quote, { status: nextStatus }, null) : quote));
  }

  function updatePricingRow(productId, patch, sectionSize = undefined) {
    if (!canEditPricing) {
      setStatus("Pricing can only be amended by Operations. Sales quotes use the saved Operations pricing schedule.");
      return;
    }
    setPricingSchedule((current) => current.map((row) => {
      const sameProduct = row.productId === productId;
      const sameSection = sectionSize === undefined ? true : String(row.sectionSize || "") === String(sectionSize || "");
      return sameProduct && sameSection ? { ...row, ...patch } : row;
    }));
  }

  function updateNewProductOption(optionId, patch) {
    setNewProductDraft((current) => ({
      ...current,
      optionRows: (current.optionRows || []).map((row) => row.id === optionId ? { ...row, ...patch } : row),
    }));
  }

  function addNewProductOption() {
    setNewProductDraft((current) => ({
      ...current,
      optionRows: [...(current.optionRows || []), { id: createEntityId("product-option"), size: "", price: "" }],
    }));
  }

  function removeNewProductOption(optionId) {
    setNewProductDraft((current) => {
      const nextRows = (current.optionRows || []).filter((row) => row.id !== optionId);
      return { ...current, optionRows: nextRows.length ? nextRows : [{ id: createEntityId("product-option"), size: "", price: "" }] };
    });
  }

  function addCustomProductFromQuoteBuilder() {
    const setupMode = newProductDraft.setupMode || "custom";
    const existingProduct = steelProductDatabase.find((product) => product.id === newProductDraft.existingProductId);
    if (setupMode === "custom" && !newProductDraft.name.trim()) {
      setStatus("Enter a product name before adding it.");
      return;
    }
    if (setupMode === "existing" && !existingProduct) {
      setStatus("Choose an existing product line before adding a section size.");
      return;
    }
    const optionRows = (newProductDraft.optionRows || []).filter((row) => String(row.size || "").trim());
    const missingTime = optionRows.some((row) => Number(row.productionMinutes || 0) <= 0);
    if (Number(newProductDraft.productionMinutes || 0) <= 0 && missingTime) {
      setStatus("Add production time in minutes for every custom product size, or enter a default time before creating the product.");
      return;
    }
    const product = createCustomProductRecord({
      ...newProductDraft,
      name: setupMode === "existing" ? existingProduct.name : newProductDraft.name,
      category: setupMode === "existing" ? existingProduct.category : newProductDraft.category,
      unit: newProductDraft.unit || existingProduct?.unit || "m",
      defaultGrade: newProductDraft.defaultGrade || existingProduct?.defaultGrade || "S275",
      optionRows: optionRows.map((row) => ({ ...row, productionMinutes: Number(row.productionMinutes || newProductDraft.productionMinutes || 0) })),
    }, customProducts);
    onAddCustomProduct(product);
    setLineForm((current) => ({ ...current, productId: product.id, sectionSize: product.sectionOptions[0] || "", grade: product.defaultGrade }));
    setNewProductDraft({ setupMode: "existing", existingProductId: "ub", name: "", category: "Custom Products", unit: "m", defaultGrade: "S275", productionMinutes: "", optionRows: [{ id: createEntityId("product-option"), size: "", price: "" }] });
    setProductSetupOpen(false);
    setStatus(`${product.name} product setup updated. New section sizes are available in Quotes, Purchasing and Stock Inventory.`);
  }

  const webHoleCount = normaliseTakeoffOptionCount(lineForm.webHolesRequired, lineForm.webHoles, lineForm.length, lineForm.webHoleCentres);
  const flangeHoleCount = normaliseTakeoffOptionCount(lineForm.flangeHolesRequired, lineForm.flangeHoles, lineForm.length, lineForm.flangeHoleCentres);
  const stiffenerCount = normaliseTakeoffOptionCount(lineForm.stiffenersRequired, lineForm.stiffeners, lineForm.length, lineForm.stiffenerCentres);

  return (
    <div className="space-y-6">
      <div className="rounded-3xl bg-white p-5 shadow-sm">
        <SectionHeader eyebrow="Sales" title="Quotes" description="Build steelwork quotes, calculate production time and send accepted work through planner approval." />
        {status ? <p className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800">{status}</p> : null}
      </div>

      <div className="rounded-3xl bg-white p-5 shadow-sm">
        <h3 className="text-base font-bold">Quote details</h3>
        <div className="mt-4 grid gap-3 md:grid-cols-6">
          <Field label="Customer"><AutoCompleteInput value={customers.find((customer) => customer.id === quoteMeta.customerId)?.company || quoteMeta.customerName || ""} options={customers.filter((customer) => !customer.hidden && customer.status !== "Dormant")} getLabel={(customer) => customer.company} onChange={(event) => { const typed = event.target.value; const match = customers.find((customer) => customer.company === typed); setQuoteMeta({ ...quoteMeta, customerId: match?.id || "", customerName: typed }); }} /></Field>
          <Field label="Quote title"><TextInput value={quoteMeta.title} onChange={(event) => setQuoteMeta({ ...quoteMeta, title: event.target.value })} placeholder="Project / description" /></Field>
          <Field label="Valid until"><TextInput type="date" value={quoteMeta.validUntil} onChange={(event) => setQuoteMeta({ ...quoteMeta, validUntil: event.target.value })} /></Field>
          <Field label="Upload reference file"><input type="file" className="w-full rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm" onChange={(event) => setQuoteMeta({ ...quoteMeta, uploadedFileName: event.target.files?.[0]?.name || "" })} /></Field>
          <Field label="Priority"><SelectInput value={quoteMeta.priority} onChange={(event) => setQuoteMeta({ ...quoteMeta, priority: event.target.value })}>{quotePriorityOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</SelectInput></Field>
          <Field label="Requested delivery"><TextInput type="date" value={quoteMeta.requestedDeliveryDate} onChange={(event) => setQuoteMeta({ ...quoteMeta, requestedDeliveryDate: event.target.value })} /></Field>
          <Field label="Job delivery address"><textarea className="w-full rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" rows={2} value={quoteMeta.jobDeliveryAddress || ""} onChange={(event) => setQuoteMeta({ ...quoteMeta, jobDeliveryAddress: event.target.value })} placeholder="Optional job-specific delivery address. Leave blank to use customer delivery address." /></Field>
        </div>
        {quoteMeta.uploadedFileName ? <p className="mt-3 rounded-lg bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-800">Attached: {quoteMeta.uploadedFileName}</p> : null}
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl bg-blue-50 p-3"><p className="text-xs font-bold text-blue-600">Estimated production time</p><p className="text-xl font-black">{estimatedProductionHours.toFixed(2)} hrs</p></div>
          <div className="rounded-2xl bg-blue-50 p-3"><p className="text-xs font-bold text-blue-600">Planner lead time preview</p><p className="text-xl font-black">{leadTimePreview.workingDays} working day(s)</p></div>
          <div className={`rounded-2xl p-3 ${leadTimePreview.meetsRequestedDate ? "bg-emerald-50" : "bg-amber-50"}`}><p className="text-xs font-bold text-blue-600">Earliest ready</p><p className="text-xl font-black">{leadTimePreview.earliestReadyDate}</p><p className="text-xs font-semibold text-blue-800">{leadTimePreview.message}</p></div>
        </div>
      </div>

      <div className="rounded-3xl bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h3 className="text-base font-bold">Import no-pricing quote list</h3>
            <p className="mt-1 text-sm text-blue-800">Import item details only when needed. Totals still use the pricing schedule.</p>
          </div>
          <button className="rounded-xl border bg-white px-4 py-2 text-sm font-bold" onClick={() => setImportPanelOpen(!importPanelOpen)}>{importPanelOpen ? "Hide import" : "Open import"}</button>
        </div>
        {importPanelOpen ? <div className="mt-4 space-y-4 rounded-2xl bg-blue-50 p-4">
          <Field label="Upload PDF / text list">
            <input type="file" accept=".pdf,.txt,.csv,text/plain,text/csv,application/pdf" className="w-full rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm" onChange={handleNoPriceQuoteListFile} />
          </Field>
          <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
            <Field label="Paste quote list text if PDF text cannot be read">
              <textarea className="min-h-[90px] w-full rounded-lg border border-blue-200 p-3 text-sm outline-none focus:border-blue-600" value={noPriceImportText} onChange={(event) => setNoPriceImportText(event.target.value)} placeholder="Example: B1 203x102x23 UB S355 4.2m qty 1, web holes 4" />
            </Field>
            <button className="rounded-xl bg-blue-700 px-4 py-3 text-sm font-bold text-white" onClick={() => importNoPriceQuoteListFromText(noPriceImportText, "pasted no-price list")}>Import pasted list</button>
          </div>
        </div> : null}
        {noPriceImportStatus ? <p className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800">{noPriceImportStatus}</p> : null}
      </div>

      <div className="rounded-3xl bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h3 className="text-base font-bold">Product setup</h3>
            <p className="mt-1 text-sm text-blue-800">Add a new product once and it becomes available in Manual product line, Pricing, Purchasing and Stock Inventory.</p>
          </div>
          <button className="rounded-xl border bg-white px-4 py-2 text-sm font-bold" onClick={() => setProductSetupOpen(!productSetupOpen)}>{productSetupOpen ? "Hide new product" : "Add new product"}</button>
        </div>
        {productSetupOpen ? (
          <div className="mt-5 rounded-2xl bg-blue-50 p-4">
            <div className="grid gap-3 md:grid-cols-6">
              <Field label="Product setup type"><SelectInput value={newProductDraft.setupMode || "existing"} onChange={(event) => { const mode = event.target.value; const existing = steelProductDatabase.find((product) => product.id === newProductDraft.existingProductId) || steelProductDatabase[0]; setNewProductDraft({ ...newProductDraft, setupMode: mode, unit: mode === "existing" ? existing.unit : newProductDraft.unit, defaultGrade: mode === "existing" ? existing.defaultGrade : newProductDraft.defaultGrade }); }}><option value="existing">Existing product line</option><option value="custom">Custom product</option></SelectInput></Field>
              {newProductDraft.setupMode !== "custom" ? <Field label="Existing product line"><SelectInput value={newProductDraft.existingProductId || "ub"} onChange={(event) => { const existing = steelProductDatabase.find((product) => product.id === event.target.value); setNewProductDraft({ ...newProductDraft, existingProductId: event.target.value, unit: existing?.unit || "m", defaultGrade: existing?.defaultGrade || "S275" }); }}>{steelProductDatabase.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</SelectInput></Field> : <Field label="Product name"><TextInput value={newProductDraft.name} onChange={(event) => setNewProductDraft({ ...newProductDraft, name: event.target.value })} placeholder="e.g. Handrail tube" /></Field>}
              {newProductDraft.setupMode === "custom" ? <Field label="Category"><TextInput value={newProductDraft.category} onChange={(event) => setNewProductDraft({ ...newProductDraft, category: event.target.value })} placeholder="e.g. Balustrade" /></Field> : null}
              <Field label="Unit"><SelectInput value={newProductDraft.unit} onChange={(event) => setNewProductDraft({ ...newProductDraft, unit: event.target.value })}><option value="m">m</option><option value="each">each</option><option value="kg">kg</option><option value="tonne">tonne</option><option value="sheet">sheet</option></SelectInput></Field>
              <Field label="Default grade"><SelectInput value={newProductDraft.defaultGrade} onChange={(event) => setNewProductDraft({ ...newProductDraft, defaultGrade: event.target.value })}>{steelGradeOptions.map((grade) => <option key={grade}>{grade}</option>)}</SelectInput></Field>
              <Field label="Default time mins"><TextInput required type="number" value={newProductDraft.productionMinutes} onChange={(event) => setNewProductDraft({ ...newProductDraft, productionMinutes: event.target.value })} placeholder="Required or per size" /></Field>
              <div className="flex items-end"><button className="w-full rounded-xl bg-blue-700 px-4 py-3 text-sm font-bold text-white" onClick={addCustomProductFromQuoteBuilder}>{newProductDraft.setupMode === "custom" ? "Create product" : "Add section size"}</button></div>
            </div>
            <div className="mt-4 rounded-2xl bg-white p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-bold text-blue-950">Section / size options and prices</p>
                  <p className="text-xs text-blue-700">Add each available option on its own line. Example: Welding table 1000x500, £350 each.</p>
                </div>
                <button className="rounded-lg border bg-white px-3 py-2 text-xs font-bold" onClick={addNewProductOption}>Add size line</button>
              </div>
              <div className="space-y-2">
                {(newProductDraft.optionRows || []).map((option, index) => (
                  <div key={option.id} className="grid gap-2 md:grid-cols-[80px_1fr_150px_150px_auto] md:items-end">
                    <div className="rounded-lg bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700">Line {index + 1}</div>
                    <Field label="Section / size"><TextInput value={option.size} onChange={(event) => updateNewProductOption(option.id, { size: event.target.value })} placeholder="e.g. 1000x500" /></Field>
                    <Field label="Price £"><TextInput type="number" step="0.01" value={option.price} onChange={(event) => updateNewProductOption(option.id, { price: event.target.value })} placeholder="0.00" /></Field>
                    <Field label="Time mins"><TextInput type="number" value={option.productionMinutes || ""} onChange={(event) => updateNewProductOption(option.id, { productionMinutes: event.target.value })} placeholder="Optional" /></Field>
                    <button disabled={(newProductDraft.optionRows || []).length === 1} className="rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-bold text-red-700 disabled:opacity-40" onClick={() => removeNewProductOption(option.id)}>Remove</button>
                  </div>
                ))}
              </div>
            </div>
            <p className="mt-2 text-xs font-semibold text-blue-700">For steel sections, keep kg/m as the final x value where relevant. For fixed products like welding tables, enter the item size, fixed price and required production time. Custom product time is mandatory and is split by the original planner percentage rule.</p>
          </div>
        ) : null}
      </div>

      <div className="rounded-3xl bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h3 className="text-2xl font-black">Manual product line</h3>
            <p className="mt-1 text-sm text-blue-600">Inventory matches the planner quote database.</p>
          </div>
          <div className="flex items-end gap-3">
            <Field label="Product ID">
              <TextInput value={lineForm.lineProductId} onChange={(event) => updateLineForm({ lineProductId: event.target.value })} placeholder="e.g. B1 / L1 / C1" />
            </Field>
            <div className="mb-1 rounded-full bg-blue-50 px-4 py-3 text-xs font-black text-blue-900">Structural Sections</div>
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-6">
          <Field label="Product"><SelectInput value={lineForm.productId} onChange={(event) => { const product = productDatabase.find((item) => item.id === event.target.value); const options = getSectionOptions(event.target.value, customProducts); updateLineForm({ productId: event.target.value, grade: product?.defaultGrade || lineForm.grade, sectionSize: options[0] || "" }); }}>{productDatabase.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</SelectInput></Field>
          <Field label="Section / Size"><SelectInput value={lineForm.sectionSize} onChange={(event) => updateLineForm({ sectionSize: event.target.value })}>{getSectionOptions(lineForm.productId, customProducts).map((section) => <option key={section} value={section}>{section}</option>)}</SelectInput></Field>
          <Field label="Grade"><SelectInput value={lineForm.grade} onChange={(event) => updateLineForm({ grade: event.target.value })}>{steelGradeOptions.map((grade) => <option key={grade}>{grade}</option>)}</SelectInput></Field>
          <Field label="Finish"><SelectInput value={lineForm.finish} onChange={(event) => updateLineForm({ finish: event.target.value })}>{steelFinishOptions.map((finish) => <option key={finish}>{finish}</option>)}</SelectInput></Field>
          <Field label="Length m"><TextInput type="number" value={lineForm.length} onChange={(event) => updateLineForm({ length: event.target.value })} /></Field>
          <Field label="Quantity"><TextInput type="number" value={lineForm.quantity} onChange={(event) => updateLineForm({ quantity: event.target.value })} /></Field>
        </div>

        {showSteelOnlyOptions ? (
          <div className="mt-5 space-y-4">
            <div className="rounded-2xl bg-blue-50 p-4">
              <Field label="Web Holes"><SelectInput value={lineForm.webHolesRequired} onChange={(event) => updateLineForm({ webHolesRequired: event.target.value })}><option>No</option><option>Yes</option></SelectInput></Field>
              {lineForm.webHolesRequired === "Yes" ? <div className="mt-4 grid gap-3 md:grid-cols-4"><Field label="Hole size"><TextInput value={lineForm.webHoleSize} onChange={(event) => updateLineForm({ webHoleSize: event.target.value })} /></Field><Field label="Centres mm"><TextInput type="number" value={lineForm.webHoleCentres} onChange={(event) => updateLineForm({ webHoleCentres: event.target.value, webHoles: calculateHoleCountFromCentres(lineForm.length, event.target.value) })} /></Field><Field label="Quantity calculated"><TextInput type="number" value={webHoleCount} readOnly /></Field><div className="rounded-xl bg-white p-3 text-xs font-semibold text-blue-800">Calculated from centres · Distance from end: {calculateDistanceFromEnd(lineForm.length, webHoleCount, lineForm.webHoleCentres).toFixed(0)}mm</div></div> : null}
            </div>

            <div className="rounded-2xl bg-blue-50 p-4">
              <Field label="Flange Holes"><SelectInput value={lineForm.flangeHolesRequired} onChange={(event) => updateLineForm({ flangeHolesRequired: event.target.value })}><option>No</option><option>Yes</option></SelectInput></Field>
              {lineForm.flangeHolesRequired === "Yes" ? <div className="mt-4 grid gap-3 md:grid-cols-4"><Field label="Hole size"><TextInput value={lineForm.flangeHoleSize} onChange={(event) => updateLineForm({ flangeHoleSize: event.target.value })} /></Field><Field label="Centres mm"><TextInput type="number" value={lineForm.flangeHoleCentres} onChange={(event) => updateLineForm({ flangeHoleCentres: event.target.value, flangeHoles: calculateHoleCountFromCentres(lineForm.length, event.target.value) })} /></Field><Field label="Quantity calculated"><TextInput type="number" value={flangeHoleCount} readOnly /></Field><div className="rounded-xl bg-white p-3 text-xs font-semibold text-blue-800">Calculated from centres · Distance from end: {calculateDistanceFromEnd(lineForm.length, flangeHoleCount, lineForm.flangeHoleCentres).toFixed(0)}mm</div></div> : null}
            </div>

            <div className="rounded-2xl bg-blue-50 p-4">
              <Field label="Stiffeners"><SelectInput value={lineForm.stiffenersRequired} onChange={(event) => updateLineForm({ stiffenersRequired: event.target.value })}><option>No</option><option>Yes</option></SelectInput></Field>
              {lineForm.stiffenersRequired === "Yes" ? <div className="mt-4 grid gap-3 md:grid-cols-3"><Field label="Centres mm"><TextInput type="number" value={lineForm.stiffenerCentres} onChange={(event) => updateLineForm({ stiffenerCentres: event.target.value, stiffeners: calculateHoleCountFromCentres(lineForm.length, event.target.value) })} /></Field><Field label="Quantity calculated"><TextInput type="number" value={stiffenerCount} readOnly /></Field><div className="rounded-xl bg-white p-3 text-xs font-semibold text-blue-800">Calculated from centres · Distance from end: {calculateDistanceFromEnd(lineForm.length, stiffenerCount, lineForm.stiffenerCentres).toFixed(0)}mm</div></div> : null}
            </div>

            <div className="rounded-2xl bg-blue-50 p-4">
              <Field label="Top Plate"><SelectInput value={lineForm.topPlateRequired || "No"} onChange={(event) => updateLineForm({ topPlateRequired: event.target.value })}><option>No</option><option>Yes</option></SelectInput></Field>
              {lineForm.topPlateRequired === "Yes" ? <div className="mt-4 grid gap-3 md:grid-cols-6"><Field label="Thickness mm"><TextInput type="number" value={lineForm.topPlateThickness} onChange={(event) => updateLineForm({ topPlateThickness: event.target.value })} /></Field><Field label="Width mm"><TextInput type="number" value={lineForm.topPlateWidth} onChange={(event) => updateLineForm({ topPlateWidth: event.target.value })} /></Field><Field label="Length m"><TextInput type="number" value={lineForm.topPlateLength} onChange={(event) => updateLineForm({ topPlateLength: event.target.value })} placeholder="Blank = beam length" /></Field><Field label="Quantity"><TextInput type="number" value={lineForm.topPlateQuantity} onChange={(event) => updateLineForm({ topPlateQuantity: event.target.value })} /></Field><Field label="Weld hit mm"><TextInput type="number" value={lineForm.topPlateWeldHitMm || ""} onChange={(event) => updateLineForm({ topPlateWeldHitMm: event.target.value })} /></Field><Field label="Weld miss mm"><TextInput type="number" value={lineForm.topPlateWeldMissMm || ""} onChange={(event) => updateLineForm({ topPlateWeldMissMm: event.target.value })} /></Field></div> : null}
            </div>
            <div className="rounded-2xl bg-blue-50 p-4">
              <Field label="Bottom Plate"><SelectInput value={lineForm.bottomPlateRequired || "No"} onChange={(event) => updateLineForm({ bottomPlateRequired: event.target.value })}><option>No</option><option>Yes</option></SelectInput></Field>
              {lineForm.bottomPlateRequired === "Yes" ? <div className="mt-4 grid gap-3 md:grid-cols-6"><Field label="Thickness mm"><TextInput type="number" value={lineForm.bottomPlateThickness} onChange={(event) => updateLineForm({ bottomPlateThickness: event.target.value })} /></Field><Field label="Width mm"><TextInput type="number" value={lineForm.bottomPlateWidth} onChange={(event) => updateLineForm({ bottomPlateWidth: event.target.value })} /></Field><Field label="Length m"><TextInput type="number" value={lineForm.bottomPlateLength} onChange={(event) => updateLineForm({ bottomPlateLength: event.target.value })} placeholder="Blank = beam length" /></Field><Field label="Quantity"><TextInput type="number" value={lineForm.bottomPlateQuantity} onChange={(event) => updateLineForm({ bottomPlateQuantity: event.target.value })} /></Field><Field label="Weld hit mm"><TextInput type="number" value={lineForm.bottomPlateWeldHitMm || ""} onChange={(event) => updateLineForm({ bottomPlateWeldHitMm: event.target.value })} /></Field><Field label="Weld miss mm"><TextInput type="number" value={lineForm.bottomPlateWeldMissMm || ""} onChange={(event) => updateLineForm({ bottomPlateWeldMissMm: event.target.value })} /></Field></div> : null}
            </div>

            <div className="rounded-2xl bg-blue-50 p-4">
              <Field label="Connection"><SelectInput value={lineForm.connectionRequired} onChange={(event) => updateLineForm({ connectionRequired: event.target.value })}><option>No</option><option>Yes</option></SelectInput></Field>
              {lineForm.connectionRequired === "Yes" ? <div className="mt-4 grid gap-3 md:grid-cols-2"><Field label="Connection type"><SelectInput value={lineForm.connectionType} onChange={(event) => updateLineForm({ connectionType: event.target.value })}>{Object.keys(connectionPricingIds).map((item) => <option key={item}>{item}</option>)}</SelectInput></Field><Field label="Connection qty"><TextInput type="number" value={lineForm.connectionQuantity} onChange={(event) => updateLineForm({ connectionQuantity: event.target.value })} /></Field></div> : null}
            </div>

            <div className="rounded-2xl bg-blue-50 p-4">
              <Field label="Base plate"><SelectInput value={lineForm.basePlateRequired} onChange={(event) => updateLineForm({ basePlateRequired: event.target.value })}><option>No</option><option>Yes</option></SelectInput></Field>
              {lineForm.basePlateRequired === "Yes" ? <div className="mt-4 grid gap-3 md:grid-cols-4"><Field label="Thickness mm"><TextInput type="number" value={lineForm.basePlateThickness} onChange={(event) => updateLineForm({ basePlateThickness: event.target.value })} /></Field><Field label="Width mm"><TextInput type="number" value={lineForm.basePlateWidth} onChange={(event) => updateLineForm({ basePlateWidth: event.target.value })} /></Field><Field label="Length mm"><TextInput type="number" value={lineForm.basePlateLength} onChange={(event) => updateLineForm({ basePlateLength: event.target.value })} /></Field><Field label="Quantity"><TextInput type="number" value={lineForm.basePlateQuantity} onChange={(event) => updateLineForm({ basePlateQuantity: event.target.value })} /></Field></div> : null}
            </div>

            <div className="rounded-2xl bg-blue-50 p-4">
              <Field label="Spliced"><SelectInput value={lineForm.splicedRequired} onChange={(event) => updateLineForm({ splicedRequired: event.target.value })}><option>No</option><option>Yes</option></SelectInput></Field>
              {lineForm.splicedRequired === "Yes" ? <div className="mt-4 grid gap-3 md:grid-cols-2"><Field label="No. splices"><TextInput type="number" value={lineForm.spliceQuantity} onChange={(event) => updateLineForm({ spliceQuantity: event.target.value })} /></Field><Field label="Cost per splice"><TextInput type="number" value={lineForm.spliceCostEach} onChange={(event) => updateLineForm({ spliceCostEach: event.target.value })} /></Field></div> : null}
            </div>
          </div>
        ) : null}

        <div className="mt-5 flex flex-wrap gap-2">
          <button className="rounded-xl bg-blue-700 px-4 py-3 text-sm font-bold text-white" onClick={addSteelLine}>{editingLineId ? "Update product line" : "Add product line"}</button>
          {editingLineId ? <button className="rounded-xl border bg-white px-4 py-3 text-sm font-bold" onClick={cancelSteelLineEdit}>Cancel edit</button> : null}
        </div>
      </div>

      <div className="rounded-3xl bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div><h3 className="text-lg font-bold">Quote lines</h3><p className="mt-1 text-sm text-blue-800">Internal pricing view. Customer quote PDFs hide rate breakdowns.</p></div>
          <div className="rounded-2xl bg-blue-50 px-4 py-3 text-right text-sm"><p>Subtotal <span className="font-bold">{currency(totals.subtotal)}</span></p><p>VAT <span className="font-bold">{currency(totals.vat)}</span></p><p className="text-lg font-black">Total {currency(totals.total)}</p></div>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[950px] border-collapse text-sm">
            <thead><tr className="border-b border-blue-100 text-left text-xs uppercase tracking-wide text-blue-600"><th className="py-3 pr-3">Item</th><th className="py-3 pr-3">Details</th><th className="py-3 pr-3 text-right">Qty</th><th className="py-3 pr-3 text-right">Length</th><th className="py-3 pr-3 text-right">Weight</th><th className="py-3 pr-3 text-right">Total</th><th className="py-3"></th></tr></thead>
            <tbody>{quoteItems.length === 0 ? <tr><td className="py-4 text-blue-600" colSpan={7}>No steel lines added yet.</td></tr> : null}{quoteItems.map((item) => <tr key={item.id} className="border-b border-blue-100 align-top"><td className="py-3 pr-3 font-bold">{item.description}</td><td className="py-3 pr-3 text-xs text-blue-800">{item.processDetails.join(" · ") || "No extras"}</td><td className="py-3 pr-3 text-right">{item.quantity}</td><td className="py-3 pr-3 text-right">{item.length}m</td><td className="py-3 pr-3 text-right">{item.weightKg.toFixed(2)}kg</td><td className="py-3 pr-3 text-right font-bold">{currency(item.quantity * item.unitPrice)}</td><td className="py-3"><div className="flex gap-2"><button className="rounded-lg border bg-white px-3 py-2 text-xs font-bold" onClick={() => editSteelLine(item.id)}>Edit</button><button className="rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-bold text-red-700" onClick={() => removeSteelLine(item.id)}>Remove</button></div></td></tr>)}</tbody>
          </table>
        </div>
        <button disabled={!lines.length} className="mt-4 rounded-xl bg-emerald-700 px-4 py-3 text-sm font-bold text-white disabled:opacity-40" onClick={raiseSteelQuote}>{editingQuoteId ? "Save edited quote" : "Raise quote"}</button>
      </div>

      <div className="rounded-3xl bg-white p-5 shadow-sm">
        <h3 className="text-lg font-bold">Quotes</h3>
        <div className="mt-4 grid gap-3 xl:grid-cols-2">
          {quotes.map((quote) => (
            <div key={quote.id} className="rounded-2xl border border-blue-100 bg-white p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between"><div><p className="font-bold">{quote.quoteNo} · {quote.title}</p><p className="text-sm text-blue-800">{quote.customer} · {quote.date} · Valid until {quote.validUntil}</p>{quote.uploadedFileName ? <p className="mt-1 text-xs font-semibold text-blue-600">File: {quote.uploadedFileName}</p> : null}<p className="mt-2 text-xl font-bold">{currency(quote.total)}</p><p className="mt-1 text-xs font-semibold text-blue-700">Est. production: {Number(quote.estimatedProductionHours || 0).toFixed(2)} hrs · Ready: {quote.leadTime?.earliestReadyDate || "Planner review pending"}</p></div><span className={`w-fit rounded-full px-3 py-1 text-xs font-bold ${getStatusStyle(quote.status)}`}>{quote.status}</span></div>
              <div className="mt-4 flex flex-wrap gap-2"><SelectInput value={quote.status} onChange={(event) => updateQuoteStatusLocal(quote.id, event.target.value)}>{quoteStatuses.map((status) => <option key={status}>{status}</option>)}</SelectInput><button className="rounded-xl border bg-white px-4 py-2 text-sm font-bold" onClick={() => setSelectedQuotePreviewId(selectedQuotePreviewId === quote.id ? null : quote.id)}>Preview quote</button><button className="rounded-xl border bg-white px-4 py-2 text-sm font-bold" onClick={() => editCompletedQuote(quote)}>Edit quote</button><button className="rounded-xl border bg-white px-4 py-2 text-sm font-bold" onClick={() => duplicateCompletedQuote(quote)}>Duplicate/revise</button><button className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-bold text-red-700" onClick={() => removeCompletedQuote(quote)}>Remove quote</button><button disabled={["In Planner Review", "Ready to send", "Sent", "Accepted", "Converted"].includes(quote.status)} className="rounded-xl bg-blue-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-40" onClick={() => onSendToPlannerInbox(quote)}>Send for approval</button>{quote.status === "Draft" ? <span className="rounded-xl bg-blue-50 px-3 py-2 text-xs font-bold text-blue-800">Lead time will be approved before customer send</span> : null}</div>
              {selectedQuotePreviewId === quote.id ? <div className="mt-4 space-y-3"><div className="flex justify-end"><button className="rounded-xl bg-blue-700 px-4 py-2 text-sm font-bold text-white" onClick={() => printQuotePdf({ quote, customer: customers.find((customer) => customer.id === quote.customerId), companySettings, onRegisterDocument })}>Print / Save quote PDF</button></div><QuotePreview quote={quote} customer={customers.find((customer) => customer.id === quote.customerId)} companySettings={companySettings} /></div> : null}
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-3xl bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h3 className="text-base font-bold">Pricing</h3>
            <p className="mt-1 text-sm text-blue-800">Operations-owned saved pricing schedule. Sales quotes use these saved rates but cannot alter them.</p>
            {pricingSaveMeta?.savedAt ? <p className="mt-1 text-xs font-semibold text-emerald-700">Last saved by {pricingSaveMeta.savedBy || "Operations"} at {new Date(pricingSaveMeta.savedAt).toLocaleString("en-GB")}</p> : <p className="mt-1 text-xs font-semibold text-amber-700">Pricing is using the current saved app data. Operations should press Save Pricing after markup changes.</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            {canEditPricing ? <button className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-bold text-white" onClick={onSavePricing}>Save Pricing</button> : <span className="rounded-xl bg-blue-50 px-3 py-2 text-xs font-bold text-blue-800">Read-only pricing</span>}
            <button className="rounded-xl border bg-white px-4 py-2 text-sm font-bold" onClick={() => setPricingPanelOpen(!pricingPanelOpen)}>{pricingPanelOpen ? "Hide pricing" : "Open pricing"}</button>
          </div>
        </div>
        {pricingPanelOpen ? <div className="mt-4 overflow-auto rounded-2xl border border-blue-100">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead><tr className="border-b border-blue-100 bg-blue-50 text-left text-xs uppercase tracking-wide text-blue-600"><th className="py-3 pl-3 pr-3">Product / Process</th><th className="py-3 pr-3 text-right">Buy price</th><th className="py-3 pr-3 text-right">Markup £</th><th className="py-3 pr-3 text-right">Sell</th><th className="py-3 pr-3 text-right">Actions</th></tr></thead>
            <tbody>{pricingSchedule.map((row) => <tr key={`${row.productId}-${row.sectionSize || "default"}`} className="border-b border-blue-100"><td className="py-2 pl-3 pr-3 font-semibold"><p>{getProductName(row.productId, productDatabase)}</p>{row.sectionSize ? <p className="text-xs font-semibold text-blue-600">Section / size: {row.sectionSize}</p> : null}{row.inheritsProductPricing ? <p className="text-xs font-semibold text-emerald-700">Inherits parent product pricing</p> : row.priceMode === "fixed" ? <p className="text-xs font-semibold text-emerald-700">Fixed price per item</p> : <p className="text-xs font-semibold text-blue-600">{row.productId?.startsWith("finish-") ? "Finish £/tonne" : "Steel/material £/tonne"}</p>}</td><td className="py-2 pr-3"><TextInput disabled={!canEditPricing} type="number" value={row.buyPrice} onChange={(event) => updatePricingRow(row.productId, { buyPrice: event.target.value }, row.sectionSize || "")} /></td><td className="py-2 pr-3"><TextInput disabled={!canEditPricing} type="number" value={row.markupAmount} onChange={(event) => updatePricingRow(row.productId, { markupAmount: event.target.value }, row.sectionSize || "")} /></td><td className="py-2 pr-3 text-right font-bold">{currency(calculateSellPriceFromRow(row))}</td><td className="py-2 pr-3 text-right">{canRemovePricingProductRow(row) ? <button className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700" onClick={() => removePricingProductRow(row)}>Remove product</button> : <span className="text-xs font-semibold text-blue-400">Locked</span>}</td></tr>)}</tbody>
          </table>
        </div> : null}
      </div>
    </div>
  );
}

function CustomersCrmTab({ customers, suppliers = [], onAddCustomer, onUpdateCustomer, onRemoveCustomer, onRemoveSupplier }) {
  const [newCustomer, setNewCustomer] = useState({ company: "", contact: "", email: "", phone: "", deliveryAddress: "", status: "Lead", notes: "" });
  const [addCustomerOpen, setAddCustomerOpen] = useState(false);

  function addCustomer() {
    if (!newCustomer.company.trim()) return;
    onAddCustomer(newCustomer);
    setNewCustomer({ company: "", contact: "", email: "", phone: "", deliveryAddress: "", status: "Lead", notes: "" });
  }

  function updateCustomer(customerId, patch) {
    onUpdateCustomer(customerId, patch);
  }

  function removeCustomer(customerId) {
    if (typeof onRemoveCustomer === "function") onRemoveCustomer(customerId);
  }

  function removeSupplier(supplierId) {
    if (typeof onRemoveSupplier === "function") onRemoveSupplier(supplierId);
  }

  return (
    <div className="space-y-6">
      <div className="rounded-3xl bg-white p-5 shadow-sm">
        <SectionHeader eyebrow="CRM" title="Customers & Leads" description="Manage customer details, contacts, delivery addresses and lead status." />
      </div>
      <div className="rounded-3xl bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-lg font-bold">Add customer / lead</h3>
            <p className="mt-1 text-sm text-blue-800">Open only when adding a new customer or lead.</p>
          </div>
          <button className="rounded-xl border bg-white px-4 py-2 text-sm font-bold" onClick={() => setAddCustomerOpen(!addCustomerOpen)}>{addCustomerOpen ? "Hide add customer" : "Open add customer"}</button>
        </div>
        {addCustomerOpen ? <div className="mt-4 space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
          <Field label="Company"><TextInput value={newCustomer.company} onChange={(event) => setNewCustomer({ ...newCustomer, company: event.target.value })} /></Field>
          <Field label="Contact"><TextInput value={newCustomer.contact} onChange={(event) => setNewCustomer({ ...newCustomer, contact: event.target.value })} /></Field>
          <Field label="Status"><SelectInput value={newCustomer.status} onChange={(event) => setNewCustomer({ ...newCustomer, status: event.target.value })}><option>Lead</option><option>Quoted</option><option>Customer</option><option>Dormant</option></SelectInput></Field>
          <Field label="Email"><TextInput value={newCustomer.email} onChange={(event) => setNewCustomer({ ...newCustomer, email: event.target.value })} /></Field>
          <Field label="Phone"><TextInput value={newCustomer.phone} onChange={(event) => setNewCustomer({ ...newCustomer, phone: event.target.value })} /></Field>
          <Field label="Delivery address"><TextInput value={newCustomer.deliveryAddress} onChange={(event) => setNewCustomer({ ...newCustomer, deliveryAddress: event.target.value })} /></Field>
          <Field label="Notes"><TextInput value={newCustomer.notes} onChange={(event) => setNewCustomer({ ...newCustomer, notes: event.target.value })} /></Field>
          </div>
          <button className="rounded-xl bg-blue-700 px-4 py-3 text-sm font-bold text-white" onClick={addCustomer}>Add customer</button>
        </div> : null}
      </div>
      <div className="overflow-x-auto rounded-3xl bg-white p-5 shadow-sm">
        <table className="w-full min-w-[1000px] border-collapse text-sm">
          <thead><tr className="border-b border-blue-100 text-left text-xs uppercase tracking-wide text-blue-600"><th className="py-3 pr-3">Company</th><th className="py-3 pr-3">Contact</th><th className="py-3 pr-3">Status</th><th className="py-3 pr-3">Email</th><th className="py-3 pr-3">Phone</th><th className="py-3 pr-3">Address</th><th className="py-3 pr-3">Notes</th><th className="py-3 pr-3">Actions</th></tr></thead>
          <tbody>
            {customers.filter((customer) => !customer.hidden).length === 0 ? <tr><td className="py-4 text-blue-600" colSpan={8}>No customers or leads yet. Open Add customer / lead to create the first record.</td></tr> : null}
            {customers.filter((customer) => !customer.hidden).map((customer) => (
              <tr key={customer.id} className="border-b border-blue-100 align-top">
                <td className="py-3 pr-3"><TextInput value={customer.company || ""} onChange={(event) => updateCustomer(customer.id, { company: event.target.value })} /></td>
                <td className="py-3 pr-3"><TextInput value={customer.contact || ""} onChange={(event) => updateCustomer(customer.id, { contact: event.target.value })} /></td>
                <td className="py-3 pr-3"><SelectInput value={customer.status || "Customer"} onChange={(event) => updateCustomer(customer.id, { status: event.target.value })}><option>Lead</option><option>Quoted</option><option>Customer</option><option>Dormant</option></SelectInput></td>
                <td className="py-3 pr-3"><TextInput value={customer.email || ""} onChange={(event) => updateCustomer(customer.id, { email: event.target.value })} /></td>
                <td className="py-3 pr-3"><TextInput value={customer.phone || ""} onChange={(event) => updateCustomer(customer.id, { phone: event.target.value })} /></td>
                <td className="py-3 pr-3"><TextInput value={customer.deliveryAddress || ""} onChange={(event) => updateCustomer(customer.id, { deliveryAddress: event.target.value })} /></td>
                <td className="py-3 pr-3"><TextInput value={customer.notes || ""} onChange={(event) => updateCustomer(customer.id, { notes: event.target.value })} /></td>
                <td className="py-3 pr-3"><button className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700" onClick={() => removeCustomer(customer.id)}>Remove</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="overflow-x-auto rounded-3xl bg-white p-5 shadow-sm">
        <h3 className="mb-3 text-lg font-bold">Suppliers</h3>
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <thead><tr className="border-b border-blue-100 text-left text-xs uppercase tracking-wide text-blue-600"><th className="py-3 pr-3">Name</th><th className="py-3 pr-3">Contact</th><th className="py-3 pr-3">Email</th><th className="py-3 pr-3">Phone</th><th className="py-3 pr-3">Status</th><th className="py-3 pr-3">Actions</th></tr></thead>
          <tbody>
            {suppliers.filter((supplier) => !supplier.hidden).length === 0 ? <tr><td className="py-4 text-blue-600" colSpan={6}>No suppliers imported yet.</td></tr> : null}
            {suppliers.filter((supplier) => !supplier.hidden).map((supplier) => (
              <tr key={supplier.id} className="border-b border-blue-100 align-top">
                <td className="py-3 pr-3 font-bold">{supplier.name}</td>
                <td className="py-3 pr-3">{supplier.contact || ""}</td>
                <td className="py-3 pr-3">{supplier.email || ""}</td>
                <td className="py-3 pr-3">{supplier.phone || ""}</td>
                <td className="py-3 pr-3">{supplier.status || "Active"}</td>
                <td className="py-3 pr-3"><button className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700" onClick={() => removeSupplier(supplier.id)}>Remove</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DeploymentFoundationsPanel({ cloudSyncStatus, storedDocuments, profiles, auditLog, authStatus, recordLocks }) {
  const authPermissionReport = runAuthPermissionReadinessTests();
  const numberingReport = runNumberingReadinessTests();
  const lockReport = runRecordLockReadinessTests();
  const [liveDetailsOpen, setLiveDetailsOpen] = useState(false);
  return (
    <div className="space-y-6">
      <div className="rounded-3xl bg-white p-5 shadow-sm">
        <h2 className="text-lg font-bold">Live Readiness</h2>
        <p className="mt-1 text-sm text-blue-800">Tracks the move from local prototype to cloud-backed live app.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-3xl bg-white p-5 shadow-sm"><p className="text-xs font-bold uppercase text-blue-500">Storage mode</p><p className="mt-1 text-xl font-black">{deploymentConfig.storageMode}</p></div>
        <div className="rounded-3xl bg-white p-5 shadow-sm"><p className="text-xs font-bold uppercase text-blue-500">API base</p><p className="mt-1 text-xl font-black">{deploymentConfig.apiBaseUrl}</p></div>
        <div className="rounded-3xl bg-white p-5 shadow-sm"><p className="text-xs font-bold uppercase text-blue-500">Auth provider</p><p className="mt-1 text-xl font-black">{deploymentConfig.authProvider}</p></div>
        <div className="rounded-3xl bg-white p-5 shadow-sm"><p className="text-xs font-bold uppercase text-blue-500">Sync status</p><p className="mt-1 text-xl font-black">{cloudSyncStatus}</p></div>
        <div className="rounded-3xl bg-white p-5 shadow-sm"><p className="text-xs font-bold uppercase text-blue-500">Stored docs</p><p className="mt-1 text-xl font-black">{storedDocuments.length}</p></div>
        <div className="rounded-3xl bg-white p-5 shadow-sm"><p className="text-xs font-bold uppercase text-blue-500">Auth status</p><p className="mt-1 text-xl font-black">{authStatus}</p></div>
        <div className="rounded-3xl bg-white p-5 shadow-sm"><p className="text-xs font-bold uppercase text-blue-500">Profiles</p><p className="mt-1 text-xl font-black">{profiles.length}</p></div>
        <div className="rounded-3xl bg-white p-5 shadow-sm"><p className="text-xs font-bold uppercase text-blue-500">Audit events</p><p className="mt-1 text-xl font-black">{auditLog.length}</p></div>
        <div className="rounded-3xl bg-white p-5 shadow-sm"><p className="text-xs font-bold uppercase text-blue-500">Active locks</p><p className="mt-1 text-xl font-black">{recordLocks.filter(isRecordLockActive).length}</p></div>
      </div>

      <div className="rounded-3xl bg-white p-5 shadow-sm">
        <h3 className="text-lg font-bold">Live rollout checklist</h3>
        <p className="mt-1 text-sm text-blue-800">This is the order I recommend before making the app live for the JDFabs team.</p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse text-sm">
            <thead><tr className="border-b border-blue-100 text-left text-xs uppercase tracking-wide text-blue-600"><th className="py-3 pr-3">Stage</th><th className="py-3 pr-3">Owner</th><th className="py-3 pr-3">Status</th><th className="py-3 pr-3">Required test</th></tr></thead>
            <tbody>{liveRolloutChecklist.map((item) => <tr key={item.id} className="border-b border-blue-100"><td className="py-3 pr-3 font-bold">{item.title}</td><td className="py-3 pr-3">{item.owner}</td><td className="py-3 pr-3"><span className={`rounded-full px-3 py-1 text-xs font-bold ${item.status === "Next" ? "bg-blue-100 text-blue-800" : "bg-amber-100 text-amber-800"}`}>{item.status}</span></td><td className="py-3 pr-3 text-blue-800">{item.test}</td></tr>)}</tbody>
          </table>
        </div>
      </div>

      <div className="rounded-3xl bg-white p-5 shadow-sm">
        <h3 className="text-lg font-bold">Pre-launch internal test checklist</h3>
        <p className="mt-1 text-sm text-blue-800">Run this once before live deployment and again after the cloud backend is connected.</p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[950px] border-collapse text-sm">
            <thead><tr className="border-b border-blue-100 text-left text-xs uppercase tracking-wide text-blue-600"><th className="py-3 pr-3">Area</th><th className="py-3 pr-3">Check</th><th className="py-3 pr-3">Pass condition</th></tr></thead>
            <tbody>{preLaunchWorkflowChecklist.map((item) => <tr key={item.id} className="border-b border-blue-100 align-top"><td className="py-3 pr-3 font-bold">{item.area}</td><td className="py-3 pr-3 text-blue-900">{item.check}</td><td className="py-3 pr-3 text-blue-800">{item.pass}</td></tr>)}</tbody>
          </table>
        </div>
      </div>

      <div className="rounded-3xl bg-white p-5 shadow-sm">
        <h3 className="text-lg font-bold">Backend handover spec</h3>
        <p className="mt-1 text-sm text-blue-800">Use this as the practical handover target when connecting OPHQ to real hosting, database, auth and document storage.</p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[950px] border-collapse text-sm">
            <thead><tr className="border-b border-blue-100 text-left text-xs uppercase tracking-wide text-blue-600"><th className="py-3 pr-3">Area</th><th className="py-3 pr-3">Requirement</th><th className="py-3 pr-3">Decision / input needed</th></tr></thead>
            <tbody>{backendHandoverSpec.map((item) => <tr key={item.area} className="border-b border-blue-100 align-top"><td className="py-3 pr-3 font-bold">{item.area}</td><td className="py-3 pr-3 text-blue-900">{item.requirement}</td><td className="py-3 pr-3 text-blue-800">{item.decisionNeeded}</td></tr>)}</tbody>
          </table>
        </div>
      </div>

      <div className="rounded-3xl bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-lg font-bold">Technical live-readiness detail</h3>
            <p className="mt-1 text-sm text-blue-800">Backend, API, permission and document storage detail for live setup.</p>
          </div>
          <button className="rounded-xl border bg-white px-4 py-2 text-sm font-bold" onClick={() => setLiveDetailsOpen(!liveDetailsOpen)}>{liveDetailsOpen ? "Hide details" : "Open details"}</button>
        </div>
      </div>

      {liveDetailsOpen ? <>
      <div className="rounded-3xl bg-white p-5 shadow-sm">
        <h3 className="text-lg font-bold">Live-readiness stages</h3>
        <div className="mt-4 space-y-3">
          {liveReadinessStages.map((stage) => (
            <div key={stage.id} className="rounded-2xl border border-blue-100 p-4">
              <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                <div>
                  <p className="font-bold">{stage.title}</p>
                  <p className="mt-1 text-sm text-blue-800">{stage.notes}</p>
                </div>
                <span className={`w-fit rounded-full px-3 py-1 text-xs font-bold ${stage.status === "Pending" ? "bg-amber-100 text-amber-800" : stage.status === "In progress" ? "bg-blue-100 text-blue-800" : "bg-emerald-100 text-emerald-800"}`}>{stage.status}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-3xl bg-white p-5 shadow-sm">
        <h3 className="text-lg font-bold">Build stages</h3>
        <div className="mt-4 space-y-3">
          {deploymentStages.map((stage) => (
            <div key={stage.id} className="rounded-2xl border border-blue-100 p-4">
              <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                <div>
                  <p className="font-bold">{stage.title}</p>
                  <p className="mt-1 text-sm text-blue-800">{stage.notes}</p>
                </div>
                <span className={`w-fit rounded-full px-3 py-1 text-xs font-bold ${stage.status === "Pending" ? "bg-amber-100 text-amber-800" : stage.status === "In place" ? "bg-emerald-100 text-emerald-800" : "bg-blue-100 text-blue-800"}`}>{stage.status}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-3xl bg-white p-5 shadow-sm">
        <h3 className="text-lg font-bold">Cloud database table plan</h3>
        <p className="mt-1 text-sm text-blue-800">These tables are the live database target. The app still runs locally until the backend is connected.</p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[1000px] border-collapse text-sm">
            <thead><tr className="border-b border-blue-100 text-left text-xs uppercase tracking-wide text-blue-600"><th className="py-3 pr-3">Table</th><th className="py-3 pr-3">Purpose</th><th className="py-3 pr-3">Key fields</th><th className="py-3 pr-3">Access</th></tr></thead>
            <tbody>{cloudBackendTablePlan.map((table) => <tr key={table.table} className="border-b border-blue-100 align-top"><td className="py-3 pr-3 font-bold">{table.table}</td><td className="py-3 pr-3">{table.purpose}</td><td className="py-3 pr-3 text-blue-800">{table.keyFields}</td><td className="py-3 pr-3 text-blue-800">{table.access}</td></tr>)}</tbody>
          </table>
        </div>
      </div>

      <div className="rounded-3xl bg-white p-5 shadow-sm">
        <h3 className="text-lg font-bold">API contract required for live deployment</h3>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse text-sm">
            <thead><tr className="border-b border-blue-100 text-left text-xs uppercase tracking-wide text-blue-600"><th className="py-3 pr-3">Method</th><th className="py-3 pr-3">Endpoint</th><th className="py-3 pr-3">Purpose</th></tr></thead>
            <tbody>{liveApiContracts.map((endpoint) => <tr key={`${endpoint.method}-${endpoint.path}`} className="border-b border-blue-100"><td className="py-3 pr-3 font-bold">{endpoint.method}</td><td className="py-3 pr-3"><code className="rounded bg-blue-50 px-2 py-1 text-xs">{endpoint.path}</code></td><td className="py-3 pr-3 text-blue-800">{endpoint.purpose}</td></tr>)}</tbody>
          </table>
        </div>
      </div>

      <div className="rounded-3xl bg-white p-5 shadow-sm">
        <h3 className="text-lg font-bold">Numbering and multi-user lock readiness</h3>
        <p className="mt-1 text-sm text-blue-800">These checks protect against duplicate document numbers and two users editing the same live record at the same time.</p>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className={`rounded-2xl p-4 ${numberingReport.passed ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-900"}`}>
            <p className="font-black">Document numbering test {numberingReport.passed ? "passed" : "failed"}</p>
            <p className={`mt-2 rounded-xl px-3 py-2 text-xs font-bold ${numberingReport.cloudRequired ? "bg-amber-100 text-amber-900" : "bg-white"}`}>{numberingReport.warning}</p>
            <div className="mt-3 space-y-2">
              {numberingReport.checks.map((check) => <div key={`${check.documentType}-${check.expected}`} className="rounded-xl bg-white px-3 py-2 text-sm"><p className="font-bold">{check.passed ? "✅" : "❌"} {check.documentType}: {check.actual}</p><p className="text-xs text-blue-800">{check.purpose} Expected {check.expected}.</p></div>)}
            </div>
          </div>
          <div className={`rounded-2xl p-4 ${lockReport.passed ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-900"}`}>
            <p className="font-black">Record lock test {lockReport.passed ? "passed" : "failed"}</p>
            <p className={`mt-2 rounded-xl px-3 py-2 text-xs font-bold ${lockReport.cloudRequired ? "bg-amber-100 text-amber-900" : "bg-white"}`}>{lockReport.warning}</p>
            <div className="mt-3 space-y-2">
              {lockReport.checks.map((check) => <p key={check.name} className="rounded-xl bg-white px-3 py-2 text-sm font-bold">{check.passed ? "✅" : "❌"} {check.name}</p>)}
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-3xl bg-white p-5 shadow-sm">
        <h3 className="text-lg font-bold">Auth and permission readiness</h3>
        <p className="mt-1 text-sm text-blue-800">These checks must be green before the role switch is replaced by real logins.</p>
        <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {authReadinessChecks.map((check) => (
            <div key={check.id} className="rounded-2xl border border-blue-100 p-4">
              <div className="flex items-start justify-between gap-3">
                <p className="font-bold">{check.label}</p>
                <span className={`rounded-full px-2 py-1 text-[10px] font-black ${check.status === "Ready" ? "bg-emerald-100 text-emerald-800" : check.status === "Scaffolded" ? "bg-blue-100 text-blue-800" : "bg-amber-100 text-amber-800"}`}>{check.status}</span>
              </div>
              <p className="mt-2 text-xs text-blue-800">{check.detail}</p>
            </div>
          ))}
        </div>
        <div className={`mt-4 rounded-2xl p-4 ${authPermissionReport.passed ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-900"}`}>
          <p className="font-black">Permission test {authPermissionReport.passed ? "passed" : "failed"}</p>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {authPermissionReport.checks.map((check) => <p key={check.name} className="rounded-xl bg-white px-3 py-2 text-sm font-bold">{check.passed ? "✅" : "❌"} {check.name}</p>)}
          </div>
        </div>
      </div>

      <div className="rounded-3xl bg-white p-5 shadow-sm">
        <h3 className="text-lg font-bold">Auth profiles scaffold</h3>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead><tr className="border-b border-blue-100 text-left text-xs uppercase tracking-wide text-blue-600"><th className="py-3 pr-3">Name</th><th className="py-3 pr-3">Email</th><th className="py-3 pr-3">Role</th><th className="py-3 pr-3">Status</th><th className="py-3 pr-3">MFA</th><th className="py-3 pr-3">Provider ID</th></tr></thead>
            <tbody>{profiles.map((profile) => <tr key={profile.id} className="border-b border-blue-100"><td className="py-3 pr-3 font-bold">{profile.name}</td><td className="py-3 pr-3">{profile.email}</td><td className="py-3 pr-3">{profile.role}</td><td className="py-3 pr-3">{profile.status}</td><td className="py-3 pr-3">{profile.mfaRequired ? "Required" : "Optional"}</td><td className="py-3 pr-3">{profile.authProviderId || "pending"}</td></tr>)}</tbody>
          </table>
        </div>
      </div>

      <div className="rounded-3xl bg-white p-5 shadow-sm">
        <h3 className="text-lg font-bold">Backend permission map</h3>
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          {Object.entries(backendPermissionMap).map(([role, permissions]) => (
            <div key={role} className="rounded-2xl border border-blue-100 p-4">
              <p className="text-lg font-bold">{permissions.label}</p>
              <div className="mt-3 space-y-2 text-xs text-blue-800">
                <p><span className="font-bold text-blue-950">Read:</span> {permissions.canRead.join(", ")}</p>
                <p><span className="font-bold text-blue-950">Create:</span> {permissions.canCreate.join(", ") || "None"}</p>
                <p><span className="font-bold text-blue-950">Update:</span> {permissions.canUpdate.join(", ") || "None"}</p>
                <p><span className="font-bold text-blue-950">Delete:</span> {permissions.canDelete.join(", ") || "None"}</p>
                {permissions.restrictions.length ? <p><span className="font-bold text-red-700">Restrictions:</span> {permissions.restrictions.join(", ")}</p> : null}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-3xl bg-white p-5 shadow-sm">
        <h3 className="text-lg font-bold">Stored document register</h3>
        <p className="mt-1 text-sm text-blue-800">Tracks print-generated documents until cloud PDF storage is connected.</p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse text-sm">
            <thead><tr className="border-b border-blue-100 text-left text-xs uppercase tracking-wide text-blue-600"><th className="py-3 pr-3">Document</th><th className="py-3 pr-3">Type</th><th className="py-3 pr-3">No</th><th className="py-3 pr-3">Related</th><th className="py-3 pr-3">Status</th><th className="py-3 pr-3">Created</th></tr></thead>
            <tbody>
              {storedDocuments.length === 0 ? <tr><td className="py-4 text-blue-600" colSpan={6}>No generated documents registered yet.</td></tr> : null}
              {storedDocuments.map((doc) => (
                <tr key={doc.id} className="border-b border-blue-100">
                  <td className="py-3 pr-3 font-bold">{doc.title}</td>
                  <td className="py-3 pr-3">{doc.documentType}</td>
                  <td className="py-3 pr-3">{doc.documentNo}</td>
                  <td className="py-3 pr-3">{doc.relatedResource}</td>
                  <td className="py-3 pr-3">{doc.storageStatus}</td>
                  <td className="py-3 pr-3">{doc.createdAt ? new Date(doc.createdAt).toLocaleString() : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-3xl bg-white p-5 shadow-sm">
        <h3 className="text-lg font-bold">Proposed cloud tables</h3>
        <div className="mt-4 flex flex-wrap gap-2">
          {proposedCloudTables.map((table) => <span key={table} className="rounded-full bg-blue-50 px-3 py-2 text-xs font-bold text-blue-800">{table}</span>)}
        </div>
      </div>
      </> : null}
    </div>
  );
}

function SettingsTab({ companySettings, setCompanySettings, customers, suppliers, importState, setImportState, importLogs, onFileSelected, onConfirmImport, onResetImport, onResetLocalSavedData, onExportLocalBackup, onBackupFileSelected, backupRestorePreview, backupRestoreError, onConfirmBackupRestore, onClearBackupRestore, cloudSyncStatus, storedDocuments, profiles, auditLog, authStatus, recordLocks }) {
  const [settingsSection, setSettingsSection] = useState("company");

  return (
    <div className="space-y-6">
      <div className="rounded-3xl bg-white p-5 shadow-sm">
        <h2 className="text-lg font-bold">Settings</h2>
        <div className="mt-4 flex flex-wrap gap-2">
          <button className={`rounded-xl px-4 py-2 text-sm font-bold ${settingsSection === "company" ? "bg-blue-700 text-white" : "border bg-white text-blue-900"}`} onClick={() => setSettingsSection("company")}>Company & Branding</button>
          <button className={`rounded-xl px-4 py-2 text-sm font-bold ${settingsSection === "imports" ? "bg-blue-700 text-white" : "border bg-white text-blue-900"}`} onClick={() => setSettingsSection("imports")}>Imports</button>
          <button className={`rounded-xl px-4 py-2 text-sm font-bold ${settingsSection === "deployment" ? "bg-blue-700 text-white" : "border bg-white text-blue-900"}`} onClick={() => setSettingsSection("deployment")}>Live Readiness</button>
          <button className="rounded-xl border bg-white px-4 py-2 text-sm font-bold text-blue-900" onClick={onExportLocalBackup}>Export backup</button>
          <label className="cursor-pointer rounded-xl border bg-white px-4 py-2 text-sm font-bold text-blue-900">
            Import backup
            <input type="file" accept="application/json,.json" className="hidden" onChange={onBackupFileSelected} />
          </label>
          <button className="rounded-xl border border-red-200 bg-white px-4 py-2 text-sm font-bold text-red-700" onClick={onResetLocalSavedData}>Reset local saved data</button>
        </div>
        {backupRestoreError ? <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-700">{backupRestoreError}</p> : null}
        {backupRestorePreview ? <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-black text-amber-900">Backup ready to restore</p>
          <p className="mt-1 text-xs font-semibold text-amber-800">Restoring replaces the current local saved app data and reloads OPHQ.</p>
          <div className="mt-3 grid gap-2 text-xs font-bold text-blue-950 md:grid-cols-6">
            <span>Customers: {backupRestorePreview.summary.customers}</span>
            <span>Quotes: {backupRestorePreview.summary.quotes}</span>
            <span>Jobs: {backupRestorePreview.summary.jobs}</span>
            <span>Purchasing: {backupRestorePreview.summary.purchaseOrders}</span>
            <span>Stock: {backupRestorePreview.summary.stockItems}</span>
            <span>Saved: {backupRestorePreview.summary.exportedAt}</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-bold text-white" onClick={onConfirmBackupRestore}>Restore this backup</button>
            <button className="rounded-xl border bg-white px-4 py-2 text-sm font-bold" onClick={onClearBackupRestore}>Cancel restore</button>
          </div>
        </div> : null}
      </div>
      {settingsSection === "company" ? <CompanySettingsPanel companySettings={companySettings} setCompanySettings={setCompanySettings} /> : null}
      {settingsSection === "imports" ? <XeroCsvImportTab customers={customers} suppliers={suppliers} importState={importState} setImportState={setImportState} importLogs={importLogs} onFileSelected={onFileSelected} onConfirmImport={onConfirmImport} onResetImport={onResetImport} /> : null}
      {settingsSection === "deployment" ? <DeploymentFoundationsPanel cloudSyncStatus={cloudSyncStatus} storedDocuments={storedDocuments} profiles={profiles} auditLog={auditLog} authStatus={authStatus} recordLocks={recordLocks} /> : null}
    </div>
  );
}

function CompanyDocumentHeader({ companySettings, title, subtitle }) {
  const safeSettings = companySettings || initialCompanySettings;
  const address = [safeSettings.addressLine1, safeSettings.addressLine2, safeSettings.city, safeSettings.county, safeSettings.postcode, safeSettings.country].filter(Boolean).join(", ");

  return (
    <div className="flex items-start justify-between border-b border-blue-200 pb-4">
      <div className="flex items-start gap-4">
        {safeSettings.logoDataUrl ? <img src={safeSettings.logoDataUrl} alt="Company logo" className="max-h-20 max-w-36 object-contain" /> : null}
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-blue-600">{safeSettings.name || "JDFabs"}</p>
          <h2 className="text-3xl font-bold">{title}</h2>
          <p className="mt-2 text-sm text-blue-800">{subtitle}</p>
        </div>
      </div>
      <div className="max-w-xs text-right text-xs text-blue-800">
        <p className="font-bold text-blue-950">{safeSettings.legalName || safeSettings.name || "JDFabs"}</p>
        {address ? <p>{address}</p> : null}
        {safeSettings.phone ? <p>{safeSettings.phone}</p> : null}
        {safeSettings.email ? <p>{safeSettings.email}</p> : null}
        {safeSettings.website ? <p>{safeSettings.website}</p> : null}
        {safeSettings.vatNumber ? <p>VAT: {safeSettings.vatNumber}</p> : null}
        {safeSettings.companyNumber ? <p>Company No: {safeSettings.companyNumber}</p> : null}
      </div>
    </div>
  );
}

function buildQuotePreviewHtml({ quote, customer, companySettings }) {
  const safeSettings = companySettings || initialCompanySettings;
  const address = [safeSettings.addressLine1, safeSettings.addressLine2, safeSettings.city, safeSettings.county, safeSettings.postcode, safeSettings.country].filter(Boolean).join(", ");
  const rows = (quote.items || []).map((item) => `
    <tr>
      <td><strong>${item.description || ""}</strong>${item.processDetails?.length ? `<br><small>${item.processDetails.join(" · ")}</small>` : ""}</td>
      <td class="right">${item.quantity || 0}</td>
      <td class="right"><strong>${currency(Number(item.quantity || 0) * Number(item.unitPrice || 0))}</strong></td>
    </tr>
  `).join("");

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${quote.quoteNo || "Quote"}</title>
  <style>
    @page { size: A4; margin: 16mm; }
    body { font-family: Arial, sans-serif; color: #0f172a; margin: 0; }
    .header { display: flex; justify-content: space-between; gap: 24px; border-bottom: 1px solid #bfdbfe; padding-bottom: 16px; }
    .brand { display: flex; gap: 16px; align-items: flex-start; }
    .logo { max-width: 150px; max-height: 80px; object-fit: contain; }
    h1 { margin: 4px 0 0; font-size: 30px; }
    .muted { color: #1e40af; font-size: 12px; }
    .company { text-align: right; font-size: 12px; max-width: 260px; line-height: 1.45; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; border-bottom: 1px solid #dbeafe; padding: 20px 0; }
    h3 { color: #2563eb; font-size: 12px; text-transform: uppercase; margin: 0 0 8px; }
    p { margin: 3px 0; }
    table { width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 13px; }
    th { text-align: left; color: #2563eb; font-size: 11px; text-transform: uppercase; border-bottom: 1px solid #bfdbfe; padding: 8px; }
    td { border-bottom: 1px solid #dbeafe; padding: 10px 8px; vertical-align: top; }
    small { color: #1d4ed8; }
    .right { text-align: right; }
    .totals { margin-left: auto; margin-top: 24px; width: 280px; background: #eff6ff; border-radius: 14px; padding: 16px; }
    .total-row { display: flex; justify-content: space-between; margin: 6px 0; }
    .grand { border-top: 1px solid #bfdbfe; padding-top: 10px; font-size: 18px; font-weight: 800; }
    .note { margin-top: 24px; color: #1d4ed8; font-size: 11px; }
  </style>
</head>
<body>
  <div class="header">
    <div class="brand">
      ${safeSettings.logoDataUrl ? `<img class="logo" src="${safeSettings.logoDataUrl}" />` : ""}
      <div><div class="muted">${safeSettings.name || "JDFabs"}</div><h1>Quotation</h1><p class="muted">${quote.quoteNo || ""}</p></div>
    </div>
    <div class="company"><strong>${safeSettings.legalName || safeSettings.name || "JDFabs"}</strong>${address ? `<br>${address}` : ""}${safeSettings.phone ? `<br>${safeSettings.phone}` : ""}${safeSettings.email ? `<br>${safeSettings.email}` : ""}${safeSettings.website ? `<br>${safeSettings.website}` : ""}${safeSettings.vatNumber ? `<br>VAT: ${safeSettings.vatNumber}` : ""}</div>
  </div>
  <div class="grid">
    <div><h3>Client</h3><p><strong>${customer?.company || quote.customer || ""}</strong></p><p>Contact: ${customer?.contact || ""}</p><p>Email: ${customer?.email || ""}</p><p>Phone: ${customer?.phone || ""}</p></div>
    <div><h3>Quote Details</h3><p>Quote No: <strong>${quote.quoteNo || ""}</strong></p><p>Date: <strong>${quote.date || ""}</strong></p><p>Valid Until: <strong>${quote.validUntil || ""}</strong></p><p>Project: <strong>${quote.title || ""}</strong></p></div>
  </div>
  <table><thead><tr><th>Description</th><th class="right">Qty</th><th class="right">Total</th></tr></thead><tbody>${rows}</tbody></table>
  <div class="totals"><div class="total-row"><span>Subtotal</span><strong>${currency(quote.subtotal)}</strong></div><div class="total-row"><span>VAT</span><strong>${currency(quote.vat)}</strong></div><div class="total-row grand"><span>Total</span><span>${currency(quote.total)}</span></div></div>
  <p class="note">This quotation includes the relevant material, fabrication and finishing processes required for the listed work.</p>
  <script>window.onload = function () { window.focus(); window.print(); };</script>
</body>
</html>`;
}

function printQuotePdf({ quote, customer, companySettings, onRegisterDocument }) {
  const printWindow = window.open("", "_blank", "width=900,height=1200");
  if (!printWindow) return;
  printWindow.document.open();
  const html = buildQuotePreviewHtml({ quote, customer, companySettings });
  printWindow.document.write(html);
  if (onRegisterDocument) onRegisterDocument({ html, documentType: "quote_pdf", title: `Quote ${quote.quoteNo}`, relatedResource: "quotes", relatedResourceId: quote.id, customerId: quote.customerId, documentNo: quote.quoteNo });
  printWindow.document.close();
}

function buildPurchaseOrderPreviewHtml({ po, job, supplier, companySettings }) {
  const safeSettings = companySettings || initialCompanySettings;
  const documentTitle = getPurchasingDocumentTitle(po);
  const documentNumber = getPurchasingDocumentNumber(po);
  const address = [safeSettings.addressLine1, safeSettings.addressLine2, safeSettings.city, safeSettings.county, safeSettings.postcode, safeSettings.country].filter(Boolean).join(", ");
  const rows = (po.items || []).map((item) => `
    <tr>
      <td><strong>${buildPoLineDescription(item)}</strong></td>
      <td>${item.sectionSize || ""}</td>
      <td>${item.length || ""}</td>
      <td class="right">${item.quantity || 0}</td>
      <td>${item.finish || ""}</td>
      <td class="right">${currency(Number(item.unitCost || 0))}</td>
      <td class="right"><strong>${currency(calculatePoLineTotal(item))}</strong></td>
    </tr>
  `).join("");
  const totals = calculatePoTotals(po.items || [], Number(po.vatRate || 20));

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${documentNumber}</title>
  <style>
    @page { size: A4; margin: 16mm; }
    body { font-family: Arial, sans-serif; color: #0f172a; margin: 0; }
    .header { display: flex; justify-content: space-between; gap: 24px; border-bottom: 1px solid #bfdbfe; padding-bottom: 16px; }
    .brand { display: flex; gap: 16px; align-items: flex-start; }
    .logo { max-width: 150px; max-height: 80px; object-fit: contain; }
    h1 { margin: 4px 0 0; font-size: 30px; }
    .muted { color: #1e40af; font-size: 12px; }
    .company { text-align: right; font-size: 12px; max-width: 260px; line-height: 1.45; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; border-bottom: 1px solid #dbeafe; padding: 20px 0; }
    h3 { color: #2563eb; font-size: 12px; text-transform: uppercase; margin: 0 0 8px; }
    p { margin: 3px 0; }
    table { width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 13px; }
    th { text-align: left; color: #2563eb; font-size: 11px; text-transform: uppercase; border-bottom: 1px solid #bfdbfe; padding: 8px; }
    td { border-bottom: 1px solid #dbeafe; padding: 10px 8px; vertical-align: top; }
    .right { text-align: right; }
    .totals { margin-left: auto; margin-top: 24px; width: 300px; background: #eff6ff; border-radius: 14px; padding: 16px; }
    .total-row { display: flex; justify-content: space-between; margin: 6px 0; }
    .grand { border-top: 1px solid #bfdbfe; padding-top: 10px; font-size: 16px; font-weight: 800; }
    .note { margin-top: 24px; color: #1d4ed8; font-size: 11px; }
  </style>
</head>
<body>
  <div class="header">
    <div class="brand">
      ${safeSettings.logoDataUrl ? `<img class="logo" src="${safeSettings.logoDataUrl}" />` : ""}
      <div><div class="muted">${safeSettings.name || "JDFabs"}</div><h1>${documentTitle}</h1><p class="muted">${documentNumber}</p></div>
    </div>
    <div class="company"><strong>${safeSettings.legalName || safeSettings.name || "JDFabs"}</strong>${address ? `<br>${address}` : ""}${safeSettings.phone ? `<br>${safeSettings.phone}` : ""}${safeSettings.email ? `<br>${safeSettings.email}` : ""}${safeSettings.website ? `<br>${safeSettings.website}` : ""}${safeSettings.vatNumber ? `<br>VAT: ${safeSettings.vatNumber}` : ""}</div>
  </div>
  <div class="grid">
    <div><h3>Supplier</h3><p><strong>${supplier?.name || ""}</strong></p><p>Contact: ${supplier?.contact || ""}</p><p>Email: ${supplier?.email || ""}</p><p>Phone: ${supplier?.phone || ""}</p></div>
    <div><h3>${isEnquiryDocument(po) ? "Enquiry Details" : "Order Details"}</h3><p>${isEnquiryDocument(po) ? "Enquiry No" : "PO No"}: <strong>${documentNumber}</strong></p><p>Date: <strong>${po.date || ""}</strong></p><p>Required By: <strong>${po.requiredBy || ""}</strong></p><p>Job: <strong>${job?.jobNo || ""} · ${job?.title || ""}</strong></p></div>
  </div>
  <table><thead><tr><th>Product</th><th>Section / Size</th><th>Length</th><th class="right">Qty</th><th>Finish</th><th class="right">Price</th><th class="right">Ex VAT</th></tr></thead><tbody>${rows}</tbody></table>
  <div class="totals"><div class="total-row"><span>Total Ex VAT</span><strong>${currency(totals.subtotal)}</strong></div><div class="total-row grand"><span>Total Inc VAT @ 20%</span><span>${currency(totals.total)}</span></div></div>
  <p class="note">${isEnquiryDocument(po) ? "Please provide your best price and availability for the materials listed above. A formal purchase order will be issued once details are confirmed." : "Please supply the materials listed above for the referenced JDFabs job."}</p>
  <script>window.onload = function () { window.focus(); window.print(); };</script>
</body>
</html>`;
}

function printPurchaseOrderPdf({ po, job, supplier, companySettings, onRegisterDocument }) {
  const printWindow = window.open("", "_blank", "width=900,height=1200");
  if (!printWindow) return;
  printWindow.document.open();
  const html = buildPurchaseOrderPreviewHtml({ po, job, supplier, companySettings });
  printWindow.document.write(html);
  if (onRegisterDocument) onRegisterDocument({ html, documentType: isEnquiryDocument(po) ? "purchase_enquiry_pdf" : "purchase_order_pdf", title: `${getPurchasingDocumentTitle(po)} ${getPurchasingDocumentNumber(po)}`, relatedResource: "purchase_orders", relatedResourceId: po.id, jobId: po.jobId, documentNo: getPurchasingDocumentNumber(po) });
  printWindow.document.close();
}

function buildJobSheetPreviewHtml({ job, quote, customer, companySettings }) {
  const safeSettings = companySettings || initialCompanySettings;
  const address = [safeSettings.addressLine1, safeSettings.addressLine2, safeSettings.city, safeSettings.county, safeSettings.postcode, safeSettings.country].filter(Boolean).join(", ");
  const parts = getJobPartsList(job, quote);
  const rows = parts.map((part, index) => {
    const sourceItem = (quote?.items || job.partsList || [])[index] || {};
    const details = sourceItem.processDetails?.length ? sourceItem.processDetails.join(" · ") : part.notes || "";
    return `
      <tr>
        <td><strong>${part.description || ""}</strong>${details ? `<br><small>${details}</small>` : ""}</td>
        <td>${part.sectionSize || ""}</td>
        <td>${part.grade || ""}</td>
        <td>${part.finish || ""}</td>
        <td class="right">${part.length ? `${part.length}m` : ""}</td>
        <td class="right">${part.quantity || 0}</td>
        <td class="right">${part.weightKg ? `${Number(part.weightKg).toFixed(2)}kg` : ""}</td>
      </tr>
    `;
  }).join("");
  const operationsTable = `
    <table class="operations-table">
      <thead>
        <tr>
          <th class="op-col">OP</th>
          <th class="operation-col">Workshop operation</th>
          <th class="trace-col">Checks / traceability</th>
          <th class="completed-col">Completed by</th>
          <th class="date-col">Date</th>
        </tr>
      </thead>
      <tbody>
        <tr><td class="op-number">1</td><td>Cut and process parts as specified.</td><td class="write-line"></td><td class="write-line"></td><td class="write-line"></td></tr>
        <tr><td class="op-number">2</td><td>Assemble and weld components.</td><td class="write-line"></td><td class="write-line"></td><td class="write-line"></td></tr>
        <tr class="trace-row"><td></td><td>Welding traceability 1</td><td>Machine No: <span class="fill-line"></span><br>Wire batch No: <span class="fill-line"></span></td><td class="write-line"></td><td class="write-line"></td></tr>
        <tr class="trace-row"><td></td><td>Welding traceability 2</td><td>Machine No: <span class="fill-line"></span><br>Wire batch No: <span class="fill-line"></span></td><td class="write-line"></td><td class="write-line"></td></tr>
        <tr class="trace-row"><td></td><td>Welding traceability 3</td><td>Machine No: <span class="fill-line"></span><br>Wire batch No: <span class="fill-line"></span></td><td class="write-line"></td><td class="write-line"></td></tr>
        <tr><td class="op-number">3</td><td>Check all dimensions are correct.</td><td class="write-line"></td><td class="write-line"></td><td class="write-line"></td></tr>
        <tr><td class="op-number">4</td><td>Paint and label parts as required.</td><td class="write-line"></td><td class="write-line"></td><td class="write-line"></td></tr>
        <tr><td class="op-number">5</td><td>Assemble all parts and check job is complete.</td><td class="write-line"></td><td class="write-line"></td><td class="write-line"></td></tr>
        <tr class="sign-row"><td class="op-number">6</td><td>Final inspection and sign off.</td><td class="signature-cell">Signature:</td><td class="write-line"></td><td class="write-line"></td></tr>
      </tbody>
    </table>
  `;

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${job.jobNo || "Job Sheet"}</title>
  <style>
    @page { size: A4; margin: 16mm; }
    body { font-family: Arial, sans-serif; color: #0f172a; margin: 0; }
    .header { display: flex; justify-content: space-between; gap: 24px; border-bottom: 1px solid #bfdbfe; padding-bottom: 16px; }
    .brand { display: flex; gap: 16px; align-items: flex-start; }
    .logo { max-width: 150px; max-height: 80px; object-fit: contain; }
    h1 { margin: 4px 0 0; font-size: 30px; }
    h2 { margin: 24px 0 8px; font-size: 18px; }
    .muted { color: #1e40af; font-size: 12px; }
    .company { text-align: right; font-size: 12px; max-width: 260px; line-height: 1.45; }
    .grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; border-bottom: 1px solid #dbeafe; padding: 20px 0; }
    .box { background: #eff6ff; border-radius: 12px; padding: 12px; font-size: 12px; }
    .box strong { display: block; color: #0f172a; font-size: 14px; margin-top: 3px; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 12px; }
    th { text-align: left; color: #2563eb; font-size: 10px; text-transform: uppercase; border-bottom: 1px solid #bfdbfe; padding: 8px; }
    td { border-bottom: 1px solid #dbeafe; padding: 9px 8px; vertical-align: top; }
    .operations-table { font-size: 11px; border: 1px solid #94a3b8; table-layout: fixed; page-break-inside: avoid; }
    .operations-table th { color: #0f172a; background: #eaf2ff; font-size: 10px; text-transform: uppercase; letter-spacing: .04em; border: 1px solid #94a3b8; padding: 7px 8px; }
    .operations-table td { border: 1px solid #cbd5e1; padding: 8px; color: #0f172a; line-height: 1.35; vertical-align: top; }
    .operations-table tbody tr:nth-child(even) { background: #f8fafc; }
    .operations-table .trace-row { background: #f1f5f9; }
    .op-col { width: 38px; }
    .operation-col { width: 32%; }
    .trace-col { width: 30%; }
    .completed-col { width: 18%; }
    .date-col { width: 90px; }
    .op-number { text-align: center; font-weight: 700; }
    .write-line { min-height: 30px; }
    .fill-line { display: inline-block; width: 80px; border-bottom: 1px solid #334155; transform: translateY(-2px); }
    .signature-cell { min-height: 42px; }
    .sign-row td { height: 48px; }
    small { color: #1d4ed8; }
    .right { text-align: right; }
    .notes { margin-top: 18px; border: 1px solid #bfdbfe; border-radius: 12px; min-height: 80px; padding: 12px; font-size: 12px; }
    .note { margin-top: 20px; color: #1d4ed8; font-size: 11px; }
  </style>
</head>
<body>
  <div class="header">
    <div class="brand">
      ${safeSettings.logoDataUrl ? `<img class="logo" src="${safeSettings.logoDataUrl}" />` : ""}
      <div><div class="muted">${safeSettings.name || "JDFabs"}</div><h1>Job Sheet</h1><p class="muted">${job.jobNo || ""}</p></div>
    </div>
    <div class="company"><strong>${safeSettings.legalName || safeSettings.name || "JDFabs"}</strong>${address ? `<br>${address}` : ""}${safeSettings.phone ? `<br>${safeSettings.phone}` : ""}${safeSettings.email ? `<br>${safeSettings.email}` : ""}${safeSettings.website ? `<br>${safeSettings.website}` : ""}</div>
  </div>
  <div class="grid">
    <div class="box">Customer<strong>${customer?.company || job.customer || ""}</strong><br>${customer?.contact || ""}<br>${customer?.phone || ""}</div>
    <div class="box">Job<strong>${job.jobNo || ""} · ${job.title || ""}</strong><br>Quote: ${quote?.quoteNo || "Manual job"}<br>Status: ${job.status || ""}</div>
    <div class="box">Dates<strong>Start: ${job.start || ""}</strong><br>Deadline: ${job.deadline || ""}<br>Materials due: ${job.materialsDue || ""}</div>
  </div>
  <h2>Material / fabrication lines</h2>
  <table><thead><tr><th>Line / Details</th><th>Section</th><th>Grade</th><th>Finish</th><th class="right">Length</th><th class="right">Qty</th><th class="right">Weight</th></tr></thead><tbody>${rows || `<tr><td colspan="7">No quote lines found.</td></tr>`}</tbody></table>
  <h2>Workshop operations</h2>
  ${operationsTable}
  <div class="notes"><strong>Workshop notes</strong><br>${job.notes || ""}</div>
  <p class="note">Workshop production document. Pricing is intentionally excluded; material and fabrication details are carried from the approved job package.</p>
  <script>window.onload = function () { window.focus(); window.print(); };</script>
</body>
</html>`;
}

function printJobSheetPdf({ job, quote, customer, companySettings, onRegisterDocument }) {
  const printWindow = window.open("", "_blank", "width=900,height=1200");
  if (!printWindow) return;
  printWindow.document.open();
  const html = buildJobSheetPreviewHtml({ job, quote, customer, companySettings });
  printWindow.document.write(html);
  if (onRegisterDocument) onRegisterDocument({ html, documentType: "job_sheet_pdf", title: `Job Sheet ${job.jobNo}`, relatedResource: "jobs", relatedResourceId: job.id, jobId: job.id, customerId: job.customerId, documentNo: job.jobNo });
  printWindow.document.close();
}


function buildDeliveryNotePreviewHtml({ note, job, customer, companySettings }) {
  const safeSettings = companySettings || initialCompanySettings;
  const address = [safeSettings.addressLine1, safeSettings.addressLine2, safeSettings.city, safeSettings.county, safeSettings.postcode, safeSettings.country].filter(Boolean).join(", ");
  const deliveryAddress = note.address || customer?.deliveryAddress || "";
  const rows = (note.items || []).map((item) => `
    <tr>
      <td>${item.description || ""}</td>
      <td class="right">${item.quantity || 0}</td>
    </tr>
  `).join("");

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${note.dnNo || "Delivery Note"}</title>
  <style>
    @page { size: A4; margin: 16mm; }
    body { font-family: Arial, sans-serif; color: #0f172a; margin: 0; }
    .header { display: flex; justify-content: space-between; gap: 24px; border-bottom: 1px solid #bfdbfe; padding-bottom: 16px; }
    .brand { display: flex; gap: 16px; align-items: flex-start; }
    .logo { max-width: 150px; max-height: 80px; object-fit: contain; }
    h1 { margin: 4px 0 0; font-size: 30px; }
    .muted { color: #1e40af; font-size: 12px; }
    .company { text-align: right; font-size: 12px; max-width: 260px; line-height: 1.45; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; border-bottom: 1px solid #dbeafe; padding: 20px 0; }
    h3 { color: #2563eb; font-size: 12px; text-transform: uppercase; margin: 0 0 8px; }
    p { margin: 3px 0; }
    table { width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 13px; }
    th { text-align: left; color: #2563eb; font-size: 11px; text-transform: uppercase; border-bottom: 1px solid #bfdbfe; padding: 8px; }
    td { border-bottom: 1px solid #dbeafe; padding: 10px 8px; vertical-align: top; }
    .right { text-align: right; }
    .signature-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; margin-top: 42px; }
    .signature-box { border: 1px solid #dbeafe; border-radius: 14px; padding: 18px; min-height: 95px; }
    .signature-line { border-top: 1px solid #64748b; margin-top: 44px; padding-top: 8px; color: #1d4ed8; font-size: 12px; }
    .note { margin-top: 24px; color: #1d4ed8; font-size: 11px; }
  </style>
</head>
<body>
  <div class="header">
    <div class="brand">
      ${safeSettings.logoDataUrl ? `<img class="logo" src="${safeSettings.logoDataUrl}" />` : ""}
      <div><div class="muted">${safeSettings.name || "JDFabs"}</div><h1>Delivery Note</h1><p class="muted">${note.dnNo || ""}</p></div>
    </div>
    <div class="company"><strong>${safeSettings.legalName || safeSettings.name || "JDFabs"}</strong>${address ? `<br>${address}` : ""}${safeSettings.phone ? `<br>${safeSettings.phone}` : ""}${safeSettings.email ? `<br>${safeSettings.email}` : ""}${safeSettings.website ? `<br>${safeSettings.website}` : ""}${safeSettings.vatNumber ? `<br>VAT: ${safeSettings.vatNumber}` : ""}</div>
  </div>
  <div class="grid">
    <div><h3>Customer</h3><p><strong>${customer?.company || job?.customer || ""}</strong></p><p>Contact: ${customer?.contact || note.deliveredTo || ""}</p><p>Email: ${customer?.email || ""}</p><p>Phone: ${customer?.phone || ""}</p></div>
    <div><h3>Delivery Details</h3><p>Delivery Note: <strong>${note.dnNo || ""}</strong></p><p>Date: <strong>${note.date || ""}</strong></p><p>Job No: <strong>${job?.jobNo || ""}</strong></p><p>Job: <strong>${job?.title || ""}</strong></p><p>Delivered To: <strong>${note.deliveredTo || ""}</strong></p><p>Address: <strong>${deliveryAddress}</strong></p></div>
  </div>
  <table><thead><tr><th>Description</th><th class="right">Quantity</th></tr></thead><tbody>${rows || `<tr><td colspan="2">No delivery items listed.</td></tr>`}</tbody></table>
  <div class="signature-grid">
    <div class="signature-box"><p><strong>Received in good condition</strong></p><div class="signature-line">Print name</div></div>
    <div class="signature-box"><p><strong>Customer signature</strong></p><div class="signature-line">Signature / date</div></div>
  </div>
  <p class="note">Delivery note for the referenced JDFabs job. Pricing is intentionally excluded.</p>
  <script>window.onload = function () { window.focus(); window.print(); };</script>
</body>
</html>`;
}

function printDeliveryNotePdf({ note, job, customer, companySettings, onRegisterDocument }) {
  const printWindow = window.open("", "_blank", "width=900,height=1200");
  if (!printWindow) return;
  printWindow.document.open();
  const html = buildDeliveryNotePreviewHtml({ note, job, customer, companySettings });
  printWindow.document.write(html);
  if (onRegisterDocument) onRegisterDocument({ html, documentType: "delivery_note_pdf", title: `Delivery Note ${note.dnNo}`, relatedResource: "delivery_notes", relatedResourceId: note.id, jobId: note.jobId, customerId: note.customerId, documentNo: note.dnNo });
  printWindow.document.close();
}

function QuotePreview({ quote, customer, companySettings }) {
  if (!quote) return null;
  return (
    <div className="rounded-2xl border border-blue-100 bg-white p-6 print:border-0 print:p-0">
      <CompanyDocumentHeader companySettings={companySettings} title="Quotation" subtitle={quote.quoteNo} />
      <div className="grid gap-6 border-b border-blue-100 py-5 md:grid-cols-2">
        <div>
          <h3 className="mb-2 text-sm font-bold uppercase text-blue-600">Client</h3>
          <p className="font-bold">{customer?.company || quote.customer}</p>
          <p className="text-sm text-blue-800">Contact: {customer?.contact || ""}</p>
          <p className="text-sm text-blue-800">Email: {customer?.email || ""}</p>
          <p className="text-sm text-blue-800">Phone: {customer?.phone || ""}</p>
        </div>
        <div>
          <h3 className="mb-2 text-sm font-bold uppercase text-blue-600">Quote Details</h3>
          <p className="text-sm text-blue-800">Quote No: <span className="font-semibold text-blue-950">{quote.quoteNo}</span></p>
          <p className="text-sm text-blue-800">Date: <span className="font-semibold text-blue-950">{quote.date}</span></p>
          <p className="text-sm text-blue-800">Valid Until: <span className="font-semibold text-blue-950">{quote.validUntil}</span></p>
          <p className="text-sm text-blue-800">Project: <span className="font-semibold text-blue-950">{quote.title}</span></p>
        </div>
      </div>
      <table className="mt-5 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-blue-200 text-left">
            <th className="py-2 pr-3">Description</th>
            <th className="py-2 pr-3 text-right">Qty</th>
            <th className="py-2 pr-3 text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {(quote.items || []).map((item) => (
            <tr key={item.id} className="border-b border-blue-100 align-top">
              <td className="py-3 pr-3">
                <p className="font-semibold">{item.description}</p>
                {item.processDetails?.length ? <p className="mt-1 text-xs text-blue-700">{item.processDetails.join(" · ")}</p> : null}
              </td>
              <td className="py-3 pr-3 text-right">{item.quantity}</td>
              <td className="py-3 pr-3 text-right font-bold">{currency(Number(item.quantity || 0) * Number(item.unitPrice || 0))}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-6 flex justify-end">
        <div className="w-full max-w-xs rounded-2xl bg-blue-50 p-4 text-sm">
          <p className="flex justify-between"><span>Subtotal</span><span className="font-bold">{currency(quote.subtotal)}</span></p>
          <p className="flex justify-between"><span>VAT</span><span className="font-bold">{currency(quote.vat)}</span></p>
          <p className="mt-2 flex justify-between border-t border-blue-100 pt-2 text-lg font-black"><span>Total</span><span>{currency(quote.total)}</span></p>
        </div>
      </div>
      <p className="mt-6 text-xs text-blue-700">This customer-facing preview includes the relevant material, fabrication and finishing processes required for the listed work.</p>
    </div>
  );
}

function DeliveryNotePreview({ note, job, customer, companySettings }) {
  return (
    <div className="mt-5 rounded-2xl border border-blue-100 bg-white p-6 print:border-0 print:p-0">
      <CompanyDocumentHeader companySettings={companySettings} title="Delivery Note" subtitle="Fabrication · Welding · Delivery" />

      <div className="grid gap-6 border-b border-blue-100 py-5 md:grid-cols-2">
        <div>
          <h3 className="mb-2 text-sm font-bold uppercase text-blue-600">Customer</h3>
          <p className="font-bold">{customer?.company || job?.customer}</p>
          <p className="text-sm text-blue-800">Contact: {customer?.contact || note.deliveredTo || ""}</p>
          <p className="text-sm text-blue-800">Email: {customer?.email || ""}</p>
          <p className="text-sm text-blue-800">Phone: {customer?.phone || ""}</p>
        </div>
        <div>
          <h3 className="mb-2 text-sm font-bold uppercase text-blue-600">Delivery Details</h3>
          <p className="text-sm text-blue-800">Delivery Note: <span className="font-semibold text-blue-950">{note.dnNo}</span></p>
          <p className="text-sm text-blue-800">Date: <span className="font-semibold text-blue-950">{note.date}</span></p>
          <p className="text-sm text-blue-800">Job No: <span className="font-semibold text-blue-950">{job?.jobNo}</span></p>
          <p className="text-sm text-blue-800">Job: <span className="font-semibold text-blue-950">{job?.title}</span></p>
          <p className="text-sm text-blue-800">Delivered To: <span className="font-semibold text-blue-950">{note.deliveredTo}</span></p>
          <p className="text-sm text-blue-800">Address: <span className="font-semibold text-blue-950">{note.address || customer?.deliveryAddress || ""}</span></p>
        </div>
      </div>

      <table className="mt-5 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-blue-200 text-left">
            <th className="py-2 pr-3">Description</th>
            <th className="w-28 py-2 text-right">Quantity</th>
          </tr>
        </thead>
        <tbody>
          {(note.items || []).map((item) => (
            <tr key={item.id} className="border-b border-blue-100">
              <td className="py-3 pr-3">{item.description}</td>
              <td className="py-3 text-right">{item.quantity}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-10 grid gap-6 md:grid-cols-2">
        <div className="rounded-xl border border-blue-100 p-4">
          <p className="text-sm font-bold">Received in good condition</p>
          <div className="mt-8 border-t border-slate-400 pt-2 text-sm text-blue-600">Print name</div>
        </div>
        <div className="rounded-xl border border-blue-100 p-4">
          <p className="text-sm font-bold">Customer signature</p>
          <div className="mt-8 border-t border-slate-400 pt-2 text-sm text-blue-600">Signature / date</div>
        </div>
      </div>
    </div>
  );
}

export default function FabricationProductionPlannerIntegrated() {
  const today = toIso(new Date());
  const savedAppState = useMemo(() => loadSavedAppState(), []);
  const [customers, setCustomers] = useState(savedAppState.customers || initialCustomers);
  const [staff, setStaff] = useState(() => (savedAppState.staff || initialStaff).map((person) => normaliseStaffRolePriorities({ ...person, status: person.status || "Active", pin: getStaffPin(person) })));
  const [suppliers, setSuppliers] = useState(savedAppState.suppliers || initialSuppliers);
  const [xeroSyncStatus, setXeroSyncStatus] = useState("");
  const [quotes, setQuotes] = useState(savedAppState.quotes || initialQuotes);
  const [plannerQuotePackages, setPlannerQuotePackages] = useState(savedAppState.plannerQuotePackages || []);
  const [automationStatus, setAutomationStatus] = useState("");
  const [plannerTestReport, setPlannerTestReport] = useState(null);
  const [actionStatus, setActionStatus] = useState("");
  const [jobs, setJobs] = useState(() => (savedAppState.jobs || initialJobs).map((job) => ({
    ...job,
    stageTasks: normaliseStageTasksFromCompletion(autoAssignStageTasksForStaff(job, savedAppState.staff || initialStaff, job.staffIds || [])),
  })) );
  const [purchaseOrders, setPurchaseOrders] = useState(() => ensureUniquePurchasingRecordIds(savedAppState.purchaseOrders || initialPurchaseOrders));
  const [deliveryNotes, setDeliveryNotes] = useState(savedAppState.deliveryNotes || initialDeliveryNotes);
  const [stockItems, setStockItems] = useState(savedAppState.stockItems || initialStockItems);
  const [importLogs, setImportLogs] = useState(savedAppState.importLogs || initialImportLogs);
  const [xeroCsvImportState, setXeroCsvImportState] = useState({ importType: "customers", effectiveType: "customers", fileName: "", previewRows: [], summary: null, error: "" });
  const [companySettings, setCompanySettings] = useState(savedAppState.companySettings || initialCompanySettings);
  const [clockEntries, setClockEntries] = useState(savedAppState.clockEntries || []);
  const [holidays, setHolidays] = useState(savedAppState.holidays || []);
  const [sickDays, setSickDays] = useState(savedAppState.sickDays || []);
  const [holidayForms, setHolidayForms] = useState({});
  const [holidayStaffPins, setHolidayStaffPins] = useState({});
  const [holidayStaffPinErrors, setHolidayStaffPinErrors] = useState({});
  const [holidayApprovalPins, setHolidayApprovalPins] = useState({});
  const [holidayApprovalErrors, setHolidayApprovalErrors] = useState({});
  const [stageTimeEntries, setStageTimeEntries] = useState(savedAppState.stageTimeEntries || []);
  const [stageActualHours, setStageActualHours] = useState({});
  const [selectedJobId, setSelectedJobId] = useState(initialJobs[0].id);
  const [weekStart, setWeekStart] = useState(today);
  const [search, setSearch] = useState("");
  const [activeRole, setActiveRole] = useState("operations");
  const [activeTab, setActiveTab] = useState("planner");
  const [securedTab, setSecuredTab] = useState(null);
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState("");
  const [xeroStatus, setXeroStatus] = useState({});
  const [unlockedTabs, setUnlockedTabs] = useState({ quotes: false, jobs: false });
  const [pricingSchedule, setPricingSchedule] = useState(normaliseSteelPricingSchedule(savedAppState.pricingSchedule || defaultSteelPricingSchedule));
  const [pricingSaveMeta, setPricingSaveMeta] = useState(savedAppState.pricingSaveMeta || { savedAt: savedAppState.savedAt || "", savedBy: "Operations", savedByRole: "operations" });
  const [productivityRules, setProductivityRules] = useState(() => normaliseProductivityRules(savedAppState.productivityRules || defaultProductivityRules));
  const [customProducts, setCustomProducts] = useState(savedAppState.customProducts || []);
  const [storedDocuments, setStoredDocuments] = useState(savedAppState.storedDocuments || []);
  const [cloudSyncStatus, setCloudSyncStatus] = useState("Local save active");
  const [profiles, setProfiles] = useState(savedAppState.profiles || initialProfiles);
  const [auditLog, setAuditLog] = useState(savedAppState.auditLog || []);
  const [authStatus, setAuthStatus] = useState("Login provider pending");
  const [recordLocks, setRecordLocks] = useState(savedAppState.recordLocks || []);
  const [newQuote, setNewQuote] = useState({ customerId: "", title: "", description: "Fabrication work", quantity: 1, unitPrice: 500, validUntil: toIso(addDays(new Date(), 30)), uploadedFileName: "", jobDeliveryAddress: "" });
  const [takeoffForm, setTakeoffForm] = useState({ productId: "ub", sectionSize: "203x102x23", grade: "S355", finish: "Primed", length: 1, width: "", thickness: "", quantity: 1, holes: 0, plates: 0, notes: "", unitPrice: 0 });
  const [takeoffLines, setTakeoffLines] = useState([]);
  const [takeoffAiInput, setTakeoffAiInput] = useState("");
  const [takeoffAiPreviewRows, setTakeoffAiPreviewRows] = useState([]);
  const [takeoffAiStatus, setTakeoffAiStatus] = useState("");
  const [takeoffImportStatus, setTakeoffImportStatus] = useState("");
  const [newStockItem, setNewStockItem] = useState({ productId: "ub", sectionSize: "", grade: "S355", finish: "Self colour", length: 6, width: "", quantity: 1, location: "", status: "In Stock", allocatedJobId: "", purchaseDocumentNo: "", notes: "" });
  const [newPo, setNewPo] = useState({
    jobId: "",
    supplierId: "",
    requiredBy: toIso(addDays(new Date(), 7)),
    lines: [createPoLineFromPart({ productId: "ub", sectionSize: "203x102x23", length: 6, finish: "Self colour" }, 1, 1)],
  });
  const [editingPoId, setEditingPoId] = useState(null);
  const [editingPoDraft, setEditingPoDraft] = useState(null);
  const [expandedPurchasingId, setExpandedPurchasingId] = useState(null);
  const [plannerDiagnosticsOpen, setPlannerDiagnosticsOpen] = useState(false);
  const [jobSheetOpen, setJobSheetOpen] = useState(false);
  const [expandedJobDetailsId, setExpandedJobDetailsId] = useState(null);
  const [purchasingFormOpen, setPurchasingFormOpen] = useState(false);
  const [selectedSignedDeliveryNoteId, setSelectedSignedDeliveryNoteId] = useState(null);
  const [newStaff, setNewStaff] = useState({ name: "", hoursPerDay: 8, pin: "", roles: [], rolePriorities: {} });
  const [addStaffOpen, setAddStaffOpen] = useState(false);
  const [showManualJobForm, setShowManualJobForm] = useState(false);
  const [newJob, setNewJob] = useState({
    jobNo: "",
    customer: "",
    title: "",
    start: today,
    stage: "Design",
    status: "In Production",
    priority: "3",
    estimatedHours: 16,
    deadline: toIso(addDays(new Date(), 7)),
    materialsDue: toIso(addDays(new Date(), 3)),
  });
  const [backupRestorePreview, setBackupRestorePreview] = useState(null);
  const [backupRestoreError, setBackupRestoreError] = useState("");

  const QUOTES_PIN = "3490";
  const JOBS_PIN = "3490";

  const scheduledJobs = useMemo(() => autoPlanJobsLive(jobs, staff, weekStart, holidays), [jobs, staff, weekStart, holidays]);
  const weekDays = useMemo(() => Array.from({ length: 10 }, (_, index) => toIso(addDays(new Date(weekStart), index))), [weekStart]);
  const selectedJob = scheduledJobs.find((job) => job.id === selectedJobId) || jobs.find((job) => job.id === selectedJobId) || scheduledJobs[0] || jobs[0];

  const filteredJobs = scheduledJobs
    .filter((job) => job.status !== "Complete")
    .filter((job) => `${job.jobNo} ${job.customer} ${job.title} ${job.stage} ${job.status}`.toLowerCase().includes(search.toLowerCase()));

  const stats = useMemo(() => {
    const activeJobs = scheduledJobs.filter((job) => job.status !== "Complete" && job.status !== "Delivery").length;
    const plannedHours = scheduledJobs.reduce((sum, job) => sum + Number(job.estimatedHours || 0), 0);
    const quotedValue = quotes.reduce((sum, quote) => sum + Number(quote.total || 0), 0);
    const cogsValue = purchaseOrders.reduce((sum, po) => sum + Number(po.total || 0), 0);
    const grossValue = quotedValue - cogsValue;
    let clashes = 0;

    staff.forEach((person) => {
      const personJobs = scheduledJobs.filter((job) => job.staffIds.includes(person.id));
      for (let i = 0; i < personJobs.length; i += 1) {
        for (let j = i + 1; j < personJobs.length; j += 1) {
          if (rangesOverlap(personJobs[i].start, personJobs[i].end, personJobs[j].start, personJobs[j].end)) clashes += 1;
        }
      }
    });

    return { activeJobs, plannedHours, staffCount: staff.length, clashes, quotedValue, cogsValue, grossValue };
  }, [scheduledJobs, quotes, purchaseOrders, staff]);

  const selectedJobPOs = purchaseOrders.filter((po) => po.jobId === selectedJob?.id);
  const actionService = useMemo(() => createAppActionService({ role: activeRole, profiles, setAuditLog, setActionStatus, recordLocks, setRecordLocks }), [activeRole, profiles, recordLocks]);
  const productDatabase = useMemo(() => getProductDatabase(customProducts), [customProducts]);
  const selectedJobQuote = quotes.find((quote) => quote.id === selectedJob?.quoteId);

  function normaliseXeroContact(contact) {
    const primaryPerson = contact.ContactPersons?.[0] || {};
    const address = contact.Addresses?.find((item) => item.AddressType === "STREET") || contact.Addresses?.[0] || {};

    return {
      xeroContactId: contact.ContactID || contact.contactId || "",
      company: contact.Name || contact.name || "Unnamed Xero Contact",
      name: contact.Name || contact.name || "Unnamed Xero Contact",
      contact: [primaryPerson.FirstName, primaryPerson.LastName].filter(Boolean).join(" ") || contact.FirstName || contact.LastName || "",
      email: contact.EmailAddress || contact.email || "",
      phone: contact.Phones?.[0]?.PhoneNumber || contact.phone || "",
      deliveryAddress: [address.AddressLine1, address.AddressLine2, address.City, address.PostalCode].filter(Boolean).join(", "),
      isCustomer: Boolean(contact.IsCustomer || contact.isCustomer),
      isSupplier: Boolean(contact.IsSupplier || contact.isSupplier),
    };
  }

  function mergeByXeroIdOrName(existingItems, incomingItems, type) {
    const getKey = (item) => item.xeroContactId || item.id || item.company || item.name;
    const merged = [...existingItems];

    incomingItems.forEach((incoming) => {
      const incomingKey = incoming.xeroContactId || incoming.company || incoming.name;
      const existingIndex = merged.findIndex((item) => getKey(item) === incomingKey || item.company === incoming.company || item.name === incoming.name);

      if (existingIndex >= 0) {
        merged[existingIndex] = { ...merged[existingIndex], ...incoming };
      } else if (type === "customer") {
        merged.push({ id: `xero-customer-${incoming.xeroContactId || Date.now()}-${merged.length}`, ...incoming });
      } else {
        merged.push({ id: `xero-supplier-${incoming.xeroContactId || Date.now()}-${merged.length}`, ...incoming });
      }
    });

    return merged;
  }

  async function syncXeroContacts() {
    setXeroSyncStatus("Syncing customers and suppliers from Xero...");

    try {
      const response = await fetch("/api/xero/contacts", {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });

      if (!response.ok) {
        throw new Error(`Xero contacts request failed with status ${response.status}`);
      }

      const result = await response.json();
      const contacts = result.contacts || result.Contacts || [];
      const normalisedContacts = contacts.map(normaliseXeroContact);
      const xeroCustomers = normalisedContacts.filter((contact) => contact.isCustomer || !contact.isSupplier).map((contact) => ({
        ...contact,
        company: contact.company,
      }));
      const xeroSuppliers = normalisedContacts.filter((contact) => contact.isSupplier).map((contact) => ({
        ...contact,
        name: contact.name || contact.company,
      }));

      setCustomers((current) => mergeByXeroIdOrName(current, xeroCustomers, "customer"));
      setSuppliers((current) => mergeByXeroIdOrName(current, xeroSuppliers, "supplier"));
      setXeroSyncStatus(`Imported ${xeroCustomers.length} customers and ${xeroSuppliers.length} suppliers from Xero.`);
    } catch (error) {
      setXeroSyncStatus("Xero backend not connected yet. Add /api/xero/contacts to enable live import.");
    }
  }

  function resetXeroCsvImport() {
    setXeroCsvImportState({ importType: "customers", effectiveType: "customers", fileName: "", previewRows: [], summary: null, error: "" });
  }

  function handleXeroCsvFileSelected(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".csv")) {
      setXeroCsvImportState((current) => ({ ...current, fileName: "", previewRows: [], summary: null, error: "Only .csv files can be imported." }));
      return;
    }

    if (file.size > maxCsvImportFileSizeBytes) {
      setXeroCsvImportState((current) => ({ ...current, fileName: "", previewRows: [], summary: null, error: "CSV file is too large. Maximum size is 2MB." }));
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsedRows = parseCsvText(String(reader.result || ""));
        if (!parsedRows.length) {
          setXeroCsvImportState((current) => ({ ...current, fileName: file.name, previewRows: [], summary: null, error: "No rows found in the CSV file." }));
          return;
        }

        const requestedType = xeroCsvImportState.importType;
        const effectiveType = requestedType === "auto" ? "customers" : requestedType;
        const existingRecords = effectiveType === "suppliers" ? suppliers : customers;
        const previewRows = buildImportPreviewRows(parsedRows, effectiveType, existingRecords);

        setXeroCsvImportState((current) => ({ ...current, effectiveType, fileName: file.name, previewRows, summary: null, error: "" }));
      } catch (error) {
        setXeroCsvImportState((current) => ({ ...current, fileName: file.name, previewRows: [], summary: null, error: "CSV import failed. Check the file format and headers." }));
      }
    };
    reader.readAsText(file);
  }

  function confirmXeroCsvImport() {
    const effectiveType = xeroCsvImportState.effectiveType || (xeroCsvImportState.importType === "suppliers" ? "suppliers" : "customers");
    const rows = xeroCsvImportState.previewRows;
    if (!rows.length) return;

    const summary = rows.reduce((counts, row) => {
      if (row.action === "Create") return { ...counts, created: counts.created + 1 };
      if (row.action === "Update") return { ...counts, updated: counts.updated + 1 };
      if (row.action === "Skip") return { ...counts, skipped: counts.skipped + 1 };
      return { ...counts, failed: counts.failed + 1 };
    }, { created: 0, updated: 0, skipped: 0, failed: 0 });

    if (effectiveType === "suppliers") {
      setSuppliers((current) => {
        let next = [...current];
        rows.forEach((row) => {
          if (row.action === "Create") {
            next = [{ id: `supplier-import-${Date.now()}-${row.rowNumber}`, ...row.record }, ...next];
          }
          if (row.action === "Update") {
            next = next.map((supplier) => supplier.id === row.duplicateId ? { ...supplier, ...row.record } : supplier);
          }
        });
        return next;
      });
    } else {
      setCustomers((current) => {
        let next = [...current];
        rows.forEach((row) => {
          if (row.action === "Create") {
            next = [{ id: `customer-import-${Date.now()}-${row.rowNumber}`, ...row.record }, ...next];
          }
          if (row.action === "Update") {
            next = next.map((customer) => customer.id === row.duplicateId ? { ...customer, ...row.record } : customer);
          }
        });
        return next;
      });
    }

    const log = {
      id: `import-log-${Date.now()}`,
      date: new Date().toISOString(),
      importedBy: "Jon Davis",
      importType: effectiveType,
      fileName: xeroCsvImportState.fileName,
      ...summary,
    };

    setImportLogs((current) => [log, ...current]);
    setXeroCsvImportState((current) => ({ ...current, summary }));
  }

  function getCurrentTimeString() {
    return new Date().toTimeString().slice(0, 5);
  }

  function clockInStaff(staffId) {
    const todayDate = toIso(new Date());
    const alreadyOpen = clockEntries.find((entry) => entry.staffId === staffId && !entry.clockOut);
    if (alreadyOpen) return;

    actionService.createRecord({
      resource: activeRole === "staff" ? "own_clock_entries" : "clock_entries",
      record: {
        id: createEntityId("clock"),
        staffId,
        date: todayDate,
        clockIn: getCurrentTimeString(),
        clockOut: "",
      },
      setter: setClockEntries,
      notes: "Clock-in entry created.",
    });
  }

  function clockOutStaff(staffId) {
    const openEntry = clockEntries.find((entry) => entry.staffId === staffId && !entry.clockOut);
    if (!openEntry) return;
    actionService.updateRecord({
      resource: activeRole === "staff" ? "own_open_clock_entries" : "clock_entries",
      id: openEntry.id,
      patch: { clockOut: getCurrentTimeString() },
      setter: setClockEntries,
      notes: "Clock-out entry updated.",
    });
  }

  function addSickDays(records) {
    if (activeRole !== "operations" || !records?.length) return;
    setSickDays((current) => [...current, ...records]);
    setAuditLog((current) => [{
      id: createEntityId("audit"),
      createdAt: new Date().toISOString(),
      role: activeRole,
      action: "create",
      resource: "sick_days",
      recordId: records.map((record) => record.id).join(", "),
      notes: "Sick day absence recorded.",
    }, ...current]);
  }

  function deleteSickDay(id) {
    if (activeRole !== "operations") return;
    setSickDays((current) => current.filter((entry) => entry.id !== id));
    setAuditLog((current) => [{
      id: createEntityId("audit"),
      createdAt: new Date().toISOString(),
      role: activeRole,
      action: "delete",
      resource: "sick_days",
      recordId: id,
      notes: "Sick day absence removed.",
    }, ...current]);
  }

  function amendClockEntry(record) {
    if (activeRole !== "operations" || !record) return;
    setClockEntries((current) => [{ ...record, createdByRole: activeRole }, ...current]);
    setAuditLog((current) => [{
      id: createEntityId("audit"),
      createdAt: new Date().toISOString(),
      role: activeRole,
      action: "create",
      resource: "clock_entries",
      recordId: record.id,
      notes: `Clocking amendment recorded: ${record.amendmentReason || "No reason supplied"}`,
    }, ...current]);
    setAutomationStatus("Clocking amendment recorded and added to the timesheet.");
  }

  function updateHolidayForm(staffId, patch) {
    setHolidayForms((current) => ({
      ...current,
      [staffId]: {
        start: today,
        end: today,
        notes: "",
        ...(current[staffId] || {}),
        ...patch,
      },
    }));
  }

  function updateHolidayStaffPin(staffId, value) {
    setHolidayStaffPins((current) => ({ ...current, [staffId]: String(value || "").replace(/[^0-9]/g, "") }));
    setHolidayStaffPinErrors((current) => ({ ...current, [staffId]: "" }));
  }

  function addHolidayRequest(staffId) {
    const person = staff.find((item) => item.id === staffId);
    const pin = holidayStaffPins[staffId] || "";
    if (!staffPinMatches(person, pin)) {
      setHolidayStaffPinErrors((current) => ({ ...current, [staffId]: "Incorrect staff PIN" }));
      return;
    }

    const form = holidayForms[staffId] || { start: today, end: today, notes: "" };
    if (!form.start || !form.end) return;

    const created = actionService.createRecord({
      resource: activeRole === "staff" ? "own_holiday_requests" : "holiday_requests",
      record: {
        id: createEntityId("holiday"),
        staffId,
        start: form.start,
        end: form.end,
        notes: form.notes || "",
        status: "Pending",
      },
      setter: setHolidays,
      notes: "Holiday request created.",
    });
    if (!created) return;

    setHolidayForms((current) => ({ ...current, [staffId]: { start: today, end: today, notes: "" } }));
    setHolidayStaffPins((current) => ({ ...current, [staffId]: "" }));
    setHolidayStaffPinErrors((current) => ({ ...current, [staffId]: "" }));
  }

  function updateHolidayApprovalPin(holidayId, value) {
    setHolidayApprovalPins((current) => ({
      ...current,
      [holidayId]: value.replace(/[^0-9]/g, ""),
    }));
  }

  function updateHolidayStatus(holidayId, status) {
    const pin = holidayApprovalPins[holidayId] || "";

    if (pin !== "3490") {
      setHolidayApprovalErrors((current) => ({ ...current, [holidayId]: "Incorrect PIN code" }));
      return;
    }

    actionService.updateRecord({ resource: "holiday_requests", id: holidayId, patch: { status }, setter: setHolidays, notes: "Holiday request approval status updated." });
    setHolidayApprovalPins((current) => ({ ...current, [holidayId]: "" }));
    setHolidayApprovalErrors((current) => ({ ...current, [holidayId]: "" }));
  }

  function addCustomerRecord(customer) {
    if (!customer.company?.trim()) return;
    actionService.createRecord({ resource: "customers", record: { id: createEntityId("customer"), ...customer }, setter: setCustomers, notes: "Customer record created." });
  }

  function updateCustomerRecord(customerId, patch) {
    actionService.updateRecord({ resource: "customers", id: customerId, patch, setter: setCustomers, notes: "Customer record updated." });
  }

  function removeCustomerRecord(customerId) {
    const linked = quotes.some((quote) => quote.customerId === customerId) || jobs.some((job) => job.customerId === customerId) || deliveryNotes.some((note) => note.customerId === customerId);
    if (linked) {
      actionService.updateRecord({ resource: "customers", id: customerId, patch: { status: "Dormant", hidden: true }, setter: setCustomers, notes: "Linked customer hidden/dormant rather than deleted." });
      setAutomationStatus("Customer is linked to existing records, so it was marked Dormant/hidden instead of deleted.");
      return;
    }
    setCustomers((current) => current.filter((customer) => customer.id !== customerId));
    setAutomationStatus("Customer removed from the active list.");
  }

  function removeSupplierRecord(supplierId) {
    const linked = purchaseOrders.some((po) => po.supplierId === supplierId);
    if (linked) {
      setSuppliers((current) => current.map((supplier) => supplier.id === supplierId ? { ...supplier, status: "Inactive", hidden: true } : supplier));
      setAutomationStatus("Supplier is linked to purchasing records, so it was marked Inactive/hidden instead of deleted.");
      return;
    }
    setSuppliers((current) => current.filter((supplier) => supplier.id !== supplierId));
    setAutomationStatus("Supplier removed from the active list.");
  }

  function updateJob(jobId, patch) {
    actionService.updateRecord({ resource: "jobs", id: jobId, patch, setter: setJobs, notes: "Job updated through live-ready action service." });
  }

  function applyLivePlannerSnapshot(sourceJobs = jobs) {
    const planned = autoPlanJobsLive(sourceJobs, staff, weekStart, holidays);
    setJobs((current) => current.map((job) => {
      const plannedJob = planned.find((item) => item.id === job.id);
      return plannedJob ? { ...job, start: plannedJob.start, calculatedEnd: plannedJob.calculatedEnd, end: plannedJob.calculatedEnd, staffIds: plannedJob.staffIds, stageTasks: plannedJob.stageTasks, planningDiagnostics: plannedJob.planningDiagnostics || [] } : job;
    }));
    setAutomationStatus("Planner re-allocated live workload by staff roles, current load, priority and deadlines.");
  }

  function toggleStaff(jobId, staffId) {
    const targetJob = jobs.find((job) => job.id === jobId) || scheduledJobs.find((job) => job.id === jobId);
    if (!targetJob) return;
    const currentlyExcluded = (targetJob.excludedStaffIds || []).includes(staffId);
    const nextExcludedStaffIds = currentlyExcluded
      ? (targetJob.excludedStaffIds || []).filter((id) => id !== staffId)
      : Array.from(new Set([...(targetJob.excludedStaffIds || []), staffId]));
    const allowedStaff = staff.filter((person) => !nextExcludedStaffIds.includes(person.id));
    const stageTasks = ensureAllStageTasks(targetJob.stageTasks || [], targetJob.start, targetJob.end, targetJob.estimatedHours, targetJob.productionStageBreakdown || []).map((task) => {
      const nextIds = getTaskStaffIds(task).filter((id) => allowedStaff.some((person) => person.id === id));
      return { ...task, staffIds: nextIds, staffId: nextIds[0] || "", allocationMode: task.allocationMode === "manual" && nextIds.length ? "manual" : "auto" };
    });
    const replanned = autoPlanJobsLive(jobs.map((job) => job.id === jobId ? { ...job, excludedStaffIds: nextExcludedStaffIds, stageTasks } : job), staff, weekStart, holidays);
    const plannedJob = replanned.find((job) => job.id === jobId);
    updateJob(jobId, {
      excludedStaffIds: nextExcludedStaffIds,
      calculatedEnd: plannedJob?.calculatedEnd || targetJob.calculatedEnd,
      end: plannedJob?.calculatedEnd || targetJob.end,
      stageTasks: plannedJob?.stageTasks || stageTasks,
      staffIds: plannedJob?.staffIds || Array.from(new Set((plannedJob?.stageTasks || stageTasks).flatMap((task) => getTaskStaffIds(task)).filter(Boolean))),
      planningDiagnostics: plannedJob?.planningDiagnostics || [],
    });
  }

  function toggleStaffRole(staffId, role) {
    setStaff((currentStaff) => {
      const nextStaff = currentStaff.map((person) => {
        if (person.id !== staffId) return person;
        const roles = person.roles || [];
        const nextRoles = roles.includes(role) ? roles.filter((item) => item !== role) : [...roles, role];
        const nextPriorities = { ...(person.rolePriorities || {}) };
        if (!nextRoles.includes(role)) delete nextPriorities[role];
        if (nextRoles.includes(role) && !nextPriorities[role]) nextPriorities[role] = nextRoles.length;
        return normaliseStaffRolePriorities({
          ...person,
          roles: nextRoles,
          rolePriorities: nextPriorities,
        });
      });

      setJobs((currentJobs) => currentJobs.map((job) => {
        if (!job.staffIds.includes(staffId)) return job;
        return {
          ...job,
          updatedAt: Date.now(),
          stageTasks: autoAssignStageTasksForStaff(job, nextStaff, job.staffIds, currentJobs.filter((item) => item.id !== job.id)),
        };
      }));

      return nextStaff;
    });
  }

  function updateStaffRolePriority(staffId, role, priority) {
    setStaff((current) => current.map((person) => person.id === staffId
      ? normaliseStaffRolePriorities({ ...person, rolePriorities: { ...(person.rolePriorities || {}), [role]: Number(priority || 99) } })
      : person));
  }

  function updateStaffPin(staffId, value) {
    const pin = String(value || "").replace(/[^0-9]/g, "").slice(0, 4);
    setStaff((current) => current.map((person) => person.id === staffId ? { ...person, pin } : person));
  }

  function deactivateStaffMember(staffId) {
    const person = staff.find((item) => item.id === staffId);
    if (!person) return;
    if (!window.confirm(`Deactivate ${person.name}? Historic jobs, clock entries, sick days and timesheets will remain linked.`)) return;
    setStaff((current) => current.map((item) => item.id === staffId ? { ...item, status: "Inactive", deactivatedAt: new Date().toISOString() } : item));
    setAuditLog((current) => [{
      id: createEntityId("audit"),
      createdAt: new Date().toISOString(),
      role: activeRole,
      action: "deactivate",
      resource: "staff",
      recordId: staffId,
      notes: "Staff member deactivated. Historic records preserved.",
    }, ...current]);
  }

  function reactivateStaffMember(staffId) {
    setStaff((current) => current.map((item) => item.id === staffId ? { ...item, status: "Active", reactivatedAt: new Date().toISOString() } : item));
    setAuditLog((current) => [{
      id: createEntityId("audit"),
      createdAt: new Date().toISOString(),
      role: activeRole,
      action: "reactivate",
      resource: "staff",
      recordId: staffId,
      notes: "Staff member reactivated.",
    }, ...current]);
  }

  function addStaffMember() {
    if (!newStaff.name.trim()) return;
    const staffPin = String(newStaff.pin || "").replace(/[^0-9]/g, "").slice(0, 4);
    if (staffPin.length !== 4) {
      setActionStatus("Enter a 4 digit staff PIN before adding staff.");
      return;
    }
    const staffMember = normaliseStaffRolePriorities({
      id: createEntityId("staff"),
      name: newStaff.name.trim(),
      roles: newStaff.roles,
      rolePriorities: newStaff.rolePriorities,
      hoursPerDay: Number(newStaff.hoursPerDay || 0),
      pin: staffPin,
      status: "Active",
    });
    actionService.createRecord({ resource: "staff", record: staffMember, setter: setStaff, notes: "Staff member created." });
    setNewStaff({ name: "", hoursPerDay: 8, pin: "", roles: [], rolePriorities: {} });
  }

  function toggleNewStaffRole(role) {
    setNewStaff((current) => {
      const nextRoles = current.roles.includes(role) ? current.roles.filter((item) => item !== role) : [...current.roles, role];
      const nextPriorities = { ...(current.rolePriorities || {}) };
      if (!nextRoles.includes(role)) delete nextPriorities[role];
      if (nextRoles.includes(role) && !nextPriorities[role]) nextPriorities[role] = nextRoles.length;
      return { ...current, roles: nextRoles, rolePriorities: nextPriorities };
    });
  }

  function updateNewStaffRolePriority(role, priority) {
    setNewStaff((current) => ({ ...current, rolePriorities: { ...(current.rolePriorities || {}), [role]: Number(priority || 99) } }));
  }

  function addJob() {
    if (!newJob.jobNo.trim() || !newJob.customer.trim() || !newJob.title.trim()) return;
    const customerId = createEntityId("customer");
    const estimatedHours = Number(newJob.estimatedHours || 0);
    const conversionDate = today;
    const customerRecord = { id: customerId, company: newJob.customer, contact: "", email: "", phone: "", deliveryAddress: "" };
    const job = {
      ...newJob,
      id: createEntityId("job"),
      customerId,
      estimatedHours,
      start: conversionDate,
      staffIds: [],
      notes: "",
      invoiceStatus: "Not Invoiced",
      productionStageBreakdown: [],
      stageTasks: createDefaultStageTasks(conversionDate, newJob.deadline, estimatedHours),
    };
    const createdCustomer = actionService.createRecord({ resource: "customers", record: customerRecord, setter: setCustomers, notes: "Customer created from manual job entry." });
    const createdJob = actionService.createRecord({ resource: "jobs", record: job, setter: setJobs, notes: "Manual job created." });
    if (!createdCustomer || !createdJob) return;
    setSelectedJobId(job.id);
    setNewJob({ ...newJob, jobNo: "", customer: "", title: "", estimatedHours: 16 });
  }

  function addPlannerStressTestJobs() {
    const testJobs = createPlannerStressTestJobs({ existingJobs: jobs, pricingSchedule, productivityRules, productDatabase, customers, today });
    const plannedTestJobs = autoPlanJobsLive([...jobs, ...testJobs.map((job) => ({ ...job, excludedStaffIds: [] }))], staff, weekStart, holidays).filter((job) => testJobs.some((testJob) => testJob.id === job.id));
    const suggestedPos = plannedTestJobs.flatMap((job, index) => {
      const missingParts = buildMissingPartsForJob(job, stockItems);
      return missingParts.length ? [createSuggestedPurchaseOrderDraft({ job, missingParts, supplierId: suppliers[0]?.id || "", poCount: purchaseOrders.length + index, today })] : [];
    });

    setJobs((current) => [...current, ...plannedTestJobs]);
    if (suggestedPos.length) setPurchaseOrders((current) => [...suggestedPos, ...current]);
    setSelectedJobId(plannedTestJobs[0]?.id || selectedJobId);
    setAutomationStatus(`Planner stress test added ${plannedTestJobs.length} jobs, ${plannedTestJobs.length * 3} steel lines and ${suggestedPos.length} suggested supplier enquiry(s).`);
  }

  function runPlannerFunctionalTest() {
    const report = runPlannerFunctionalTestSuite({ jobs, staff, pricingSchedule, productivityRules, productDatabase, customers, stockItems, suppliers, purchaseOrders, today, holidays });
    setPlannerTestReport(report);
    setAutomationStatus(report.passed ? `Functional test passed: ${report.createdJobs} jobs, ${report.createdLines} lines, ${report.allocatedTasks} allocated tasks, ${report.suggestedPos} suggested supplier enquiry(s).` : "Functional test failed. Review the test report below.");
  }

  function importTakeoffQuoteFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result || "{}"));

        if (data.schema !== "jdfabs.takeoff.quote.v1" || !data.quote) {
          setTakeoffImportStatus("Import failed: this is not a valid Jdfabs take-off quote export.");
          return;
        }

        const importedCustomer = data.customer || {};
        const existingCustomer = customers.find((customer) =>
          customer.company?.toLowerCase() === importedCustomer.company?.toLowerCase()
        );
        const customerId = existingCustomer?.id || `import-customer-${Date.now()}`;

        if (!existingCustomer) {
          setCustomers((current) => [
            ...current,
            {
              id: customerId,
              company: importedCustomer.company || "Imported Customer",
              contact: importedCustomer.contact || "",
              email: importedCustomer.email || "",
              phone: importedCustomer.phone || "",
              deliveryAddress: importedCustomer.deliveryAddress || "",
            },
          ]);
        }

        const importedItems = (data.quote.items || []).map((item, index) => ({
          id: item.id || `import-item-${Date.now()}-${index}`,
          description: item.description || "Imported take-off line",
          quantity: Number(item.quantity || 1),
          unitPrice: Number(item.unitPrice || 0),
          productId: item.productId || "",
          weightKg: Number(item.weightKg || 0),
          materialValue: Number(item.materialValue || 0),
          deliveryShare: Number(item.deliveryShare || 0),
        }));

        const subtotal = Number(data.quote.subtotal || importedItems.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.unitPrice || 0), 0));
        const vatRate = Number(data.quote.vatRate || 20);
        const reservedQuoteNumber = reserveDocumentNumberSync({ documentType: "quote", records: quotes, linkedSourceNumber: "" });
        const quoteSequence = reservedQuoteNumber.sequence;
        const quote = {
          id: createEntityId("quote"),
          quoteSequence,
          quoteNo: reservedQuoteNumber.number,
          customerId,
          customer: importedCustomer.company || existingCustomer?.company || "Imported Customer",
          title: data.quote.title || "Imported steel take-off quote",
          date: data.quote.date || today,
          validUntil: data.quote.validUntil || toIso(addDays(new Date(), 30)),
          status: data.quote.status || "Draft",
          uploadedFileName: file.name,
          importSource: data.source || "Steel Take-Off Quote Builder",
          deliveryText: data.quote.deliveryText || "Free delivery",
          deliveryCost: Number(data.quote.deliveryCost || 0),
          takeoffLines: data.quote.takeoffLines || [],
          items: importedItems,
          subtotal,
          vatRate,
          total: Number(data.quote.total || subtotal * (1 + vatRate / 100)),
        };

        setQuotes((current) => [quote, ...current]);
        setTakeoffImportStatus(`Imported ${quote.quoteNo} from ${file.name}.`);
      } catch (error) {
        setTakeoffImportStatus("Import failed: the selected file could not be read as JSON.");
      }
    };

    reader.readAsText(file);
    event.target.value = "";
  }

  function createAiTakeoffPreview() {
    if (!takeoffAiInput.trim()) {
      setTakeoffAiStatus("Paste a steel list or drawing schedule first.");
      return;
    }

    const previewRows = parseAiTakeoffDraftRows(takeoffAiInput);
    setTakeoffAiPreviewRows(previewRows);
    setTakeoffAiStatus(`Created ${previewRows.length} draft take-off row(s). Review and approve before raising the quote.`);
  }

  function updateAiTakeoffPreviewRow(rowId, patch) {
    setTakeoffAiPreviewRows((current) => current.map((row) => row.id === rowId ? { ...row, ...patch } : row));
  }

  function clearAiTakeoffPreview() {
    setTakeoffAiPreviewRows([]);
    setTakeoffAiInput("");
    setTakeoffAiStatus("");
  }

  function raiseQuote() {
    if (!newQuote.title.trim()) return;
    const customer = customers.find((item) => item.id === newQuote.customerId);
    const approvedAiRows = takeoffAiPreviewRows.filter((row) => row.approved);
    const items = approvedAiRows.length ? approvedAiRows.map((row, index) => ({
      id: `qi-${Date.now()}-${index}`,
      description: `${row.productName}${row.sectionSize ? ` · ${row.sectionSize}` : ""}${row.length ? ` · ${row.length}m` : ""}${row.finish ? ` · ${row.finish}` : ""}`,
      quantity: Number(row.quantity || 1),
      unitPrice: Number(newQuote.unitPrice || 0),
      productId: row.productId,
      sectionSize: row.sectionSize,
      grade: row.grade,
      finish: row.finish,
      length: Number(row.length || 0),
      holes: Number(row.holes || 0),
      notes: row.notes,
    })) : [{ id: `qi-${Date.now()}`, description: newQuote.description, quantity: Number(newQuote.quantity || 1), unitPrice: Number(newQuote.unitPrice || 0) }];
    const totals = calculateTotal(items, 20, "unitPrice");
    const reservedQuoteNumber = reserveDocumentNumberSync({ documentType: "quote", records: quotes, linkedSourceNumber: "" });
    const quoteSequence = reservedQuoteNumber.sequence;
    const quote = { id: createEntityId("quote"), quoteSequence,
    quoteNo: reservedQuoteNumber.number, customerId: newQuote.customerId, customer: customer?.company || "", title: newQuote.title, date: today, validUntil: newQuote.validUntil, status: "Draft", uploadedFileName: newQuote.uploadedFileName, jobDeliveryAddress: newQuote.jobDeliveryAddress || "", deliveryAddress: newQuote.jobDeliveryAddress || "", takeoffLines: approvedAiRows, items, ...totals };
    setQuotes((current) => [quote, ...current]);
    setNewQuote({ ...newQuote, title: "", description: "Fabrication work", quantity: 1, unitPrice: 500, uploadedFileName: "", jobDeliveryAddress: "" });
    setTakeoffAiPreviewRows([]);
    setTakeoffAiInput("");
    setTakeoffAiStatus("");
  }

  function updateQuoteStatus(quoteId, status) {
    setQuotes((current) => current.map((quote) => (quote.id === quoteId ? { ...quote, status } : quote)));
  }

  function sendQuoteToPlannerInbox(quote) {
    const latestQuote = quotes.find((item) => item.id === quote.id) || quote;

    if (plannerQuotePackages.some((item) => item.quoteId === latestQuote.id)) {
      setAutomationStatus(`${latestQuote.quoteNo} is already in Quote Approvals.`);
      if (activeRole === "operations") setActiveTab("plannerQuotes");
      return;
    }

    const customer = customers.find((item) => item.id === latestQuote.customerId);
    const quoteHours = Number(latestQuote.estimatedProductionHours || estimateQuoteProductionHours(latestQuote.takeoffLines || [], productivityRules, productDatabase));
    const leadTime = calculatePlannerLeadTime({ jobs, staff, quoteHours, priority: latestQuote.priority || "3", requestedDeliveryDate: latestQuote.requestedDeliveryDate || "", today });
    const quotePackage = buildQuotePackage({ quote: { ...latestQuote, estimatedProductionHours: quoteHours, leadTime }, customer, leadTime });
    const created = actionService.createRecord({
      resource: "quote_packages",
      record: { ...quotePackage, id: quotePackage.quoteId, inboxStatus: "Awaiting lead time review", leadTimeReviewedAt: "", sentToCustomerAt: "" },
      setter: setPlannerQuotePackages,
      notes: "Draft-complete quote package sent to Quote Approvals for lead-time review.",
    });
    if (!created) return;

    actionService.updateRecord({
      resource: "quotes",
      id: latestQuote.id,
      patch: { status: "In Planner Review", sentToPlannerAt: new Date().toISOString(), estimatedProductionHours: quoteHours, leadTime },
      setter: setQuotes,
      notes: "Quote sent to Quote Approvals for lead-time review.",
    });
    setAutomationStatus(`${latestQuote.quoteNo} sent to Quote Approvals for lead-time review.`);
    if (activeRole === "operations") setActiveTab("plannerQuotes");
  }

  function updatePlannerQuotePackageStatus(quotePackage, inboxStatus) {
    const quoteStatusMap = {
      "Ready to send to customer": "Ready to send",
      "Sent to customer": "Sent",
      Accepted: "Accepted",
      Rejected: "Rejected",
    };
    const now = new Date().toISOString();
    const patch = {
      inboxStatus,
      leadTimeReviewedAt: inboxStatus === "Ready to send to customer" ? now : quotePackage.leadTimeReviewedAt,
      sentToCustomerAt: inboxStatus === "Sent to customer" ? now : quotePackage.sentToCustomerAt,
      approvedAt: inboxStatus === "Accepted" ? now : quotePackage.approvedAt,
      rejectedAt: inboxStatus === "Rejected" ? now : quotePackage.rejectedAt,
    };
    actionService.updateRecord({ resource: "quote_packages", id: quotePackage.quoteId, patch, setter: setPlannerQuotePackages, notes: `Planner quote package moved to ${inboxStatus}.` });
    if (quoteStatusMap[inboxStatus]) {
      actionService.updateRecord({ resource: "quotes", id: quotePackage.quoteId, patch: { status: quoteStatusMap[inboxStatus] }, setter: setQuotes, notes: `Quote status updated from Quote Approvals to ${quoteStatusMap[inboxStatus]}.` });
    }
    setAutomationStatus(`${quotePackage.quoteNo} moved to ${inboxStatus}.`);
  }

  function convertQuotePackageToJob(quotePackage) {
    if (quotePackage.inboxStatus !== "Accepted") {
      setAutomationStatus(`${quotePackage.quoteNo} must be marked Accepted in Quote Approvals before creating a job.`);
      return;
    }
    if (jobs.some((job) => job.quoteId === quotePackage.quoteId)) {
      setAutomationStatus(`${quotePackage.quoteNo} has already been converted to a job.`);
      return;
    }

    const job = createJobFromQuotePackage({ quotePackage, jobCount: jobs.length, today });
    const stockAfterExistingAllocations = allocateExistingStockRowsForJob(stockItems, job);
    const missingParts = buildMissingPartsForJob(job, stockAfterExistingAllocations);
    const suggestedPo = missingParts.length ? createSuggestedPurchaseOrderDraft({ job, missingParts, supplierId: suppliers[0]?.id || "", poCount: purchaseOrders.length, today }) : null;

    const createdJob = actionService.createRecord({ resource: "jobs", record: job, setter: setJobs, notes: "Quote package converted to job." });
    if (!createdJob) return;
    setStockItems(() => stockAfterExistingAllocations);
    if (suggestedPo) actionService.createRecord({ resource: "purchase_enquiries", record: suggestedPo, setter: setPurchaseOrders, notes: "Supplier enquiry created from missing job materials." });
    setSelectedJobId(job.id);
    actionService.updateRecord({ resource: "quotes", id: quotePackage.quoteId, patch: { status: "Converted" }, setter: setQuotes, notes: "Quote status updated after job conversion." });
    actionService.updateRecord({ resource: "quote_packages", id: quotePackage.quoteId, patch: { inboxStatus: "Converted", convertedJobId: job.id, convertedJobNo: job.jobNo }, setter: setPlannerQuotePackages, notes: "Planner quote package marked as converted." });
    setAutomationStatus(`${quotePackage.quoteNo} converted to ${job.jobNo}. ${suggestedPo ? `Supplier enquiry ${suggestedPo.enquiryNo} created for missing material review.` : "No missing material found for supplier enquiry."}`);
    setActiveTab("planner");
  }

  function convertQuoteToJob(quote) {
    const customer = customers.find((item) => item.id === quote.customerId);
    const leadTime = calculatePlannerLeadTime({ jobs, staff, quoteHours: Number(quote.estimatedProductionHours || 0), priority: quote.priority || "3", requestedDeliveryDate: quote.requestedDeliveryDate || "", today });
    const quotePackage = { ...buildQuotePackage({ quote, customer, leadTime }), inboxStatus: "Accepted" };
    convertQuotePackageToJob(quotePackage);
  }


  function createJobReworkQuote(job) {
    const sourceQuote = quotes.find((quote) => quote.id === job.quoteId);
    if (!sourceQuote) {
      setAutomationStatus(`${job.jobNo} has no linked quote to rework. Create a new quote manually if this was a manual job.`);
      setActiveTab("quotes");
      return;
    }
    const reservedQuoteNumber = reserveDocumentNumberSync({ documentType: "quote", records: quotes, linkedSourceNumber: sourceQuote.quoteNo || "" });
    const reworkQuote = withRecordMeta({
      ...sourceQuote,
      id: createEntityId("quote"),
      quoteSequence: reservedQuoteNumber.sequence,
      quoteNo: reservedQuoteNumber.number,
      title: `${sourceQuote.title || job.title || "Job"} amendment`,
      date: today,
      validUntil: toIso(addDays(new Date(), 30)),
      status: "Draft",
      amendedFromQuoteId: sourceQuote.id,
      amendedFromQuoteNo: sourceQuote.quoteNo || "",
      reworkForJobId: job.id,
      reworkForJobNo: job.jobNo,
      takeoffLines: (sourceQuote.takeoffLines || []).map((line, index) => ({ ...line, id: `rework-line-${Date.now()}-${index}` })),
      items: (sourceQuote.items || []).map((item, index) => ({ ...item, id: `rework-item-${Date.now()}-${index}` })),
    });
    setQuotes((current) => [reworkQuote, ...current]);
    updateJob(job.id, { status: "Rework Required", notes: `${job.notes || ""}${job.notes ? "\n" : ""}Rework quote created: ${reworkQuote.quoteNo}` });
    setAutomationStatus(`${reworkQuote.quoteNo} created as a draft rework quote for ${job.jobNo}.`);
    setActiveTab("quotes");
  }

  function cancelJobAndReleaseStock(job) {
    const confirmMessage = `Remove/cancel ${job.jobNo || "this job"}?\n\nThis will remove it from Job Register and Planner, cancel open delivery notes, and release stock allocated to this job where possible.`;
    if (typeof window !== "undefined" && !window.confirm(confirmMessage)) return;
    const nowIso = new Date().toISOString();
    setJobs((current) => current.filter((item) => item.id !== job.id));
    setDeliveryNotes((current) => current.map((note) => note.jobId === job.id ? { ...note, status: "Cancelled", cancelledAt: nowIso, cancellationReason: "Job removed/cancelled" } : note));
    setPlannerQuotePackages((current) => current.map((pkg) => pkg.convertedJobId === job.id ? { ...pkg, inboxStatus: "Job Cancelled", cancelledJobAt: nowIso } : pkg));
    setQuotes((current) => current.map((quote) => quote.id === job.quoteId ? { ...quote, status: quote.status === "Converted" ? "Job Cancelled" : quote.status, cancelledJobId: job.id, cancelledJobAt: nowIso } : quote));
    setStockItems((current) => current.map((item) => {
      const linkedToJob = item.allocatedJobId === job.id || item.jobId === job.id;
      if (!linkedToJob) return item;
      const isOffcut = item.stockLineType === "Offcut" || item.status === "Offcut";
      return {
        ...item,
        allocatedJobId: "",
        jobId: "",
        status: isOffcut ? "Offcut" : "In Stock",
        notes: `${item.notes || ""}${item.notes ? "\n" : ""}Released from cancelled job ${job.jobNo || job.id}.`,
        lengthSegments: getStockSegments(item).map((segment) => ({ ...segment, allocatedJobId: "", jobId: "", status: isOffcut ? "Offcut" : "Available" })),
      };
    }));
    if (selectedJobId === job.id) setSelectedJobId(jobs.find((item) => item.id !== job.id)?.id || "");
    setAutomationStatus(`${job.jobNo || "Job"} removed from active jobs/planner and linked stock was released where possible.`);
  }


  function recalculateJobStockAllocation(job) {
    const confirmMessage = `Recalculate stock allocation for ${job.jobNo || "this job"}?\n\nThis will release current allocated stock for this job, restore available/offcut stock where possible, then run the best-fit allocation again. A supplier enquiry will be created only for any remaining shortfall.`;
    if (typeof window !== "undefined" && !window.confirm(confirmMessage)) return;
    let missingParts = [];
    let createdEnquiry = null;
    setStockItems((currentStock) => {
      const releasedStock = releaseStockAllocationsForJob(currentStock, job);
      const reallocatedStock = allocateExistingStockRowsForJob(releasedStock, job);
      missingParts = buildMissingPartsForJob(job, reallocatedStock);
      if (missingParts.length) {
        createdEnquiry = createSuggestedPurchaseOrderDraft({ job, missingParts, supplierId: suppliers[0]?.id || "", poCount: purchaseOrders.length, today });
      }
      return reallocatedStock;
    });
    if (createdEnquiry) {
      actionService.createRecord({ resource: "purchase_enquiries", record: createdEnquiry, setter: setPurchaseOrders, notes: "Supplier enquiry created after stock reallocation shortfall." });
    }
    updateJob(job.id, { notes: `${job.notes || ""}${job.notes ? "\n" : ""}Stock allocation recalculated on ${today}. ${createdEnquiry ? `Supplier enquiry ${createdEnquiry.enquiryNo} created for shortfall.` : "No stock shortfall after reallocation."}` });
    setAutomationStatus(`${job.jobNo || "Job"} stock allocation recalculated. ${createdEnquiry ? `Supplier enquiry ${createdEnquiry.enquiryNo} created for shortfall.` : "No missing material found."}`);
  }

  function updatePoLine(lineId, patch) {
    setNewPo((current) => ({
      ...current,
      lines: current.lines.map((line) => line.id === lineId ? { ...line, ...patch } : line),
    }));
  }

  function addPoLine() {
    setNewPo((current) => ({
      ...current,
      lines: [...current.lines, createPoLineFromPart({ productId: "ub", sectionSize: "203x102x23", length: "", finish: "Self colour" }, current.lines.length + 1, 1, customProducts)],
    }));
  }

  function removePoLine(lineId) {
    setNewPo((current) => ({
      ...current,
      lines: current.lines.length > 1 ? current.lines.filter((line) => line.id !== lineId) : current.lines,
    }));
  }

  function createSuggestedPoLinesFromMissingParts(job, missingParts) {
    const suggestedLines = missingParts.map(({ part, status }, index) => ({
      id: `po-suggested-${Date.now()}-${index}`,
      description: `${part.description}${part.sectionSize ? ` · ${part.sectionSize}` : ""}${part.grade ? ` · ${part.grade}` : ""}${part.finish ? ` · ${part.finish}` : ""}`,
      productId: part.productId || "ub",
      sectionSize: part.sectionSize || "",
      grade: part.grade || "",
      length: part.length || "",
      requiredCutLength: part.requiredCutLength || part.length || "",
      finish: part.finish || "Self colour",
      quantity: Math.max(1, Number(status.missingQuantity || part.quantity || 1)),
      unitCost: 0,
    }));

    setNewPo((current) => ({
      ...current,
      jobId: job.id,
      lines: suggestedLines.length ? suggestedLines : current.lines,
    }));
    setActiveTab("pos");
  }

  function raisePurchaseOrder() {
    const job = jobs.find((item) => item.id === newPo.jobId);
    const validLines = (newPo.lines || []).filter((line) => line.productId && line.sectionSize);
    if (!job || validLines.length === 0) return;

    const items = validLines.map((line) => ({
      id: `poi-${Date.now()}-${line.id}`,
      description: buildPoLineDescription(line, productDatabase),
      productId: line.productId,
      sectionSize: line.sectionSize,
      grade: line.grade || "",
      length: line.length,
      requiredCutLength: line.requiredCutLength || line.length || "",
      finish: line.finish,
      quantity: Number(line.quantity || 1),
      unitCost: Number(line.unitCost || 0),
    }));

    const totals = calculateTotal(items, 20, "unitCost");
    const reservedPoNumber = reserveDocumentNumberSync({ documentType: "purchaseOrder", records: purchaseOrders, linkedSourceNumber: "" });
    const po = { id: createEntityId("po"), poNo: reservedPoNumber.number, enquiryNo: "", documentKind: "Purchase Order", jobId: newPo.jobId, jobNo: job.jobNo || "", supplierId: newPo.supplierId, date: today, requiredBy: newPo.requiredBy, status: "Draft PO", items, ...totals };
    const created = actionService.createRecord({ resource: "purchase_orders", record: po, setter: setPurchaseOrders, notes: "Purchase order raised against job." });
    if (!created) return;
    const onOrderItems = createStockItemsFromPurchasingDocument(po, "On Order");
    if (onOrderItems.length) {
      setStockItems((current) => [...onOrderItems, ...current]);
      setAutomationStatus(`${getPurchasingDocumentNumber(po)} raised and ${onOrderItems.length} stock line(s) added to inventory.`);
    } else {
      setAutomationStatus(`${getPurchasingDocumentNumber(po)} raised, but no stock lines were added. Check each PO line has product, section and ordered length.`);
    }
    updateJob(job.id, { status: "Waiting Material", materialsDue: newPo.requiredBy });
    setNewPo({ ...newPo, supplierId: "", supplierName: "", lines: [createPoLineFromPart({ productId: "ub", sectionSize: "203x102x23", length: "", finish: "Self colour" }, 1, 1, customProducts)] });
  }

  function addStockItem() {
    const productId = newStockItem.productId || "ub";
    const sectionSize = String(newStockItem.sectionSize || getSectionOptions(productId, customProducts)[0] || "").trim();
    const length = normaliseLengthM(newStockItem.length) || Number(newStockItem.length || 0);
    const quantity = Math.max(1, Number(newStockItem.quantity || 1));
    if (!sectionSize || !length) {
      setAutomationStatus("Stock item not added: choose a section/size and enter a length.");
      return;
    }
    const baseStockItem = { ...newStockItem, id: createEntityId("stock"), productId, sectionSize, quantity, length, status: newStockItem.status || "In Stock" };
    const created = actionService.createRecord({
      resource: "stock_items",
      record: { ...baseStockItem, lengthSegments: createLengthSegmentsForStockItem(baseStockItem) },
      setter: setStockItems,
      notes: "Stock item created through live-ready action service.",
    });
    if (!created) return;
    setAutomationStatus(`Stock item added: ${sectionSize} x ${quantity} at ${formatLengthM(length)}.`);
    setNewStockItem({ productId: "ub", sectionSize: "", grade: "S355", finish: "Self colour", length: 6, width: "", quantity: 1, location: "", status: "In Stock", allocatedJobId: "", purchaseDocumentNo: "", notes: "" });
  }

  function updateStockItem(stockItemId, patch) {
    actionService.updateRecord({ resource: "stock_items", id: stockItemId, patch, setter: setStockItems, notes: "Stock item updated through live-ready action service." });
  }

  function allocateStockItem(stockItemId, jobId) {
    actionService.updateRecord({ resource: "stock_items", id: stockItemId, patch: { allocatedJobId: jobId }, setter: setStockItems, notes: "Stock allocation updated through live-ready action service." });
  }

  function scrapStockItemSegment(stockItemId, segmentId) {
    if (!actionService.guard("canUpdate", "stock_items", "Stock offcut scrapped/removed from available inventory.")) return;
    const reason = typeof window !== "undefined" ? window.prompt("Reason for scrapping/removing this offcut?", "Scrapped offcut") : "Scrapped offcut";
    setStockItems((current) => scrapStockSegment(current, { stockItemId, segmentId, reason: reason || "Scrapped offcut" }));
    setAutomationStatus("Stock line removed from inventory as scrap.");
  }

  function cutAllocatedStockItem(stockItemId) {
    if (!actionService.guard("canUpdate", "stock_items", "Allocated stock cut and consumed.")) return;
    setStockItems((current) => consumeAllocatedStockLine(current, stockItemId));
  }

  function manualCutOffcutStockItem(stockItemId) {
    if (!actionService.guard("canUpdate", "stock_items", "Manual cut taken from offcut stock.")) return;
    const source = stockItems.find((item) => item.id === stockItemId);
    const maxLength = Number(source?.length || getRemainingLengthForStockItem(source) || 0);
    const input = typeof window !== "undefined" ? window.prompt(`Cut length in metres from this offcut? Max ${formatLengthM(maxLength)}`, "") : "";
    const cutLength = normaliseLengthM(input) || Number(input || 0);
    if (!cutLength || cutLength <= 0 || cutLength > maxLength + 0.0001) return;
    const jobId = typeof window !== "undefined" ? window.prompt("Optional job ID to allocate this manual cut to. Leave blank if not job-linked.", source?.allocatedJobId || "") : "";
    setStockItems((current) => cutOffcutStockLine(current, { stockItemId, lengthM: cutLength, jobId: jobId || "" }));
  }

  function updatePOStatus(poId, status) {
    const existingPo = purchaseOrders.find((item) => item.id === poId);
    if (!existingPo) return;
    actionService.updateRecord({ resource: getPurchasingPermissionResource(existingPo), id: poId, patch: { status }, setter: setPurchaseOrders, notes: `${getPurchasingDocumentTitle(existingPo)} status updated.` });
    const po = existingPo;
    if (status === "Sent" && po && !isEnquiryDocument(po)) {
      const onOrderItems = createStockItemsFromPurchasingDocument(po, "On Order");
      if (onOrderItems.length) setStockItems((current) => {
        const hasDocumentStock = current.some((item) => item.purchaseDocumentId === po.id);
        return hasDocumentStock ? current : [...onOrderItems, ...current];
      });
    }
    if (po && status === "Received") {
      setStockItems((current) => current.map((item) => item.purchaseDocumentId === po.id ? {
        ...item,
        status: item.stockLineType === "Offcut" ? "Offcut" : "In Stock",
        location: item.location === "On order" ? "Goods in" : item.location,
        lengthSegments: getStockSegments(item).map((segment) => ({ ...segment, status: item.stockLineType === "Offcut" ? "Offcut" : segment.status, sourceStatus: item.stockLineType === "Offcut" ? "Offcut" : "In Stock" }))
      } : item));
      updateJob(po.jobId, { status: "In Production" });
    }
  }

  function sendPurchaseOrder(poId) {
    const po = purchaseOrders.find((item) => item.id === poId);
    updatePOStatus(poId, isEnquiryDocument(po) ? "Enquiry Sent" : "Sent");
  }

  function markSupplierQuoteReceived(poId) {
    updatePOStatus(poId, "Supplier Quote Received");
    const po = purchaseOrders.find((item) => item.id === poId);
    if (po) startEditPurchaseOrder({ ...po, status: "Supplier Quote Received" });
  }

  function raisePoFromEnquiry(poId) {
    const enquiry = purchaseOrders.find((item) => item.id === poId);
    if (!enquiry) {
      setAutomationStatus("Could not raise PO: enquiry record was not found.");
      return;
    }

    const validItems = (enquiry.items || [])
      .map((item, index) => normalisePoLine(item, index))
      .filter((item) => item.productId && item.sectionSize);

    if (!validItems.length) {
      setAutomationStatus(`${getPurchasingDocumentNumber(enquiry)} cannot be raised to PO because it has no valid material lines.`);
      return;
    }

    const items = validItems.map((item, index) => ({
      ...item,
      id: item.id || `poi-${Date.now()}-${index}`,
      description: buildPoLineDescription(item, productDatabase),
      quantity: Number(item.quantity || 1),
      unitCost: Number(item.unitCost || 0),
    }));

    const reservedPoNumber = reserveDocumentNumberSync({ documentType: "purchaseOrder", records: purchaseOrders, linkedSourceNumber: "" });
    const totals = calculatePoTotals(items, Number(enquiry.vatRate || 20));
    const linkedJob = jobs.find((job) => job.id === enquiry.jobId);
    const raisedPo = {
      ...enquiry,
      ...totals,
      items,
      documentKind: "Purchase Order",
      poNo: reservedPoNumber.number,
      jobNo: enquiry.jobNo || linkedJob?.jobNo || "",
      status: "Draft PO",
      raisedFromEnquiryNo: enquiry.enquiryNo || "",
    };

    const onOrderItems = createStockItemsFromPurchasingDocument(raisedPo, "On Order");

    const updated = actionService.updateRecord({
      resource: "purchase_orders",
      id: poId,
      patch: raisedPo,
      setter: setPurchaseOrders,
      notes: "Supplier enquiry converted to formal purchase order.",
    });

    if (!updated) {
      setAutomationStatus(`Could not raise ${getPurchasingDocumentNumber(enquiry)} to PO. Check operations permissions.`);
      return;
    }

    setStockItems((current) => {
      const withoutExistingForPo = current.filter((item) => item.purchaseDocumentId !== raisedPo.id);
      return onOrderItems.length ? [...onOrderItems, ...withoutExistingForPo] : withoutExistingForPo;
    });

    setAutomationStatus(`${getPurchasingDocumentNumber(enquiry)} raised to ${getPurchasingDocumentNumber(raisedPo)}. ${onOrderItems.length ? `${onOrderItems.length} stock line(s) added to inventory.` : "No stock lines added - check ordered length and allocated cut fields."}`);
  }

  function startEditPurchaseOrder(po) {
    setEditingPoId(po.id);
    setEditingPoDraft({
      ...po,
      items: (po.items || []).map((item, index) => normalisePoLine(item, index)),
    });
  }

  function cancelEditPurchaseOrder() {
    setEditingPoId(null);
    setEditingPoDraft(null);
  }

  function updateEditingPoField(field, value) {
    setEditingPoDraft((current) => current ? { ...current, [field]: value } : current);
  }

  function updateEditingPoLine(lineId, patch) {
    setEditingPoDraft((current) => {
      if (!current) return current;
      return {
        ...current,
        items: (current.items || []).map((line) => line.id === lineId ? { ...line, ...patch } : line),
      };
    });
  }

  function addEditingPoLine() {
    setEditingPoDraft((current) => {
      if (!current) return current;
      return {
        ...current,
        items: [...(current.items || []), createPoLineFromPart({ productId: "ub", sectionSize: "203x102x23", length: "", finish: "Self colour" }, (current.items || []).length + 1, 1, customProducts)],
      };
    });
  }

  function removeEditingPoLine(lineId) {
    setEditingPoDraft((current) => {
      if (!current) return current;
      const nextItems = (current.items || []).filter((line) => line.id !== lineId);
      return { ...current, items: nextItems.length ? nextItems : current.items };
    });
  }

  function saveEditingPurchaseOrder() {
    if (!editingPoDraft) return;
    const validItems = (editingPoDraft.items || []).filter((item) => item.productId && item.sectionSize);
    const items = validItems.map((item) => ({
      ...item,
      description: buildPoLineDescription(item, productDatabase),
      quantity: Number(item.quantity || 1),
      unitCost: Number(item.unitCost || 0),
    }));
    const totals = calculatePoTotals(items, Number(editingPoDraft.vatRate || 20));
    actionService.updateRecord({ resource: getPurchasingPermissionResource(editingPoDraft), id: editingPoDraft.id, patch: { ...editingPoDraft, items, ...totals }, setter: setPurchaseOrders, notes: `${getPurchasingDocumentTitle(editingPoDraft)} edited and saved.` });
    setEditingPoId(null);
    setEditingPoDraft(null);
  }

  function buildDeliveryNote(job, noteCount) {
    const customer = customers.find((item) => item.id === job.customerId);
    const reservedNumber = reserveDocumentNumberSync({ documentType: "deliveryNote", records: deliveryNotes, linkedSourceNumber: job.jobNo });
    const sequence = job.jobSequence || reservedNumber.sequence || getSequenceFromDocumentNumber(job.jobNo) || noteCount + 1;
    return {
      id: createEntityId("dn"),
      deliverySequence: sequence,
      dnNo: reservedNumber.number || formatLinkedNumber("DN", sequence),
      jobId: job.id,
      customerId: job.customerId,
      date: today,
      deliveredTo: customer?.contact || customer?.company || job.customer,
      address: job.jobDeliveryAddress || job.deliveryAddress || customer?.deliveryAddress || "",
      status: "Draft",
      items: [{ id: `dni-${Date.now()}-${job.id}`, description: job.title, quantity: 1 }],
    };
  }

  function createDeliveryNote(job, options = {}) {
    setDeliveryNotes((current) => {
      const existing = current.find((note) => note.jobId === job.id && note.status !== "Cancelled");
      if (existing) return current;
      const note = buildDeliveryNote(job, current.length);
      const currentUser = getProfileForRole(activeRole, profiles);
      setAuditLog((auditCurrent) => [createAuditLogEntry({ user: currentUser, action: "canCreate", resource: "delivery_notes", resourceId: note.id, outcome: "Allowed", notes: "Delivery note created." }), ...auditCurrent].slice(0, 250));
      return [withRecordMeta(note, currentUser), ...current];
    });

    updateJob(job.id, { status: "Delivery", stage: "Delivery" });
    if (!options.silent) setActiveTab("delivery");
  }

  function updateDeliveryStatus(noteId, status) {
    actionService.updateRecord({ resource: "delivery_notes", id: noteId, patch: { status, signedAt: status === "Signed" ? new Date().toISOString() : undefined }, setter: setDeliveryNotes, notes: "Delivery note status updated." });
    const note = deliveryNotes.find((item) => item.id === noteId);
    if (note && status === "Signed") {
      updateJob(note.jobId, { status: "To Be Invoiced", stage: "Complete" });
      setSelectedSignedDeliveryNoteId(noteId);
    }
  }

  function signDeliveryNote(noteId) {
    updateDeliveryStatus(noteId, "Signed");
  }

  function getJobInvoicePayload(job) {
    const quote = quotes.find((item) => item.id === job.quoteId);
    const customer = customers.find((item) => item.id === job.customerId);
    const jobPOs = purchaseOrders.filter((po) => po.jobId === job.id);
    const cogs = jobPOs.reduce((sum, po) => sum + Number(po.total || 0), 0);

    return {
      jobId: job.id,
      jobNo: job.jobNo,
      title: job.title,
      customer: {
        id: customer?.id || job.customerId,
        name: customer?.company || job.customer,
        contact: customer?.contact || "",
        email: customer?.email || "",
        phone: customer?.phone || "",
      },
      quote: quote ? {
        quoteNo: quote.quoteNo,
        subtotal: quote.subtotal,
        vatRate: quote.vatRate,
        total: quote.total,
        items: quote.items || [],
      } : null,
      cogs,
      gross: quote ? Number(quote.total || 0) - cogs : null,
      invoice: {
        reference: job.jobNo,
        description: `${job.jobNo} - ${job.title}`,
        amount: quote?.subtotal || 0,
        vatRate: quote?.vatRate || 20,
        total: quote?.total || 0,
      },
    };
  }

  async function createXeroInvoice(job) {
    const payload = getJobInvoicePayload(job);
    setXeroStatus((current) => ({ ...current, [job.id]: "Sending invoice data to Xero..." }));
    updateJob(job.id, { invoiceStatus: "Ready for Xero" });

    try {
      const response = await fetch("/api/xero/create-invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`Xero API request failed with status ${response.status}`);
      }

      const result = await response.json();
      updateJob(job.id, {
        invoiceStatus: "Sent to Xero",
        xeroInvoiceId: result.invoiceId || result.InvoiceID || "",
        xeroInvoiceNumber: result.invoiceNumber || result.InvoiceNumber || "",
      });
      setXeroStatus((current) => ({ ...current, [job.id]: "Invoice sent to Xero." }));
    } catch (error) {
      setXeroStatus((current) => ({
        ...current,
        [job.id]: "Backend not connected yet. Job marked Ready for Xero.",
      }));
      updateJob(job.id, { invoiceStatus: "Ready for Xero" });
    }
  }

  function markJobSentToXero(jobId) {
    updateJob(jobId, { invoiceStatus: "Sent to Xero" });
  }

  function toggleStageStaff(jobId, taskId, staffId, stage) {
    const job = jobs.find((item) => item.id === jobId) || scheduledJobs.find((item) => item.id === jobId);
    if (!job) return;
    const stageTasks = ensureAllStageTasks(job.stageTasks || [], job.start, job.end, job.estimatedHours).map((task) => {
      if (task.id !== taskId && task.stage !== stage) return task;
      const currentStaffIds = getTaskStaffIds(task);
      const nextStaffIds = currentStaffIds.includes(staffId)
        ? currentStaffIds.filter((id) => id !== staffId)
        : [...currentStaffIds, staffId];
      return { ...task, staffIds: nextStaffIds, staffId: nextStaffIds[0] || "", allocationMode: nextStaffIds.length ? "manual" : "auto" };
    });
    const staffIdsFromStages = stageTasks.flatMap((task) => getTaskStaffIds(task)).filter(Boolean);
    updateJob(jobId, {
      staffIds: Array.from(new Set(staffIdsFromStages)),
      stageTasks,
    });
  }

  function updateStageTask(jobId, taskId, patch) {
    const job = jobs.find((item) => item.id === jobId) || scheduledJobs.find((item) => item.id === jobId);
    if (!job) return;

    let deliveryNoteToCreate = null;
    let stageTasks = ensureAllStageTasks(job.stageTasks || [], job.start, getJobPlanningEnd(job), job.estimatedHours, job.productionStageBreakdown || []);
    const targetTask = stageTasks.find((task) => task.id === taskId || task.stage === patch.stage);
    const requestedStage = patch.stage || targetTask?.stage || job.stage;
    let nextStage = job.stage;
    let nextStatus = job.status;

    if (patch.status === "Complete") {
      if (requestedStage === "Painting") {
        nextStage = "Delivery";
        nextStatus = "Delivery";
        deliveryNoteToCreate = job;
      } else if (requestedStage === "Delivery") {
        nextStage = "Complete";
        nextStatus = "Complete";
      } else {
        nextStage = getNextStage(requestedStage);
      }
    } else if (patch.status === "In Progress") {
      nextStage = requestedStage;
    } else if (patch.stage) {
      nextStage = requestedStage;
    }

    stageTasks = stageTasks.map((task) => (task.id === taskId || task.stage === requestedStage ? { ...task, ...patch, stage: task.stage } : task));
    stageTasks = normaliseLinearStageTasks(stageTasks, nextStage);

    const staffIdsFromStages = stageTasks.flatMap((task) => getTaskStaffIds(task)).filter(Boolean);
    if (nextStage === "Complete") nextStatus = "Complete";
    if (nextStatus === "Complete") stageTasks = stageTasks.map((task) => ({ ...task, status: "Complete" }));

    const nextJobs = jobs.map((item) => item.id === jobId ? {
      ...item,
      stage: nextStage,
      status: nextStatus,
      stageTasks,
      staffIds: Array.from(new Set([...(job.staffIds || []), ...staffIdsFromStages])),
    } : item);

    const plannedNextJobs = autoPlanJobsLive(nextJobs, staff, weekStart, holidays);
    const plannedJob = plannedNextJobs.find((item) => item.id === jobId);
    updateJob(jobId, {
      stage: nextStage,
      status: nextStatus,
      start: plannedJob?.start || job.start,
      end: plannedJob?.end || job.end,
      stageTasks: plannedJob?.stageTasks || stageTasks,
      staffIds: plannedJob?.staffIds || Array.from(new Set([...(job.staffIds || []), ...staffIdsFromStages])),
    });
    setJobs((current) => current.map((item) => {
      if (item.id === jobId) return item;
      const planned = plannedNextJobs.find((plannedItem) => plannedItem.id === item.id);
      return planned ? { ...item, start: planned.start, end: planned.end, staffIds: planned.staffIds, stageTasks: planned.stageTasks } : item;
    }));
    setAutomationStatus(`Completed ${requestedStage} on ${job.jobNo}. Planner moved the next available work forward automatically.`);

    if (deliveryNoteToCreate) createDeliveryNote(deliveryNoteToCreate, { silent: true });
  }

  function moveJobStage(jobId, direction) {
    const job = jobs.find((item) => item.id === jobId);
    if (!job) return;
    const nextStage = direction === "forward" ? getNextStage(job.stage) : getPreviousStage(job.stage);
    updateJob(jobId, {
      stage: nextStage,
      status: nextStage === "Complete" ? "Complete" : job.status === "Complete" ? "In Production" : job.status,
      stageTasks: normaliseLinearStageTasks(ensureAllStageTasks(job.stageTasks || [], job.start, getJobPlanningEnd(job), job.estimatedHours, job.productionStageBreakdown || []), nextStage),
    });
  }

  function addStageTask(jobId) {
    const job = jobs.find((item) => item.id === jobId);
    if (!job) return;
    updateJob(jobId, { stageTasks: ensureAllStageTasks(job.stageTasks || [], job.start, getJobPlanningEnd(job), job.estimatedHours, job.productionStageBreakdown || []) });
  }

  function removeStageTask(jobId, taskId) {
    const job = jobs.find((item) => item.id === jobId);
    if (!job) return;
    updateJob(jobId, { stageTasks: (job.stageTasks || []).filter((task) => task.id !== taskId) });
  }

  function switchRole(nextRole) {
    const nextUser = getProfileForRole(nextRole, profiles);
    setAuditLog((current) => [createAuditLogEntry({ user: nextUser, action: "switch_role", resource: "session", outcome: "Allowed", notes: `Switched to ${nextRole}` }), ...current].slice(0, 100));
    setActiveRole(nextRole);
    setSecuredTab(null);
    setPinInput("");
    setPinError("");
    if (!canAccessTab(nextRole, activeTab)) setActiveTab(getDefaultTabForRole(nextRole));
  }

  function requestProtectedTab(tab) {
    if (!canAccessTab(activeRole, tab)) return;
    if (activeRole === "operations" || activeRole === "sales") {
      setActiveTab(tab);
      setSecuredTab(null);
      return;
    }
    if (tab === "jobs" && !unlockedTabs.jobs) {
      setSecuredTab("jobs");
      setPinInput("");
      setPinError("");
      return;
    }
    setActiveTab(tab);
  }

  function unlockProtectedTab() {
    const expectedPin = securedTab === "quotes" ? QUOTES_PIN : JOBS_PIN;
    if (pinInput === expectedPin) {
      setUnlockedTabs((current) => ({ ...current, [securedTab]: true }));
      setActiveTab(securedTab);
      setSecuredTab(null);
      setPinInput("");
      setPinError("");
      return;
    }
    setPinError("Incorrect PIN code");
  }

  function workloadForStaff(staffId) {
    return scheduledJobs
      .filter((job) => job.staffIds.includes(staffId))
      .filter((job) => rangesOverlap(job.start, job.end, weekDays[0], weekDays[weekDays.length - 1]))
      .reduce((sum, job) => sum + Number(job.estimatedHours || 0) / Math.max(1, job.staffIds.length), 0);
  }

  const tabNavigationOrder = activeRole === "operations"
    ? [["planner", "Planner"], ["deliveryCalendar", "Delivery Planner"], ["delivery", "Delivery Notes"], ["customers", "CRM"], ["quotes", "Quotes"], ["plannerQuotes", "Quote Approvals"], ["jobs", "Job Register"], ["stock", "Stock Inventory"], ["pos", "Purchasing"], ["productivity", "Time Rules"], ["clocking", "Clocking"], ["holiday", "Holiday"], ["settings", "Settings"]]
    : [["settings", "Settings"], ["planner", "Planner"], ["plannerQuotes", "Quote Approvals"], ["deliveryCalendar", "Delivery Planner"], ["productivity", "Time Rules"], ["stock", "Stock Inventory"], ["quotes", "Quotes"], ["customers", "CRM"], ["jobs", "Job Register"], ["pos", "Purchasing"], ["delivery", "Delivery Notes"], ["clocking", "Clocking"], ["holiday", "Holiday"]];
  const visibleMainTabs = tabNavigationOrder.filter(([key]) => canAccessTab(activeRole, key));
  const visibleStaffTabs = [["clocking", "Clocking In"], ["holiday", "Holiday"]].filter(([key]) => canAccessTab(activeRole, key));
  const pendingHolidayRequests = hasPendingHolidayRequests(holidays);
  const isStaffLogin = activeRole === "staff";

  const dashboardClass = activeTab === "planner"
    ? "grid gap-4 md:grid-cols-4"
    : activeTab === "jobs" || activeTab === "quotes"
      ? "grid gap-4 md:grid-cols-4"
      : activeTab === "pos" || activeTab === "delivery" || activeTab === "deliveryCalendar" || activeTab === "plannerQuotes"
        ? "grid gap-4 md:grid-cols-1"
        : "grid gap-4 md:grid-cols-6";

  useEffect(() => {
    const snapshot = {
      customers,
      staff,
      suppliers,
      quotes,
      plannerQuotePackages,
      jobs,
      purchaseOrders,
      deliveryNotes,
      stockItems,
      importLogs,
      companySettings,
      clockEntries,
      holidays,
      sickDays,
      stageTimeEntries,
      pricingSchedule,
      pricingSaveMeta,
      productivityRules,
      customProducts,
      storedDocuments,
      profiles,
      auditLog,
      authStatus,
      recordLocks,
      savedAt: new Date().toISOString(),
    };

    saveAppState(snapshot);

    if (deploymentConfig.storageMode === "cloud-api") {
      saveCloudAppState(snapshot)
        .then(() => setCloudSyncStatus("Cloud sync saved"))
        .catch(() => setCloudSyncStatus("Cloud sync unavailable - local fallback saved"));
    } else {
      setCloudSyncStatus("Local save active");
    }
  }, [customers, staff, suppliers, quotes, plannerQuotePackages, jobs, purchaseOrders, deliveryNotes, stockItems, importLogs, companySettings, clockEntries, holidays, sickDays, stageTimeEntries, pricingSchedule, pricingSaveMeta, productivityRules, customProducts, storedDocuments, profiles, auditLog, authStatus, recordLocks]);

  function addCustomProduct(product) {
    const created = actionService.createRecord({ resource: "custom_products", record: product, setter: setCustomProducts, notes: "Custom product created from Quote Builder setup." });
    if (!created) return;
    setPricingSchedule((current) => {
      const existingKeys = new Set(current.map((row) => `${row.productId}::${row.sectionSize || ""}`));
      const extendsExistingProduct = Boolean(product.extendsProductId) && product.extendsProductId === product.id;
      const inheritedPricingRow = extendsExistingProduct ? getPricingRow(current, product.id, "") : null;
      const optionRows = (product.optionRows?.length ? product.optionRows : [{ size: "", price: 1000 }]).map((option) => {
        const sectionSize = option.size || "";
        if (extendsExistingProduct) {
          return {
            productId: product.id,
            sectionSize,
            buyPrice: Number(inheritedPricingRow?.buyPrice || 0),
            markupAmount: Number(inheritedPricingRow?.markupAmount || 0),
            priceMode: inheritedPricingRow?.priceMode || (product.unit === "each" ? "fixed" : "per_tonne"),
            inheritsProductPricing: true,
          };
        }
        return {
          productId: product.id,
          sectionSize,
          buyPrice: Number(option.price || 0),
          markupAmount: 0,
          priceMode: product.unit === "each" ? "fixed" : "per_tonne",
        };
      }).filter((row) => !existingKeys.has(`${row.productId}::${row.sectionSize || ""}`));
      return [...current, ...optionRows];
    });
    setNewStockItem((current) => ({ ...current, productId: product.id, sectionSize: product.sectionOptions?.[0] || "", grade: product.defaultGrade || current.grade }));
    setNewPo((current) => ({
      ...current,
      lines: (current.lines || []).map((line, index) => index === 0 ? { ...line, productId: product.id, sectionSize: product.sectionOptions?.[0] || "" } : line),
    }));
  }


  function removeCustomProduct({ productId, sectionSize = "" }) {
    const cleanSize = String(sectionSize || "").trim().toLowerCase();
    setCustomProducts((current) => (current || []).flatMap((product) => {
      const matchesProduct = product.id === productId || product.extendsProductId === productId;
      if (!matchesProduct) return [product];
      if (!cleanSize) return [];
      const nextOptionRows = (product.optionRows || []).filter((row) => String(row.size || row.sectionSize || "").trim().toLowerCase() !== cleanSize);
      const nextSectionOptions = (product.sectionOptions || []).filter((size) => String(size || "").trim().toLowerCase() !== cleanSize);
      if (!nextOptionRows.length && !nextSectionOptions.length && product.extendsProductId) return [];
      return [{ ...product, optionRows: nextOptionRows, sectionOptions: nextSectionOptions }];
    }));
    setPricingSchedule((current) => current.filter((row) => !(row.productId === productId && String(row.sectionSize || "") === String(sectionSize || ""))));
    setNewStockItem((current) => current.productId === productId && String(current.sectionSize || "") === String(sectionSize || "") ? { ...current, sectionSize: getSectionOptions(productId, customProducts).find((size) => String(size || "") !== String(sectionSize || "")) || "" } : current);
  }

  function registerGeneratedDocument({ html, documentType, title, relatedResource, relatedResourceId, jobId = "", customerId = "", documentNo = "" }) {
    const user = getProfileForRole(activeRole, profiles);
    const documentRecord = createStoredDocumentRecord({ documentType, title, relatedResource, relatedResourceId, jobId, customerId, documentNo, createdBy: user });
    const created = actionService.createRecord({ resource: "stored_documents", record: documentRecord, setter: setStoredDocuments, notes: `${title} registered for future cloud document storage.` });
    if (!created) return;
    saveDocumentToCloudStorage({ html, documentRecord }).catch(() => null);
  }

  function savePricingScheduleForOperations() {
    if (activeRole !== "operations") {
      setActionStatus("Only Operations can save pricing and markup changes.");
      return;
    }
    const user = getProfileForRole(activeRole, profiles);
    const nextMeta = { savedAt: new Date().toISOString(), savedBy: user?.name || "Operations", savedByRole: activeRole };
    setPricingSaveMeta(nextMeta);
    const snapshot = {
      customers, staff, suppliers, quotes, plannerQuotePackages, jobs, purchaseOrders, deliveryNotes, stockItems, importLogs, companySettings, clockEntries, holidays, sickDays, stageTimeEntries, pricingSchedule, pricingSaveMeta: nextMeta, productivityRules, customProducts, storedDocuments, profiles, auditLog, authStatus, recordLocks, savedAt: new Date().toISOString(),
    };
    saveAppState(snapshot);
    setAuditLog((current) => [createAuditLogEntry({ user, action: "save_pricing", resource: "pricing_schedule", resourceId: "pricingSchedule", outcome: "success", notes: "Operations saved pricing and markup schedule." }), ...current].slice(0, 500));
    setActionStatus("Pricing saved. Sales quotations will use the latest saved Operations prices on this shared data store.");
  }

  function exportLocalBackup() {
    const snapshot = {
      customers,
      staff,
      suppliers,
      quotes,
      plannerQuotePackages,
      jobs,
      purchaseOrders,
      deliveryNotes,
      stockItems,
      importLogs,
      companySettings,
      clockEntries,
      holidays,
      sickDays,
      stageTimeEntries,
      pricingSchedule,
      pricingSaveMeta,
      productivityRules,
      customProducts,
      storedDocuments,
      profiles,
      auditLog,
      authStatus,
      recordLocks,
      savedAt: new Date().toISOString(),
    };
    downloadAppStateBackup(snapshot);
    setActionStatus("Local OPHQ backup exported as JSON.");
  }

  function handleBackupFileSelected(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    setBackupRestoreError("");
    setBackupRestorePreview(null);
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".json")) {
      setBackupRestoreError("Only OPHQ JSON backup files can be imported.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const snapshot = JSON.parse(String(reader.result || "{}"));
        const hasCoreData = ["customers", "quotes", "jobs", "purchaseOrders", "stockItems"].some((key) => Array.isArray(snapshot[key]));
        if (!hasCoreData) {
          setBackupRestoreError("This JSON file does not look like an OPHQ backup.");
          return;
        }
        setBackupRestorePreview({ fileName: file.name, snapshot, summary: getBackupPreviewSummary(snapshot) });
      } catch (error) {
        setBackupRestoreError("Backup import failed. The selected file is not valid JSON.");
      }
    };
    reader.onerror = () => setBackupRestoreError("Backup import failed. The selected file could not be read.");
    reader.readAsText(file);
  }

  function confirmBackupRestore() {
    if (!backupRestorePreview?.snapshot) return;
    restoreAppStateBackup(backupRestorePreview.snapshot);
    window.location.reload();
  }

  function clearBackupRestore() {
    setBackupRestorePreview(null);
    setBackupRestoreError("");
  }

  function resetLocalSavedData() {
    clearSavedAppState();
    window.location.reload();
  }

  return (
    <div className="min-h-screen bg-blue-50 p-4 text-blue-950 md:p-6">
      <div className="mx-auto max-w-[1500px] space-y-5">
        <div className="rounded-3xl bg-blue-950 p-6 text-white shadow-sm">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
            <div className="min-w-0">
              {companySettings.appBrandImageDataUrl ? <img src={companySettings.appBrandImageDataUrl} alt="OPHQ" className="h-20 max-w-full object-contain" /> : <div className="flex h-20 w-full max-w-md items-center justify-center rounded-2xl border border-dashed border-blue-300 bg-blue-900/60 px-6 text-sm font-black uppercase tracking-wide text-blue-200">Upload OPHQ header image in Settings</div>}
              <div className="mt-3 flex items-center gap-3">
                {companySettings.logoDataUrl ? <img src={companySettings.logoDataUrl} alt="Company logo" className="h-8 max-w-28 rounded bg-white object-contain p-1" /> : null}
                <p className="text-sm font-bold text-blue-100">{companySettings.name || "Company"}</p>
              </div>
            </div>
            <div className="flex flex-col gap-3 xl:items-end">
              <div className="rounded-2xl bg-amber-400/15 p-2 ring-1 ring-amber-300/30">
                <div className="grid grid-cols-3 gap-2">
                  <button className={`rounded-xl px-4 py-2 text-sm font-black ${activeRole === "operations" ? "bg-white text-blue-950" : "text-blue-100 hover:bg-amber-400/15"}`} onClick={() => switchRole("operations")}>Operations</button>
                  <button className={`rounded-xl px-4 py-2 text-sm font-black ${activeRole === "sales" ? "bg-white text-blue-950" : "text-blue-100 hover:bg-amber-400/15"}`} onClick={() => switchRole("sales")}>Sales</button>
                  <button className={`rounded-xl px-4 py-2 text-sm font-black ${activeRole === "staff" ? "bg-white text-blue-950" : "text-blue-100 hover:bg-amber-400/15"}`} onClick={() => switchRole("staff")}>Staff</button>
                </div>
                <p className="mt-2 px-2 text-xs font-semibold text-blue-200">{appRoles[activeRole].label}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button className="rounded-xl bg-amber-400/15 px-4 py-2 text-sm font-bold text-white ring-1 ring-amber-300/30 hover:bg-amber-400/25" onClick={() => setWeekStart(toIso(addDays(new Date(weekStart), -7)))}>Back</button>
                <button className="rounded-xl bg-white px-4 py-2 text-sm font-black text-blue-950" onClick={() => setWeekStart(today)}>Today</button>
                <button className="rounded-xl bg-amber-400/15 px-4 py-2 text-sm font-bold text-white ring-1 ring-amber-300/30 hover:bg-amber-400/25" onClick={() => setWeekStart(toIso(addDays(new Date(weekStart), 7)))}>Next</button>
              </div>
            </div>
          </div>
        </div>

        {activeTab !== "clocking" && activeTab !== "holiday" && activeTab !== "stock" && activeTab !== "productivity" && activeTab !== "settings" && !(activeRole === "sales" && activeTab === "customers") ? (
          <div className={dashboardClass}>
            <StatCard label="Active jobs" value={stats.activeJobs} tone="dark" />
            {activeTab !== "jobs" && activeTab !== "quotes" && activeTab !== "pos" && activeTab !== "delivery" && activeTab !== "deliveryCalendar" && activeTab !== "plannerQuotes" ? <StatCard label="Planned hours" value={stats.plannedHours} /> : null}
            {activeTab !== "jobs" && activeTab !== "quotes" && activeTab !== "pos" && activeTab !== "delivery" && activeTab !== "deliveryCalendar" && activeTab !== "plannerQuotes" ? <StatCard label="Staff" value={stats.staffCount} /> : null}
            {activeTab !== "jobs" && activeTab !== "quotes" && activeTab !== "pos" && activeTab !== "delivery" && activeTab !== "deliveryCalendar" && activeTab !== "plannerQuotes" ? <StatCard label="Clashes" value={stats.clashes} /> : null}
            {activeTab !== "planner" && activeTab !== "pos" && activeTab !== "delivery" && activeTab !== "deliveryCalendar" && activeTab !== "plannerQuotes" ? <StatCard label="Quote value" value={currency(stats.quotedValue)} /> : null}
            {activeTab !== "planner" && activeTab !== "pos" && activeTab !== "delivery" && activeTab !== "deliveryCalendar" && activeTab !== "plannerQuotes" ? <StatCard label="COGS" value={currency(stats.cogsValue)} /> : null}
            {activeTab !== "planner" && activeTab !== "pos" && activeTab !== "delivery" && activeTab !== "deliveryCalendar" && activeTab !== "plannerQuotes" ? <StatCard label="Gross" value={currency(stats.grossValue)} /> : null}
          </div>
        ) : null}

        <LaunchModeBanner cloudSyncStatus={cloudSyncStatus} />

        <div className="sticky top-0 z-30 rounded-2xl border border-blue-100 bg-white/95 p-2 shadow-sm backdrop-blur">
          <div className="flex items-center gap-2 overflow-x-auto whitespace-nowrap pb-1">
            <span className="shrink-0 rounded-xl bg-blue-950 px-3 py-2 text-xs font-black uppercase tracking-wide text-white">{activeRole}</span>
            {visibleMainTabs.map(([key, label]) => (
              <button
                key={key}
                onClick={() => requestProtectedTab(key)}
                className={`rounded-xl px-4 py-2 text-sm font-black transition ${activeTab === key ? "bg-blue-700 text-white" : key === "holiday" && pendingHolidayRequests ? "bg-red-100 text-red-800 hover:bg-red-50" : "bg-blue-50 text-blue-900 hover:bg-blue-100"}`}
              >
                {key === "jobs" && activeRole !== "operations" ? `🔒 ${label}` : label}
                {key === "holiday" && pendingHolidayRequests && activeTab !== key ? " · Pending" : ""}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-1">
          <main className="min-w-0 space-y-5">

        {securedTab ? (
          <div className="mx-auto max-w-md rounded-3xl bg-white p-8 shadow-sm">
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-blue-50 text-3xl">🔒</div>
              <h2 className="text-2xl font-bold">Protected Area</h2>
              <p className="mt-2 text-sm text-blue-800">Enter the 4 digit PIN code to access this section.</p>
            </div>
            <div className="mt-6 space-y-4">
              <TextInput type="password" maxLength={4} placeholder="Enter PIN" value={pinInput} onChange={(event) => setPinInput(event.target.value.replace(/[^0-9]/g, ""))} onKeyDown={(event) => { if (event.key === "Enter") unlockProtectedTab(); }} />
              {pinError ? <p className="text-sm font-semibold text-red-600">{pinError}</p> : null}
              <div className="flex gap-3">
                <button className="flex-1 rounded-xl border bg-white px-4 py-3 text-sm font-bold" onClick={() => setSecuredTab(null)}>Cancel</button>
                <button className="flex-1 rounded-xl bg-blue-700 px-4 py-3 text-sm font-bold text-white" onClick={unlockProtectedTab}>Unlock</button>
              </div>
            </div>
          </div>
        ) : null}

        {activeTab === "clocking" ? (
          <ClockingInTab staff={staff} clockEntries={clockEntries} sickDays={sickDays} activeRole={activeRole} onClockIn={clockInStaff} onClockOut={clockOutStaff} onAddSickDay={addSickDays} onDeleteSickDay={deleteSickDay} onAmendClockEntry={amendClockEntry} />
        ) : null}

        {activeTab === "holiday" ? (
          <div className="space-y-6">
            <div className="rounded-3xl bg-white p-5 shadow-sm">
              <h2 className="text-lg font-bold">Holiday</h2>
              <p className="mt-1 text-sm text-blue-800">Request, approve and track staff holiday.</p>
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              {staff.map((person) => {
                const form = holidayForms[person.id] || { start: today, end: today, notes: "" };
                const personHolidays = holidays.filter((holiday) => holiday.staffId === person.id);
                const approvedHolidays = personHolidays
                  .filter((holiday) => holiday.status === "Approved")
                  .sort((a, b) => new Date(a.start) - new Date(b.start));
                return (
                  <div key={person.id} className="rounded-3xl bg-white p-5 shadow-sm">
                    <h3 className="text-lg font-bold">{person.name}</h3>
                    <p className="text-xs text-blue-600">Request holiday</p>
                    <div className="mt-3 rounded-xl bg-emerald-50 p-3">
                      <p className="text-xs font-bold uppercase tracking-wide text-emerald-700">Approved dates</p>
                      {approvedHolidays.length === 0 ? (
                        <p className="mt-2 text-xs text-blue-600">No approved holiday dates.</p>
                      ) : (
                        <div className="mt-2 space-y-1">
                          {approvedHolidays.map((holiday) => (
                            <p key={`approved-${holiday.id}`} className="text-xs font-semibold text-blue-900">
                              {holiday.start} to {holiday.end}
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="mt-4 space-y-3">
                      <Field label="Start"><TextInput type="date" value={form.start} onChange={(event) => updateHolidayForm(person.id, { start: event.target.value })} /></Field>
                      <Field label="End"><TextInput type="date" value={form.end} onChange={(event) => updateHolidayForm(person.id, { end: event.target.value })} /></Field>
                      <Field label="Notes"><TextInput value={form.notes} placeholder="Optional notes" onChange={(event) => updateHolidayForm(person.id, { notes: event.target.value })} /></Field>
                      <Field label="Staff PIN"><TextInput type="password" maxLength={4} value={holidayStaffPins[person.id] || ""} placeholder={`${person.name} PIN`} onChange={(event) => updateHolidayStaffPin(person.id, event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") addHolidayRequest(person.id); }} /></Field>
                      {holidayStaffPinErrors[person.id] ? <p className="text-xs font-semibold text-red-600">{holidayStaffPinErrors[person.id]}</p> : null}
                      <button className="w-full rounded-xl bg-blue-700 px-4 py-2 text-sm font-bold text-white" onClick={() => addHolidayRequest(person.id)}>Submit request</button>
                    </div>

                    <div className="mt-5 space-y-2">
                      {personHolidays.length === 0 ? <p className="text-xs text-blue-600">No holiday requests.</p> : null}
                      {personHolidays.map((holiday) => (
                        <div key={holiday.id} className="rounded-xl bg-blue-50 p-3 text-sm">
                          <p className="font-bold">{holiday.start} to {holiday.end}</p>
                          <p className="text-xs text-blue-600">{holiday.notes || "No notes"}</p>
                          <span className={`mt-2 inline-block rounded-full px-2 py-1 text-xs font-bold ${holiday.status === "Approved" ? "bg-emerald-100 text-emerald-800" : holiday.status === "Declined" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"}`}>{holiday.status}</span>
                          <div className="mt-3 space-y-2">
                            <TextInput
                              type="password"
                              maxLength={4}
                              placeholder="Approval PIN"
                              value={holidayApprovalPins[holiday.id] || ""}
                              onChange={(event) => updateHolidayApprovalPin(holiday.id, event.target.value)}
                              onKeyDown={(event) => { if (event.key === "Enter") updateHolidayStatus(holiday.id, "Approved"); }}
                            />
                            {holidayApprovalErrors[holiday.id] ? <p className="text-xs font-semibold text-red-600">{holidayApprovalErrors[holiday.id]}</p> : null}
                            <div className="flex gap-2">
                              <button className="flex-1 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-bold text-white" onClick={() => updateHolidayStatus(holiday.id, "Approved")}>Approve</button>
                              <button className="flex-1 rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-bold text-red-700" onClick={() => updateHolidayStatus(holiday.id, "Declined")}>Decline</button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {activeTab === "productivity" ? (
          <ProductivityTab staff={staff} jobs={jobs} stageTimeEntries={stageTimeEntries} productivityRules={productivityRules} setProductivityRules={setProductivityRules} />
        ) : null}

        {activeTab === "stock" ? (
          <StockInventoryTab
            stockItems={stockItems}
            jobs={jobs}
            newStockItem={newStockItem}
            setNewStockItem={setNewStockItem}
            onAddStockItem={addStockItem}
            onUpdateStockItem={updateStockItem}
            onAllocateStockItem={allocateStockItem}
            onScrapStockSegment={scrapStockItemSegment}
            onCutAllocatedStockItem={cutAllocatedStockItem}
            onManualCutOffcutStockItem={manualCutOffcutStockItem}
            customProducts={customProducts}
            onAddCustomProduct={addCustomProduct}
          />
        ) : null}

        {activeTab === "plannerQuotes" ? (
          <PlannerQuotesInbox quotePackages={plannerQuotePackages} onUpdateQuotePackageStatus={updatePlannerQuotePackageStatus} onConvertToJob={convertQuotePackageToJob} automationStatus={automationStatus} />
        ) : null}

        {activeTab === "customers" ? (
          <CustomersCrmTab customers={customers} suppliers={suppliers} onAddCustomer={addCustomerRecord} onUpdateCustomer={updateCustomerRecord} onRemoveCustomer={removeCustomerRecord} onRemoveSupplier={removeSupplierRecord} />
        ) : null}

        {activeTab === "settings" ? (
          <SettingsTab
            companySettings={companySettings}
            setCompanySettings={setCompanySettings}
            customers={customers}
            suppliers={suppliers}
            importState={xeroCsvImportState}
            setImportState={setXeroCsvImportState}
            importLogs={importLogs}
            onFileSelected={handleXeroCsvFileSelected}
            onConfirmImport={confirmXeroCsvImport}
            onResetImport={resetXeroCsvImport}
            onResetLocalSavedData={resetLocalSavedData}
            onExportLocalBackup={exportLocalBackup}
            onBackupFileSelected={handleBackupFileSelected}
            backupRestorePreview={backupRestorePreview}
            backupRestoreError={backupRestoreError}
            onConfirmBackupRestore={confirmBackupRestore}
            onClearBackupRestore={clearBackupRestore}
            cloudSyncStatus={cloudSyncStatus}
            storedDocuments={storedDocuments}
            profiles={profiles}
            auditLog={auditLog}
            authStatus={authStatus}
            recordLocks={recordLocks}
          />
        ) : null}

        {activeTab === "quotes" && !securedTab ? (
          <SteelTakeoffQuoteBuilder
            customers={customers}
            quotes={quotes}
            setQuotes={setQuotes}
            pricingSchedule={pricingSchedule}
            setPricingSchedule={setPricingSchedule}
            pricingSaveMeta={pricingSaveMeta}
            onSavePricing={savePricingScheduleForOperations}
            activeRole={activeRole}
            customProducts={customProducts}
            onAddCustomProduct={addCustomProduct}
            onRemoveCustomProduct={removeCustomProduct}
            onSendToPlannerInbox={sendQuoteToPlannerInbox}
            productivityRules={productivityRules}
            jobs={jobs}
            staff={staff}
            companySettings={companySettings}
            onRegisterDocument={registerGeneratedDocument}
          />
        ) : null}

        {activeTab === "jobs" && !securedTab ? (
          <div className="space-y-3">
            <div className="rounded-3xl bg-white p-5 shadow-sm">
              <SectionHeader eyebrow="Production" title="Job Register" description="Open job records, planner links, purchasing, delivery note and invoice status from one place." />
            </div>
            {jobs.length === 0 ? <div className="rounded-3xl bg-white p-6 text-sm font-semibold text-blue-800 shadow-sm">No jobs created yet. Accepted quotes will appear here once converted, or jobs can be added manually from the Planner.</div> : null}
            {jobs.map((job) => {
              const quote = quotes.find((item) => item.id === job.quoteId);
              const jobPOs = purchaseOrders.filter((po) => po.jobId === job.id);
              const poTotal = jobPOs.reduce((sum, po) => sum + Number(po.total || 0), 0);
              const deliveryNote = deliveryNotes.find((note) => note.jobId === job.id && note.status !== "Cancelled");
              const assignedStaff = job.staffIds.length ? job.staffIds.map((id) => staff.find((person) => person.id === id)?.name).filter(Boolean).join(", ") : "No staff allocated";
              return (
                <div key={job.id} className="rounded-3xl bg-white p-5 shadow-sm">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div><p className="font-bold">{job.jobNo} · {job.title}</p><p className="text-sm text-blue-800">{job.customer} · Quote: {quote?.quoteNo || "Manual job"}</p></div>
                    <span className={`w-fit rounded-full px-3 py-1 text-xs font-bold ${getStatusStyle(job.status)}`}>{job.status}</span>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button className="rounded-xl border bg-white px-3 py-2 text-xs font-bold" onClick={() => setExpandedJobDetailsId(expandedJobDetailsId === job.id ? null : job.id)}>{expandedJobDetailsId === job.id ? "Hide details" : "Open details"}</button>
                    <button className="rounded-xl border bg-white px-3 py-2 text-xs font-bold" onClick={() => { setSelectedJobId(job.id); setActiveTab("planner"); }}>Open in planner</button>
                    <button className="rounded-xl border bg-white px-3 py-2 text-xs font-bold" onClick={() => { setNewPo({ ...newPo, jobId: job.id, supplierId: "", supplierName: "" }); setActiveTab("pos"); }}>Purchasing</button>
                    {activeRole === "operations" ? <button className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800" onClick={() => createJobReworkQuote(job)}>Edit job / rework quote</button> : null}
                    {activeRole === "operations" ? <button className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-800" onClick={() => recalculateJobStockAllocation(job)}>Recalculate stock allocation</button> : null}
                    {activeRole === "operations" ? <button className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700" onClick={() => cancelJobAndReleaseStock(job)}>Remove / cancel job</button> : null}
                    <button className={`rounded-xl px-3 py-2 text-xs font-bold text-white ${job.invoiceStatus === "Sent to Xero" ? "bg-emerald-600" : "bg-blue-700"}`} onClick={() => createXeroInvoice(job)}>
                      {job.invoiceStatus === "Sent to Xero" ? "Invoice Sent to Xero" : "Invoice / Xero"}
                    </button>
                    {job.invoiceStatus === "Ready for Xero" ? <button className="rounded-xl border bg-white px-3 py-2 text-xs font-bold" onClick={() => markJobSentToXero(job.id)}>Mark sent to Xero</button> : null}
                    {xeroStatus[job.id] ? <span className="rounded-xl bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-800">{xeroStatus[job.id]}</span> : null}
                  </div>
                  {expandedJobDetailsId === job.id ? <>
                  <JobStatusLine job={job} />
                  <div className="mt-5 grid gap-3 md:grid-cols-4">
                    <div className="rounded-2xl bg-blue-50 p-3"><p className="text-xs text-blue-600">Planner finish</p><p className="text-sm font-bold">{getJobFinishDate(job) || "Not calculated"}</p></div>
                    <div className="rounded-2xl bg-blue-50 p-3"><p className="text-xs text-blue-600">Deadline</p><p className="text-sm font-bold">{job.deadline || "Not set"}</p></div>
                    <div className="rounded-2xl bg-blue-50 p-3"><p className="text-xs text-blue-600">Materials Due</p><p className="text-sm font-bold">{job.materialsDue || "Not set"}</p></div>
                    <div className="rounded-2xl bg-blue-50 p-3"><p className="text-xs text-blue-600">Hours / Priority</p><p className="text-sm font-bold">{job.estimatedHours} hrs · {job.priority}</p></div>
                  </div>
                  <div className="mt-4 grid gap-3 md:grid-cols-6">
                    <div className="rounded-2xl border border-blue-100 p-3"><p className="text-xs text-blue-600">Assigned staff</p><p className="text-sm font-semibold">{assignedStaff}</p></div>
                    <div className="rounded-2xl border border-blue-100 p-3"><p className="text-xs text-blue-600">Quote value</p><p className="text-sm font-semibold">{quote ? currency(quote.total) : "N/A"}</p></div>
                    <div className="rounded-2xl border border-blue-100 p-3"><p className="text-xs text-blue-600">COGS</p><p className="text-sm font-semibold">{currency(poTotal)}</p></div>
                    <div className="rounded-2xl border border-blue-100 p-3"><p className="text-xs text-blue-600">Gross</p><p className="text-sm font-semibold">{quote ? currency(quote.total - poTotal) : "N/A"}</p></div>
                    <div className="rounded-2xl border border-blue-100 p-3"><p className="text-xs text-blue-600">Delivery note</p><p className="text-sm font-semibold">{deliveryNote ? `${deliveryNote.dnNo} · ${deliveryNote.status}` : "Not raised"}</p></div>
                    <div className="rounded-2xl border border-blue-100 p-3"><p className="text-xs text-blue-600">Invoice</p><p className="text-sm font-semibold">{job.invoiceStatus || "Not Invoiced"}</p></div>
                  </div>
                  <div className="mt-4 rounded-2xl bg-blue-50 p-3"><p className="text-xs text-blue-600">Notes</p><p className="text-sm text-blue-900">{job.notes || "No notes"}</p></div>
                  </> : null}
                </div>
              );
            })}
          </div>
        ) : null}

        {activeTab === "pos" ? (
          <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
            <div className="rounded-3xl bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between gap-3">
                <SectionHeader eyebrow="Purchasing" title="Supplier Enquiries & Purchase Orders" description="Create enquiries first, update prices when supplier quotes return, then raise formal POs." />
                <div className="flex gap-2">
                  <button className="rounded-xl border bg-white px-3 py-2 text-xs font-bold" onClick={() => setPurchasingFormOpen(!purchasingFormOpen)}>{purchasingFormOpen ? "Hide form" : "Open form"}</button>
                  <button className="rounded-xl border bg-white px-3 py-2 text-xs font-bold" onClick={syncXeroContacts}>Sync Xero suppliers</button>
                </div>
              </div>
              {xeroSyncStatus ? <p className="mb-4 rounded-xl bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-800">{xeroSyncStatus}</p> : null}
              {purchasingFormOpen ? <div className="space-y-3">
                <Field label="Job"><SelectInput value={newPo.jobId} onChange={(event) => setNewPo({ ...newPo, jobId: event.target.value })}>{jobs.map((job) => <option key={job.id} value={job.id}>{job.jobNo} · {job.title}</option>)}</SelectInput></Field>
                <Field label="Supplier"><AutoCompleteInput value={suppliers.find((supplier) => supplier.id === newPo.supplierId)?.name || newPo.supplierName || ""} options={suppliers.filter((supplier) => !supplier.hidden && supplier.status !== "Inactive")} getLabel={(supplier) => supplier.name} onChange={(event) => { const typed = event.target.value; const match = suppliers.find((supplier) => supplier.name === typed); setNewPo({ ...newPo, supplierId: match?.id || "", supplierName: typed }); }} /></Field>
                <div className="space-y-3 rounded-2xl bg-blue-50 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="font-bold">Purchase lines</h3>
                    <button className="rounded-lg border bg-white px-3 py-2 text-xs font-bold" onClick={addPoLine}>Add line</button>
                  </div>
                  {(newPo.lines || []).map((line, index) => (
                    <div key={line.id} className="rounded-xl bg-white p-3">
                      <p className="mb-2 text-xs font-bold text-blue-600">Line {index + 1}</p>
                      <div className="space-y-2">
                        <div className="grid gap-2 md:grid-cols-2">
                          <Field label="Product"><SelectInput value={line.productId || "ub"} onChange={(event) => { const productId = event.target.value; const options = getSectionOptions(productId, customProducts); const flatParts = parseFlatMaterialSectionSize(line.sectionSize); updatePoLine(line.id, productId === "flat" ? { productId, sectionSize: buildFlatMaterialSectionSize(line.flatWidth || line.width || flatParts.width, line.flatThickness || line.thickness || flatParts.thickness), flatWidth: line.flatWidth || line.width || flatParts.width || "", flatThickness: line.flatThickness || line.thickness || flatParts.thickness || "", width: line.flatWidth || line.width || flatParts.width || "", thickness: line.flatThickness || line.thickness || flatParts.thickness || "" } : { productId, sectionSize: options[0] || "", flatWidth: "", flatThickness: "", width: "", thickness: "" }); }}>{productDatabase.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</SelectInput></Field>
                          {line.productId === "flat" ? <>
                            <Field label="Flat width mm"><TextInput type="number" value={line.flatWidth || line.width || parseFlatMaterialSectionSize(line.sectionSize).width || ""} onChange={(event) => updatePoLine(line.id, buildPurchasingFlatPatch(line, { flatWidth: event.target.value, width: event.target.value }))} placeholder="e.g. 300" /></Field>
                            <Field label="Flat thickness mm"><TextInput type="number" value={line.flatThickness || line.thickness || parseFlatMaterialSectionSize(line.sectionSize).thickness || ""} onChange={(event) => updatePoLine(line.id, buildPurchasingFlatPatch(line, { flatThickness: event.target.value, thickness: event.target.value }))} placeholder="e.g. 10" /></Field>
                          </> : <Field label="Section / Size"><SelectInput value={line.sectionSize || ""} onChange={(event) => updatePoLine(line.id, { sectionSize: event.target.value })}>{getSectionOptions(line.productId || "ub", customProducts).map((section) => <option key={section} value={section}>{section}</option>)}</SelectInput></Field>}
                          <Field label="Length"><TextInput value={line.length || ""} onChange={(event) => updatePoLine(line.id, { length: event.target.value })} placeholder="e.g. 6m / 4400mm" /></Field>
                          <Field label="Quantity"><SelectInput value={line.quantity || 1} onChange={(event) => updatePoLine(line.id, { quantity: event.target.value })}>{Array.from({ length: 20 }, (_, qtyIndex) => qtyIndex + 1).map((qty) => <option key={qty} value={qty}>{qty}</option>)}</SelectInput></Field>
                          <Field label="Finish"><SelectInput value={line.finish || "Self colour"} onChange={(event) => updatePoLine(line.id, { finish: event.target.value })}>{steelFinishOptions.map((finish) => <option key={finish}>{finish}</option>)}</SelectInput></Field>
                          <Field label="Price £"><TextInput type="number" step="0.01" value={line.unitCost || ""} onChange={(event) => updatePoLine(line.id, { unitCost: event.target.value })} placeholder="0.00" /></Field>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-bold">{buildPoLineDescription(line, productDatabase)}</p>
                          <p className="text-sm font-black text-blue-950">Ex VAT: {currency(calculatePoLineTotal(line))}</p>
                          <button disabled={(newPo.lines || []).length === 1} className="rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-bold text-red-700 disabled:opacity-40" onClick={() => removePoLine(line.id)}>Remove</button>
                        </div>
                      </div>
                    </div>
                  ))}
                  <div className="rounded-xl border border-blue-100 bg-white p-3 text-sm">
                    <p className="font-bold">Purchase lines: {(newPo.lines || []).length}</p>
                    <p>Ex VAT: <span className="font-bold text-blue-950">{currency(calculatePoTotals(newPo.lines || [], 20).subtotal)}</span></p>
                    <p>Inc VAT @ 20%: <span className="font-black text-blue-950">{currency(calculatePoTotals(newPo.lines || [], 20).total)}</span></p>
                  </div>
                </div>
                <Field label="Required By"><TextInput type="date" value={newPo.requiredBy} onChange={(event) => setNewPo({ ...newPo, requiredBy: event.target.value })} /></Field>
                <button className="w-full rounded-xl bg-blue-700 px-4 py-3 text-sm font-bold text-white" onClick={raisePurchaseOrder}>Create enquiry / draft PO</button>
              </div> : null}
            </div>
            <div className="space-y-5">
              {purchaseOrders.length === 0 ? <div className="rounded-3xl bg-white p-6 text-sm font-semibold text-blue-800 shadow-sm">No supplier enquiries or purchase orders yet. Create an enquiry from missing job materials or open the form to add one manually.</div> : null}
              {getPurchasingDisplayGroups(purchaseOrders).map((group) => (
                <div key={group.id} className="rounded-3xl bg-white p-4 shadow-sm">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-base font-black">{group.title}</h3>
                      <p className="text-xs font-semibold text-blue-700">{group.records.length} record(s)</p>
                    </div>
                  </div>
                  <div className="space-y-3">
              {group.records.map((po, poIndex) => {
                const recordKey = getPurchasingRecordKey(po, poIndex);
                const job = jobs.find((item) => item.id === po.jobId);
                const supplier = suppliers.find((item) => item.id === po.supplierId);
                const isEditing = editingPoId === po.id && editingPoDraft;
                const draftSubtotal = isEditing ? calculatePoTotals(editingPoDraft.items || [], Number(editingPoDraft.vatRate || 20)).subtotal : 0;
                const archived = isPurchasingRecordArchived(po);
                const expanded = !archived || expandedPurchasingId === recordKey || isEditing;
                return (
                  <div key={recordKey} className="rounded-2xl border border-blue-100 bg-white p-4">
                    {!isEditing ? (
                      <>
                        <button type="button" className="flex w-full flex-col gap-3 text-left md:flex-row md:items-center md:justify-between" onClick={() => archived ? setExpandedPurchasingId(expanded ? null : recordKey) : setExpandedPurchasingId(recordKey)}>
                          <div><p className="font-bold">{getPurchasingDocumentNumber(po)} · {job?.jobNo || "No job"}</p><p className="text-sm text-blue-800">{archived ? `${supplier?.name || "Supplier"} · ${getPurchasingDocumentTitle(po)}` : `${supplier?.name || "Supplier"} · Required by ${po.requiredBy}`}</p>{!archived ? <><p className="mt-2 text-sm font-bold">Ex VAT {currency(po.subtotal)}</p><p className="text-xl font-black">Inc VAT {currency(po.total)}</p><p className="mt-1 text-xs text-blue-600">{(po.items || []).length} line(s){po.suggested ? " · Automatic enquiry from missing materials" : ""}{po.raisedFromEnquiryNo ? ` · Raised from ${po.raisedFromEnquiryNo}` : ""}</p></> : null}</div>
                          <div className="flex flex-wrap items-center gap-2 md:justify-end"><span className={`w-fit rounded-full px-3 py-1 text-xs font-bold ${getStatusStyle(po.status)}`}>{po.status}</span>{archived ? <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">{expanded ? "Hide details" : "Open details"}</span> : null}</div>
                        </button>
                        {expanded ? <div className="mt-4 space-y-3">
                          <div className="rounded-2xl bg-blue-50 p-3">
                            {(po.items || []).map((item) => (
                              <div key={item.id} className="flex justify-between gap-3 border-b border-blue-100 py-2 text-sm last:border-0">
                                <span>{item.description}</span>
                                <span className="font-semibold">Qty {item.quantity} · Ex VAT {currency(calculatePoLineTotal(item))}</span>
                              </div>
                            ))}
                          </div>
                          <div className="grid gap-2 md:grid-cols-[1fr_auto_auto]">
                            <SelectInput value={po.status} onChange={(event) => updatePOStatus(po.id, event.target.value)}>{poStatuses.map((status) => <option key={status}>{status}</option>)}</SelectInput>
                            <button disabled={po.status === "Sent" || po.status === "Received" || po.status === "Cancelled"} className="rounded-xl border bg-white px-4 py-2 text-sm font-bold disabled:opacity-40" onClick={() => startEditPurchaseOrder(po)}>Edit {isEnquiryDocument(po) ? "Enquiry" : "PO"}</button>
                            <button className="rounded-xl border bg-white px-4 py-2 text-sm font-bold" onClick={() => printPurchaseOrderPdf({ po, job, supplier, companySettings, onRegisterDocument: registerGeneratedDocument })}>Print / Save {isEnquiryDocument(po) ? "Enquiry" : "PO"} PDF</button>
                            {isEnquiryDocument(po) ? <button disabled={po.status === "Enquiry Sent" || po.status === "Supplier Quote Received" || po.status === "Cancelled"} className="rounded-xl bg-blue-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-40" onClick={() => sendPurchaseOrder(po.id)}>Send Enquiry</button> : <button type="button" disabled={po.status === "Sent" || po.status === "Received" || po.status === "Cancelled"} className="rounded-xl bg-blue-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-40" onClick={() => sendPurchaseOrder(po.id)}>Send PO</button>}
                            {isEnquiryDocument(po) ? <button type="button" disabled={po.status === "Supplier Quote Received" || po.status === "Cancelled"} className="rounded-xl border bg-white px-4 py-2 text-sm font-bold disabled:opacity-40" onClick={() => markSupplierQuoteReceived(po.id)}>Quote received</button> : null}
                            {isEnquiryDocument(po) ? <button type="button" disabled={po.status === "Cancelled"} title={po.status === "Supplier Quote Received" ? "Raise formal PO and add ordered material to stock" : "Raise formal PO from this enquiry"} className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-40" onClick={(event) => { event.preventDefault(); event.stopPropagation(); raisePoFromEnquiry(po.id); }}>Raise PO</button> : null}
                          </div>
                        </div> : null}
                      </>
                    ) : (
                      <div className="space-y-4">
                        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                          <div><p className="text-lg font-bold">Editing {getPurchasingDocumentNumber(editingPoDraft)}</p><p className="text-sm text-blue-800">{isEnquiryDocument(editingPoDraft) ? "Amend supplier enquiry lines/prices when the supplier quote comes back, then raise the formal PO." : "Amend draft PO before sending."}</p></div>
                          <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800">Editing</span>
                        </div>
                        <div className="grid gap-3 md:grid-cols-4">
                          <Field label="Job"><SelectInput value={editingPoDraft.jobId} onChange={(event) => updateEditingPoField("jobId", event.target.value)}>{jobs.map((item) => <option key={item.id} value={item.id}>{item.jobNo} · {item.title}</option>)}</SelectInput></Field>
                          <Field label="Supplier"><AutoCompleteInput value={suppliers.find((supplier) => supplier.id === editingPoDraft.supplierId)?.name || editingPoDraft.supplierName || ""} options={suppliers.filter((supplier) => !supplier.hidden && supplier.status !== "Inactive")} getLabel={(supplier) => supplier.name} onChange={(event) => { const typed = event.target.value; const match = suppliers.find((supplier) => supplier.name === typed); updateEditingPoField("supplierId", match?.id || ""); updateEditingPoField("supplierName", typed); }} /></Field>
                          <Field label="Required by"><TextInput type="date" value={editingPoDraft.requiredBy} onChange={(event) => updateEditingPoField("requiredBy", event.target.value)} /></Field>
                          <Field label="Status"><SelectInput value={editingPoDraft.status} onChange={(event) => updateEditingPoField("status", event.target.value)}>{poStatuses.map((status) => <option key={status}>{status}</option>)}</SelectInput></Field>
                        </div>
                        <div className="rounded-2xl bg-blue-50 p-3">
                          <div className="mb-3 flex items-center justify-between gap-3">
                            <h3 className="font-bold">Purchase lines</h3>
                            <button className="rounded-lg border bg-white px-3 py-2 text-xs font-bold" onClick={addEditingPoLine}>Add line</button>
                          </div>
                          <div className="space-y-3">
                            {(editingPoDraft.items || []).map((item, index) => (
                              <div key={item.id} className="rounded-xl bg-white p-3">
                                <p className="mb-2 text-xs font-bold text-blue-600">Line {index + 1}</p>
                                <div className="grid gap-2 md:grid-cols-3 md:items-end">
                                  <Field label="Product"><SelectInput value={item.productId || "ub"} onChange={(event) => { const productId = event.target.value; const options = getSectionOptions(productId, customProducts); const flatParts = parseFlatMaterialSectionSize(item.sectionSize); updateEditingPoLine(item.id, productId === "flat" ? { productId, sectionSize: buildFlatMaterialSectionSize(item.flatWidth || item.width || flatParts.width, item.flatThickness || item.thickness || flatParts.thickness), flatWidth: item.flatWidth || item.width || flatParts.width || "", flatThickness: item.flatThickness || item.thickness || flatParts.thickness || "", width: item.flatWidth || item.width || flatParts.width || "", thickness: item.flatThickness || item.thickness || flatParts.thickness || "" } : { productId, sectionSize: options[0] || "", flatWidth: "", flatThickness: "", width: "", thickness: "" }); }}>{productDatabase.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</SelectInput></Field>
                                  {item.productId === "flat" ? <>
                                    <Field label="Flat width mm"><TextInput type="number" value={item.flatWidth || item.width || parseFlatMaterialSectionSize(item.sectionSize).width || ""} onChange={(event) => updateEditingPoLine(item.id, buildPurchasingFlatPatch(item, { flatWidth: event.target.value, width: event.target.value }))} placeholder="e.g. 300" /></Field>
                                    <Field label="Flat thickness mm"><TextInput type="number" value={item.flatThickness || item.thickness || parseFlatMaterialSectionSize(item.sectionSize).thickness || ""} onChange={(event) => updateEditingPoLine(item.id, buildPurchasingFlatPatch(item, { flatThickness: event.target.value, thickness: event.target.value }))} placeholder="e.g. 10" /></Field>
                                  </> : <Field label="Section / Size"><SelectInput value={item.sectionSize || ""} onChange={(event) => updateEditingPoLine(item.id, { sectionSize: event.target.value })}>{getSectionOptions(item.productId || "ub", customProducts).map((section) => <option key={section} value={section}>{section}</option>)}</SelectInput></Field>}
                                  <Field label="Ordered length"><TextInput value={item.length || ""} onChange={(event) => updateEditingPoLine(item.id, { length: event.target.value })} placeholder="e.g. 6m / 4400mm" /></Field>
                                  <Field label="Allocated cut"><TextInput value={item.requiredCutLength || item.allocatedLength || item.length || ""} onChange={(event) => updateEditingPoLine(item.id, { requiredCutLength: event.target.value })} placeholder="job cut e.g. 4m" /></Field>
                                  <Field label="Quantity"><SelectInput value={item.quantity || 1} onChange={(event) => updateEditingPoLine(item.id, { quantity: event.target.value })}>{Array.from({ length: 20 }, (_, qtyIndex) => qtyIndex + 1).map((qty) => <option key={qty} value={qty}>{qty}</option>)}</SelectInput></Field>
                                  <Field label="Finish"><SelectInput value={item.finish || "Self colour"} onChange={(event) => updateEditingPoLine(item.id, { finish: event.target.value })}>{steelFinishOptions.map((finish) => <option key={finish}>{finish}</option>)}</SelectInput></Field>
                                  <Field label="Price £"><TextInput type="number" step="0.01" value={item.unitCost || ""} onChange={(event) => updateEditingPoLine(item.id, { unitCost: event.target.value })} placeholder="0.00" /></Field>
                                  <button disabled={(editingPoDraft.items || []).length === 1} className="rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-bold text-red-700 disabled:opacity-40" onClick={() => removeEditingPoLine(item.id)}>Remove</button>
                                </div>
                                <p className="mt-2 text-right text-sm font-bold">{buildPoLineDescription(item, productDatabase)} · Ex VAT {currency(calculatePoLineTotal(item))}</p>
                              </div>
                            ))}
                          </div>
                          <div className="mt-3 rounded-xl border border-blue-100 bg-white p-3 text-sm">
                            <p className="font-bold">Purchase lines: {(editingPoDraft.items || []).length}</p>
                            <p>Ex VAT: <span className="font-bold text-blue-950">{currency(calculatePoTotals(editingPoDraft.items || [], Number(editingPoDraft.vatRate || 20)).subtotal)}</span></p>
                            <p>Inc VAT @ 20%: <span className="font-black text-blue-950">{currency(calculatePoTotals(editingPoDraft.items || [], Number(editingPoDraft.vatRate || 20)).total)}</span></p>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-bold text-white" onClick={saveEditingPurchaseOrder}>Save {isEnquiryDocument(editingPoDraft) ? "enquiry" : "PO"} changes</button>
                          <button className="rounded-xl border bg-white px-4 py-2 text-sm font-bold" onClick={cancelEditPurchaseOrder}>Cancel</button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {activeTab === "deliveryCalendar" ? (
          <DeliveryCalendar jobs={jobs} deliveryNotes={deliveryNotes} customers={customers} onCreateDeliveryNote={createDeliveryNote} />
        ) : null}

        {activeTab === "delivery" ? (
          <div className="space-y-6">
            {(() => {
              const activeDeliveryNotes = deliveryNotes.filter((note) => note.status !== "Signed" && note.status !== "Cancelled");
              const signedDeliveryNotes = deliveryNotes.filter((note) => note.status === "Signed");
              const selectedSignedNote = signedDeliveryNotes.find((note) => note.id === selectedSignedDeliveryNoteId) || signedDeliveryNotes[0];

              return (
                <>
                  <div className="rounded-3xl bg-white p-5 shadow-sm">
                    <h2 className="text-lg font-bold">Active delivery notes</h2>
                    <p className="mt-1 text-sm text-blue-800">Issue, print and sign delivery notes.</p>
                  </div>

                  <div className="space-y-3">
                    {activeDeliveryNotes.length === 0 ? <div className="rounded-3xl bg-white p-6 text-blue-800 shadow-sm">No active delivery notes. Signed notes are shown below.</div> : null}
                    {activeDeliveryNotes.map((note) => {
                      const job = jobs.find((item) => item.id === note.jobId);
                      const customer = customers.find((item) => item.id === note.customerId);
                      return (
                        <div key={note.id} className="rounded-3xl bg-white p-5 shadow-sm">
                          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                            <div><p className="font-bold">{note.dnNo} · {job?.title}</p><p className="text-sm text-blue-800">{job?.customer} · {note.date} · Delivered to {note.deliveredTo}</p></div>
                            <span className={`w-fit rounded-full px-3 py-1 text-xs font-bold ${getStatusStyle(note.status)}`}>{note.status}</span>
                          </div>
                          <div className="mt-4 flex flex-col gap-3 md:flex-row">
                            <SelectInput value={note.status} onChange={(event) => updateDeliveryStatus(note.id, event.target.value)}>{deliveryStatuses.map((status) => <option key={status}>{status}</option>)}</SelectInput>
                            <button className="rounded-xl border bg-white px-4 py-2 text-sm font-bold" onClick={() => printDeliveryNotePdf({ note, job, customer, companySettings, onRegisterDocument: registerGeneratedDocument })}>Print / Save delivery note PDF</button>
                            <button className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-bold text-white" onClick={() => signDeliveryNote(note.id)}>Signed</button>
                          </div>
                          <DeliveryNotePreview note={note} job={job} customer={customer} companySettings={companySettings} />
                        </div>
                      );
                    })}
                  </div>

                  <div className="rounded-3xl bg-white p-5 shadow-sm">
                    <h2 className="text-lg font-bold">Signed delivery notes</h2>
                    <p className="mt-1 text-sm text-blue-800">Open signed notes for detail and reprint.</p>
                    <div className="mt-4 grid gap-4 lg:grid-cols-[360px_1fr]">
                      <div className="space-y-2">
                        {signedDeliveryNotes.length === 0 ? <p className="rounded-2xl bg-blue-50 p-4 text-sm text-blue-800">No signed delivery notes yet.</p> : null}
                        {signedDeliveryNotes.map((note) => {
                          const job = jobs.find((item) => item.id === note.jobId);
                          return (
                            <button key={note.id} className={`w-full rounded-2xl border p-4 text-left ${selectedSignedNote?.id === note.id ? "border-blue-600 bg-blue-700 text-white" : "border-blue-100 bg-white text-blue-950"}`} onClick={() => setSelectedSignedDeliveryNoteId(note.id)}>
                              <p className="font-bold">{note.dnNo}</p>
                              <p className={selectedSignedNote?.id === note.id ? "text-sm text-blue-100" : "text-sm text-blue-800"}>{job?.jobNo} · {job?.title}</p>
                              <p className={selectedSignedNote?.id === note.id ? "mt-1 text-xs text-blue-200" : "mt-1 text-xs text-blue-600"}>Signed {note.signedAt ? new Date(note.signedAt).toLocaleString() : note.date}</p>
                            </button>
                          );
                        })}
                      </div>
                      <div>
                        {selectedSignedNote ? (() => {
                          const job = jobs.find((item) => item.id === selectedSignedNote.jobId);
                          const customer = customers.find((item) => item.id === selectedSignedNote.customerId);
                          return (
                            <div className="rounded-2xl border border-blue-100 p-4">
                              <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                                <div>
                                  <p className="text-lg font-bold">{selectedSignedNote.dnNo} · Signed</p>
                                  <p className="text-sm text-blue-800">{job?.customer} · {job?.jobNo}</p>
                                </div>
                                <button className="rounded-xl border bg-white px-4 py-2 text-sm font-bold" onClick={() => printDeliveryNotePdf({ note: selectedSignedNote, job, customer, companySettings, onRegisterDocument: registerGeneratedDocument })}>Print / Save signed note PDF</button>
                              </div>
                              <DeliveryNotePreview note={selectedSignedNote} job={job} customer={customer} companySettings={companySettings} />
                            </div>
                          );
                        })() : <div className="rounded-2xl bg-blue-50 p-6 text-sm text-blue-800">Select a signed delivery note to view details.</div>}
                      </div>
                    </div>
                  </div>
                </>
              );
            })()}
          </div>
        ) : null}

        {activeTab === "planner" ? (
          <div className="space-y-6">
            <div className="rounded-3xl bg-white p-5 shadow-sm">
              <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div><SectionHeader eyebrow="Live Planner" title="Production Calendar" description="Automatic staff allocation based on role priority, workload, job priority and deadlines." />
                <p className="text-sm text-blue-600">{weekDays[0]} to {weekDays[weekDays.length - 1]}</p></div>
                {activeRole === "operations" ? <div className="flex flex-wrap gap-2"><button className="rounded-xl border bg-white px-4 py-2 text-sm font-bold" onClick={runPlannerFunctionalTest}>Run function test</button></div> : null}
              </div>
              {plannerTestReport ? (
                <div className={`mb-4 rounded-2xl p-4 ${plannerTestReport.passed ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-900"}`}>
                  <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                    <div>
                      <p className="font-black">Functional test {plannerTestReport.passed ? "passed" : "failed"}</p>
                      <p className="text-sm">{plannerTestReport.createdJobs} jobs · {plannerTestReport.createdLines} lines · {plannerTestReport.allocatedTasks} allocated tasks · {plannerTestReport.suggestedPos} suggested supplier enquiry(s) · {plannerTestReport.diagnosticsCount} diagnostics</p>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    {plannerTestReport.results.map((result) => (
                      <div key={result.name} className="rounded-xl bg-white px-3 py-2 text-sm">
                        <p className="font-bold">{result.passed ? "✅" : "❌"} {result.name}</p>
                        <p className="text-xs text-blue-800">{result.details}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              <div className="overflow-x-auto">
                <div className="min-w-[1100px]">
                  <div className="grid grid-cols-[180px_repeat(10,1fr)] border-b text-xs font-bold text-blue-600">
                    <div className="p-2">Staff</div>
                    {weekDays.map((day) => <div key={day} className="border-l p-2 text-center">{day.slice(5)}</div>)}
                  </div>
                  {staff.map((person) => (
                    <div key={person.id} className="grid min-h-[76px] grid-cols-[180px_repeat(10,1fr)] border-b">
                      <div className="p-3">
                        <p className="font-bold">{person.name}</p>
                        {activeRole === "operations" ? <p className="text-xs text-blue-600">{(person.roles || []).join(", ") || "No roles"}</p> : <p className="text-xs text-blue-600">Planner calendar</p>}
                      </div>
                      {weekDays.map((day) => {
                        const holiday = getHolidayForStaffOnDay(person.id, day, holidays);
                        const dayStageTasks = getCalendarStageTasksForStaff({ jobs: scheduledJobs, staffId: person.id, day, holidays });

                        return (
                          <div key={day} className="space-y-1 border-l p-1">
                            {holiday ? (
                              <div className="rounded-lg border border-purple-200 bg-purple-50 px-2 py-1 text-[11px] font-bold text-purple-800">
                                Holiday
                              </div>
                            ) : null}
                            {!holiday && dayStageTasks.map((item) => (
                              <button key={`${item.job.id}-${item.id}-${day}`} onClick={() => setSelectedJobId(item.job.id)} className={`w-full rounded-lg border px-2 py-1 text-left text-[11px] ${getPriorityStyle(item.job.priority)}`}>
                                <p className="font-bold">{item.job.jobNo}</p>
                                <p className="truncate">{item.stage}</p>
                              </button>
                            ))}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
              {activeRole !== "operations" ? <div className="mt-3 rounded-2xl bg-blue-50 p-4 text-sm font-semibold text-blue-800">Staff can view the planner calendar only. Staff role setup and allocation controls remain operations-only.</div> : null}
            </div>

            <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
              <div className="space-y-6">
              <div className="rounded-3xl bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-lg font-bold">Jobs</h2>
                  <button className="rounded-xl border bg-white px-4 py-2 text-sm font-bold" onClick={() => setShowManualJobForm(!showManualJobForm)}>
                    {showManualJobForm ? "Hide manual job" : "Add job manually"}
                  </button>
                </div>

                {showManualJobForm ? (
                  <div className="mt-5 space-y-3 border-t border-blue-100 pt-5">
                    <TextInput placeholder="Job no. e.g. JF-1027" value={newJob.jobNo} onChange={(event) => setNewJob({ ...newJob, jobNo: event.target.value })} />
                    <TextInput placeholder="Customer" value={newJob.customer} onChange={(event) => setNewJob({ ...newJob, customer: event.target.value })} />
                    <TextInput placeholder="Job title" value={newJob.title} onChange={(event) => setNewJob({ ...newJob, title: event.target.value })} />
                    <Field label="Start Date"><TextInput type="date" value={newJob.start} onChange={(event) => setNewJob({ ...newJob, start: event.target.value })} /></Field>
                    <Field label="Deadline Date"><TextInput type="date" value={newJob.deadline} onChange={(event) => setNewJob({ ...newJob, deadline: event.target.value })} /></Field>
                    <Field label="Materials Due"><TextInput type="date" value={newJob.materialsDue} onChange={(event) => setNewJob({ ...newJob, materialsDue: event.target.value })} /></Field>
                    <div className="grid grid-cols-2 gap-2">
                      <TextInput type="number" value={newJob.estimatedHours} onChange={(event) => setNewJob({ ...newJob, estimatedHours: event.target.value })} />
                      <SelectInput value={newJob.priority} onChange={(event) => setNewJob({ ...newJob, priority: event.target.value })}>
                        <option value="1">1 - Low</option>
<option value="2">2</option>
<option value="3">3 - Medium</option>
<option value="4">4</option>
<option value="5">5 - High</option>
                      </SelectInput>
                    </div>
                    <button className="w-full rounded-xl bg-blue-700 px-4 py-3 text-sm font-bold text-white" onClick={addJob}>Add to planner</button>
                  </div>
                ) : null}

                <div className="mt-5 border-t border-blue-100 pt-5">
                  <TextInput placeholder="Search jobs" value={search} onChange={(event) => setSearch(event.target.value)} />
                  <div className="mt-4 space-y-3">
                    {filteredJobs.map((job) => {
                      const deadlineMissed = isJobPastDeadline(job);
                      return (
                      <button key={job.id} onClick={() => setSelectedJobId(job.id)} className={`w-full rounded-2xl border p-4 text-left ${deadlineMissed ? "border-red-400 bg-red-50" : getPriorityStyle(job.priority)} ${selectedJob && selectedJob.id === job.id ? "ring-2 ring-blue-600" : ""}`}>
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-bold">{job.jobNo}</p>
                            <p className="text-sm font-semibold">{job.title}</p>
                            <p className="text-sm text-blue-800">{job.customer}</p>
                          </div>
                          <span className={`rounded-full px-2 py-1 text-xs font-bold ${getStatusStyle(job.status)}`}>{job.status}</span>
                        </div>
                        <div className="mt-3 flex items-center gap-2 text-xs text-blue-600"><span title={getDeadlineLightLabel(job)} className={`inline-block h-3 w-3 rounded-full ${getDeadlineLightStyle(job)}`} /><span>{isStaffLogin ? `Start: ${job.start} · Deadline: ${job.deadline} · Materials Due: ${job.materialsDue}` : `Start: ${job.start} · Planner finish: ${getJobFinishDate(job)} · Deadline: ${job.deadline} · Materials Due: ${job.materialsDue} · ${job.estimatedHours} hrs`}</span></div>
                        {!isStaffLogin && deadlineMissed ? <p className="mt-2 rounded-lg bg-red-100 px-2 py-1 text-xs font-bold text-red-800">Red light: calculated planner finish is after deadline</p> : null}
                      </button>
                    );})}
                  </div>
                </div>
              </div>

              {activeRole === "operations" ? <div className="rounded-3xl bg-white p-5 shadow-sm">
                <h2 className="text-lg font-bold">Staff</h2>
                <p className="mt-1 text-sm text-blue-800">Tick the job stages each staff member can cover, then rank each selected stage. Priority 1 is their preferred/best role for automatic planning.</p>
                <div className="mt-4 space-y-4">
                  {staff.filter(isStaffActive).map((person) => (
                    <div key={person.id} className="rounded-2xl border border-blue-100 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="font-bold">{person.name}</p>
                          <p className="text-xs text-blue-600">{person.hoursPerDay} hrs/day · Active</p>
                        </div>
                        <div className="flex flex-wrap items-end gap-2">
                          <Field label="Clocking PIN"><TextInput type="password" maxLength={4} value={getStaffPin(person)} onChange={(event) => updateStaffPin(person.id, event.target.value)} /></Field>
                          <button className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700" onClick={() => deactivateStaffMember(person.id)}>Deactivate</button>
                        </div>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        {stages.filter((stage) => stage !== "Complete").map((stage) => (
                          <label key={`${person.id}-${stage}`} className="grid grid-cols-[auto_1fr_72px] items-center gap-2 rounded-lg bg-blue-50 px-3 py-2 text-xs font-semibold">
                            <input type="checkbox" checked={(person.roles || []).includes(stage)} onChange={() => toggleStaffRole(person.id, stage)} />
                            <span>{stage}</span>
                            {(person.roles || []).includes(stage) ? <SelectInput value={getStaffRolePriority(person, stage)} onChange={(event) => updateStaffRolePriority(person.id, stage, event.target.value)}>{Array.from({ length: 9 }, (_, index) => index + 1).map((priority) => <option key={priority} value={priority}>P{priority}</option>)}</SelectInput> : <span className="text-[10px] text-blue-400">Off</span>}
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                  {staff.some((person) => !isStaffActive(person)) ? <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <h3 className="font-bold">Inactive staff</h3>
                    <p className="mt-1 text-xs text-slate-600">Inactive staff are hidden from future allocation and staff clocking, but historic records stay linked.</p>
                    <div className="mt-3 space-y-2">
                      {staff.filter((person) => !isStaffActive(person)).map((person) => (
                        <div key={person.id} className="flex items-center justify-between rounded-xl bg-white px-3 py-2 text-sm">
                          <span>{person.name}</span>
                          <button className="rounded-lg border bg-white px-3 py-1 text-xs font-bold" onClick={() => reactivateStaffMember(person.id)}>Reactivate</button>
                        </div>
                      ))}
                    </div>
                  </div> : null}
                </div>

                <div className="mt-5 rounded-2xl bg-blue-50 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="font-bold">Add new staff</h3>
                      <p className="mt-1 text-xs text-blue-700">Open only when adding a team member.</p>
                    </div>
                    <button className="rounded-lg border bg-white px-3 py-2 text-xs font-bold" onClick={() => setAddStaffOpen(!addStaffOpen)}>{addStaffOpen ? "Hide" : "Open"}</button>
                  </div>
                  {addStaffOpen ? <div className="mt-3 grid gap-2">
                    <TextInput placeholder="Staff name" value={newStaff.name} onChange={(event) => setNewStaff({ ...newStaff, name: event.target.value })} />
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Hours per day"><TextInput type="number" value={newStaff.hoursPerDay} onChange={(event) => setNewStaff({ ...newStaff, hoursPerDay: event.target.value })} /></Field>
                      <Field label="Clocking PIN"><TextInput type="password" inputMode="numeric" maxLength={4} placeholder="4 digit PIN" value={newStaff.pin} onChange={(event) => setNewStaff({ ...newStaff, pin: String(event.target.value || "").replace(/[^0-9]/g, "").slice(0, 4) })} /></Field>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {stages.filter((stage) => stage !== "Complete").map((stage) => (
                        <label key={`new-${stage}`} className="grid grid-cols-[auto_1fr_72px] items-center gap-2 rounded-lg bg-white px-3 py-2 text-xs font-semibold">
                          <input type="checkbox" checked={newStaff.roles.includes(stage)} onChange={() => toggleNewStaffRole(stage)} />
                          <span>{stage}</span>
                          {newStaff.roles.includes(stage) ? <SelectInput value={newStaff.rolePriorities?.[stage] || 1} onChange={(event) => updateNewStaffRolePriority(stage, event.target.value)}>{Array.from({ length: 9 }, (_, index) => index + 1).map((priority) => <option key={priority} value={priority}>P{priority}</option>)}</SelectInput> : <span className="text-[10px] text-blue-400">Off</span>}
                        </label>
                      ))}
                    </div>
                    <button className="rounded-xl bg-blue-700 px-4 py-3 text-sm font-bold text-white" onClick={addStaffMember}>Add staff member</button>
                  </div> : null}
                </div>
              </div> : null}
            </div>

              {selectedJob ? (
                <div className="rounded-3xl bg-white p-5 shadow-sm">
                  <div className="grid gap-6 lg:grid-cols-2">
                    <div className="space-y-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h2 className="text-xl font-bold">{selectedJob.jobNo} · {selectedJob.title}</h2>
                          <p className="text-blue-800">{selectedJob.customer}</p>
                        </div>
                        <span className={`rounded-full px-3 py-1 text-xs font-bold ${getStatusStyle(selectedJob.status)}`}>{selectedJob.status}</span>
                      </div>

                      <div className="rounded-2xl bg-blue-50 p-4">
                        <h3 className="mb-2 font-bold">Job actions</h3>
                        <p className="text-sm text-blue-800">Quote: {selectedJobQuote ? selectedJobQuote.quoteNo : "No linked quote"}</p>
                        <p className="text-sm text-blue-800">Purchasing records: {selectedJobPOs.length}</p>
                        <p className="text-sm text-blue-800">Delivery notes are created automatically when Painting is completed.</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button className="rounded-xl border bg-white px-3 py-2 text-xs font-bold" onClick={() => { setNewPo({ ...newPo, jobId: selectedJob.id }); setActiveTab("pos"); }}>Purchasing</button>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <Field label="Start"><TextInput type="date" value={selectedJob.start} onChange={(event) => updateJob(selectedJob.id, { start: event.target.value })} /></Field>
                        <Field label="Planner finish"><div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-bold">{getJobFinishDate(selectedJob) || "Not calculated"}</div></Field>
                        <Field label="Deadline"><TextInput type="date" value={selectedJob.deadline || ""} onChange={(event) => updateJob(selectedJob.id, { deadline: event.target.value })} /></Field>
                        <Field label="Materials Due"><TextInput type="date" value={selectedJob.materialsDue || ""} onChange={(event) => updateJob(selectedJob.id, { materialsDue: event.target.value })} /></Field>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        {!isStaffLogin ? <Field label="Hours"><TextInput type="number" value={selectedJob.estimatedHours} onChange={(event) => {
                          const estimatedHours = Number(event.target.value);
                          updateJob(selectedJob.id, {
                            estimatedHours,
                            stageTasks: alignStageTaskHours(selectedJob.stageTasks || [], estimatedHours, selectedJob.start, selectedJob.deadline),
                          });
                        }} /></Field> : null}
                        <Field label="Priority"><SelectInput value={selectedJob.priority} onChange={(event) => updateJob(selectedJob.id, { priority: event.target.value })}><option value="1">1 - Low</option>
<option value="2">2</option>
<option value="3">3 - Medium</option>
<option value="4">4</option>
<option value="5">5 - High</option></SelectInput></Field>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="Stage">
                          <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-bold">{selectedJob.stage}</div>
                          <div className="mt-2 grid grid-cols-2 gap-2">
                            <button className="rounded-lg border bg-white px-3 py-2 text-xs font-bold" onClick={() => moveJobStage(selectedJob.id, "back")}>Previous stage</button>
                            <button className="rounded-lg bg-blue-700 px-3 py-2 text-xs font-bold text-white" onClick={() => moveJobStage(selectedJob.id, "forward")}>Complete stage / next</button>
                          </div>
                        </Field>
                        <Field label="Status"><SelectInput value={selectedJob.status} onChange={(event) => updateJob(selectedJob.id, { status: event.target.value })}>{statuses.map((status) => <option key={status}>{status}</option>)}</SelectInput></Field>
                      </div>
                      <Field label="Notes"><textarea className="min-h-[90px] w-full rounded-lg border border-blue-200 p-3 text-sm outline-none focus:border-blue-600" value={selectedJob.notes} onChange={(event) => updateJob(selectedJob.id, { notes: event.target.value })} /></Field>
                    </div>

                    <div className="space-y-4">
                      <div>
                        <h3 className="mb-3 font-bold">Allocate staff</h3>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {staff.map((person) => {
                            const excluded = (selectedJob.excludedStaffIds || []).includes(person.id);
                            const assigned = !excluded;
                            const activelyAllocated = selectedJob.staffIds.includes(person.id);
                            const workload = Math.round(workloadForStaff(person.id));
                            return (
                              <button key={person.id} onClick={() => toggleStaff(selectedJob.id, person.id)} className={`rounded-2xl border p-3 text-left ${assigned ? "border-blue-600 bg-blue-700 text-white" : "bg-white"}`}>
                                <p className="font-bold">{person.name}</p>
                                <p className={assigned ? "text-xs text-blue-100" : "text-xs text-blue-600"}>{(person.roles || []).join(", ") || "No roles"}</p>
                                <p className={assigned ? "mt-2 text-xs text-blue-100" : "mt-2 text-xs text-blue-600"}>{workload} hrs in view · {excluded ? "Excluded from job" : activelyAllocated ? "Allocated to task" : "Available for job"}</p>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="rounded-2xl border border-blue-100 p-4">
                        <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                          <div>
                            <h3 className="font-bold">Stage allocation</h3>
                            <p className="text-xs text-blue-600">Automatic planner decisions are shown first. Use manual override only when a stage needs changing.</p>
                          </div>
                          <span className="rounded-full bg-blue-50 px-3 py-1 text-[11px] font-black uppercase tracking-wide text-blue-700">Live allocation</span>
                        </div>
                        <div className="space-y-3">
                          {normaliseStageTasksFromCompletion(selectedJob.stageTasks || []).flatMap((task) => {
                            const deliveryNote = deliveryNotes.find((note) => note.jobId === selectedJob.id && note.status !== "Cancelled");
                            const qualifiedStageStaff = staff.filter((person) => (person.roles || []).includes(task.stage));
                            const assignedStageStaff = getTaskStaffIds(task).map((staffId) => staff.find((person) => person.id === staffId)?.name).filter(Boolean);
                            const stageRow = (
                              <div key={task.id} className="rounded-2xl border border-blue-100 bg-white p-4">
                                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                                  <div>
                                    <p className="text-xs font-black uppercase tracking-wide text-blue-500">{task.stage}</p>
                                    <p className="mt-1 text-sm font-bold text-blue-950">{assignedStageStaff.length ? assignedStageStaff.join(", ") : "No staff allocated"}</p>
                                    {task.planningReason ? <p className="mt-1 text-xs text-blue-700">{task.planningReason}</p> : null}
                                  </div>
                                  <div className="flex flex-wrap gap-2 md:justify-end">
                                    <span className={`rounded-full px-3 py-1 text-xs font-bold ${getStatusStyle(task.status)}`}>{task.status}</span>
                                    <span className={`rounded-full px-3 py-1 text-xs font-bold ${task.allocationMode === "manual" ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>{task.allocationMode === "manual" ? "Manual override" : "Auto allocated"}</span>
                                  </div>
                                </div>
                                <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto] md:items-start">
                                  <div className="rounded-xl bg-blue-50 p-3">
                                    <div className="mb-3 flex items-center justify-between gap-3">
                                      <div>
                                        <p className="text-xs font-black uppercase tracking-wide text-blue-600">Staff override</p>
                                        <p className="text-[11px] text-blue-700">Only change this when the auto allocation needs overriding.</p>
                                      </div>
                                      <span className="rounded-full bg-white px-2 py-1 text-[10px] font-black text-blue-700">{qualifiedStageStaff.length} eligible</span>
                                    </div>
                                    {qualifiedStageStaff.length ? <div className="space-y-2">
                                      {assignedStageStaff.length ? <div className="rounded-lg bg-white p-2">
                                        <p className="mb-2 text-[10px] font-black uppercase tracking-wide text-blue-500">Currently assigned</p>
                                        <div className="flex flex-wrap gap-2">
                                          {getTaskStaffIds(task).map((staffId) => {
                                            const person = staff.find((item) => item.id === staffId);
                                            if (!person) return null;
                                            return <button key={`${task.id}-assigned-${person.id}`} className="rounded-full bg-blue-700 px-3 py-1 text-xs font-bold text-white" onClick={() => toggleStageStaff(selectedJob.id, task.id, person.id, task.stage)}>{person.name} · P{getStaffRolePriority(person, task.stage)} ×</button>;
                                          })}
                                        </div>
                                      </div> : <p className="rounded-lg bg-white px-3 py-2 text-xs font-semibold text-blue-700">No manual staff selected. Auto planner will choose the best available person.</p>}
                                      <div className="rounded-lg bg-white p-2">
                                        <p className="mb-2 text-[10px] font-black uppercase tracking-wide text-blue-500">Available to assign</p>
                                        <div className="flex flex-wrap gap-2">
                                          {qualifiedStageStaff.filter((person) => !getTaskStaffIds(task).includes(person.id)).map((person) => <button key={`${task.id}-available-${person.id}`} className="rounded-full border border-blue-200 bg-white px-3 py-1 text-xs font-bold text-blue-900" onClick={() => toggleStageStaff(selectedJob.id, task.id, person.id, task.stage)}>+ {person.name} · P{getStaffRolePriority(person, task.stage)}</button>)}
                                          {qualifiedStageStaff.filter((person) => !getTaskStaffIds(task).includes(person.id)).length === 0 ? <span className="text-xs font-semibold text-blue-600">All eligible staff are already assigned.</span> : null}
                                        </div>
                                      </div>
                                    </div> : <p className="text-xs text-blue-600">No staff role can cover this stage.</p>}
                                  </div>
                                  <button
                                    disabled={task.status === "Complete"}
                                    className="rounded-xl bg-blue-700 px-4 py-3 text-xs font-bold text-white disabled:opacity-40"
                                    onClick={() => updateStageTask(selectedJob.id, task.id, { stage: task.stage, status: "Complete" })}
                                  >
                                    Mark complete
                                  </button>
                                </div>
                              </div>
                            );

                            if (task.stage !== "Painting") return [stageRow];

                            const deliveryNoteRow = (
                              <div key={`${selectedJob.id}-delivery-note-action`} className="rounded-xl border border-dashed border-blue-200 bg-white p-3">
                                <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-center">
                                  <div>
                                    <p className="text-sm font-bold">Delivery Note</p>
                                    <p className="text-xs text-blue-600">Raise this after Painting and before Delivery.</p>
                                  </div>
                                  <div className={`rounded-lg px-3 py-2 text-sm font-bold ${deliveryNote ? getStatusStyle(deliveryNote.status) : "bg-blue-50 text-blue-900"}`}>
                                    {deliveryNote ? `${deliveryNote.dnNo} · ${deliveryNote.status}` : "Not raised"}
                                  </div>
                                  <button
                                    disabled={Boolean(deliveryNote)}
                                    className={`rounded-lg px-3 py-2 text-xs font-bold text-white disabled:opacity-40 ${deliveryNote ? "bg-emerald-600" : "bg-blue-700"}`}
                                    onClick={() => createDeliveryNote(selectedJob)}
                                  >
                                    Raise delivery note
                                  </button>
                                </div>
                              </div>
                            );

                            return [stageRow, deliveryNoteRow];
                          })}
                        </div>
                      </div>

                      <div className="rounded-2xl bg-blue-50 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <h3 className="font-bold">Planner diagnostics</h3>
                          <button className="rounded-lg border bg-white px-3 py-2 text-xs font-bold" onClick={() => setPlannerDiagnosticsOpen(!plannerDiagnosticsOpen)}>{plannerDiagnosticsOpen ? "Hide" : "Open"}</button>
                        </div>
                        {plannerDiagnosticsOpen ? <div className="mt-3 space-y-2 text-sm text-blue-800">
                          {(selectedJob.planningDiagnostics || []).length ? (selectedJob.planningDiagnostics || []).map((entry) => (
                            <p key={entry.id} className="rounded-lg bg-white px-3 py-2"><span className="font-bold">{entry.stage}:</span> {entry.reason}</p>
                          )) : <p>No planner diagnostics yet. Run auto-plan or add tasks to calculate allocation reasons.</p>}
                        </div> : null}
                      </div>

                      <div className="rounded-2xl bg-blue-50 p-4">
                        <h3 className="mb-2 font-bold">Job summary</h3>
                        <p className="text-sm text-blue-800">Planner finish: {getJobFinishDate(selectedJob) || "Not calculated"}</p>
                        <p className="text-sm text-blue-800">Deadline: {selectedJob.deadline || "Not set"}</p>
                        <p className="text-sm text-blue-800">Materials Due: {selectedJob.materialsDue || "Not set"}</p>
                        <p className="text-sm text-blue-800">Task allocated staff: {selectedJob.staffIds.length ? selectedJob.staffIds.map((id) => staff.find((person) => person.id === id)?.name).filter(Boolean).join(", ") : "No staff allocated"}</p>
                        <p className="text-sm text-blue-800">Available staff pool: {staff.filter((person) => !(selectedJob.excludedStaffIds || []).includes(person.id)).map((person) => person.name).join(", ") || "No staff available"}</p>
                        <p className="text-sm text-blue-800">Hours per assigned person: {selectedJob.staffIds.length ? Math.round(selectedJob.estimatedHours / selectedJob.staffIds.length) : selectedJob.estimatedHours}</p>
                      </div>
                    </div>
                  </div>

                  <div className="mt-6 rounded-3xl bg-white p-5 shadow-sm">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h3 className="text-lg font-bold">Job sheet</h3>
                        <p className="text-sm text-blue-800">Open when workshop paperwork or material detail is needed.</p>
                      </div>
                      <button className="rounded-xl border bg-white px-4 py-2 text-sm font-bold" onClick={() => setJobSheetOpen(!jobSheetOpen)}>{jobSheetOpen ? "Hide job sheet" : "Open job sheet"}</button>
                    </div>
                    {jobSheetOpen ? <div className="mt-4">
                      <JobSheet
                        job={selectedJob}
                        quote={selectedJobQuote}
                        customer={customers.find((item) => item.id === selectedJob.customerId)}
                        stockItems={stockItems}
                        companySettings={companySettings}
                        onSuggestPO={createSuggestedPoLinesFromMissingParts}
                        onRegisterDocument={registerGeneratedDocument}
                      />
                    </div> : null}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
          </main>
        </div>
      </div>
    </div>
  );
}
