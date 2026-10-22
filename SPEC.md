
# Functional Tool: Complete Feature List

## 1. Summary

The Functional Tool is a project delivery and partner approval platform with two signed-in roles (Admin and Partner POC), milestone-level approval with delay negotiation and a full audit trail. Email notifications are deferred to a later phase. All authorisation is enforced server-side and the build is covered by 228 automated checks across five suites.

| Area              | Key capability                                                                            |
| ----------------- | ----------------------------------------------------------------------------------------- |
| Access control    | Two roles, scope-based visibility, out-of-scope requests return 404                       |
| Delivery tracking | Projects, milestones and sub-tasks with one-way status progression                        |
| Partner approval  | Submit, rate (1 to 5), comment with @mentions, gated on accepted delays                   |
| Delay governance  | Per-item delay threads with accept, deny and reply, attributed to Company or Partner side |
| Reporting         | Role-based dashboard with on-time, attribution, quality and trend views                   |
| Compliance        | Audit trail with 2-year retention, secure attachments, rate-limited authentication        |

## 2. Roles and Permissions

The platform has two login roles and one directory-only record type.

| Capability                                                   | Admin (company)                | Partner POC                         |
| ------------------------------------------------------------ | ------------------------------ | ----------------------------------- |
| Visibility                                                   | All projects                   | Only projects where assigned as POC |
| Create, edit, delete projects, milestones, sub-tasks, people | Yes                            | No                                  |
| Milestone approval                                           | Submits milestones             | Approves milestones                 |
| Delays                                                       | Replies when a delay is denied | Accepts or denies delays            |
| Feedback (rating and comment)                                | Reads it                       | Writes it, cannot read it back      |
| Audit trail                                                  | Yes                            | No                                  |
| Dashboard analytics                                          | Full                           | Counters only                       |

| Record type      | Login | Can be assigned to projects | Can be @mentioned | Enforcement                                                                 |
| ---------------- | ----- | --------------------------- | ----------------- | --------------------------------------------------------------------------- |
| Admin            | Yes   | Yes                         | Yes               | Role on account                                                             |
| Partner POC      | Yes   | Yes, as POC                 | Yes               | Role on account                                                             |
| Company Resource | No    | Yes                         | Yes               | people.user_id nullable; CHECK requires an email for anyone who can sign in |

Out-of-scope requests return 404, not 403, so a partner cannot discover which project codes exist by watching status codes.

## 3. Authentication

Sessions are held in httpOnly cookies, so the browser never holds a token that a script could read or replay.

| Feature                       | Behaviour                                                                                              | Security control                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| Sign in                       | Express exchanges email and password with Supabase Auth and stores both tokens in httpOnly cookies     | No client-side token exposure                             |
| Forgot password               | /forgot-password returns the same response whether or not the address exists                           | Prevents account enumeration                              |
| Reset password (emailed link) | /reset-password?token_hash=… validates length and match, then signs the user in                       | Single-use token; hash removed from the address bar       |
| Change password (Profile)     | Re-authenticates with the current password, then signs out all other devices and keeps the current one | A stolen session alone cannot take over the account       |
| Log out                       | Revokes the refresh token server-side and clears cookies                                               | Server-side session termination                           |
| Token verification            | Access tokens verified locally against the project JWKS (ES256)                                        | No network round-trip per request                         |
| Token refresh                 | Expired access token refreshes silently                                                                | Seamless session continuity                               |
| Rate limiting                 | Postgres-backed, two budgets: 6 failures per email and 40 per IP in 15 minutes                         | One user mistyping does not lock out an office behind NAT |

## 4. Application Shell

| Element                 | Detail                                                                                  | Access     |
| ----------------------- | --------------------------------------------------------------------------------------- | ---------- |
| Tabs                    | Dashboard, Projects                                                                     | All users  |
| Tabs                    | User Management, Audit Trail                                                            | Admin only |
| Avatar menu (top right) | Name, email, role, Profile, Change password, Log out; closes on Escape or outside click | All users  |
| Deep links              | Work and survive refresh                                                                | All users  |
| Role guards             | Redirect unauthorised users instead of showing an empty page                            | All users  |

## 5. Dashboard

All users see four counters; Admins also see six analytics sections.

| Section                    | Shows                                                            | Access    |
| -------------------------- | ---------------------------------------------------------------- | --------- |
| Counters                   | Total Projects, In-Progress, Not Started, Completed              | All users |
| On-Time vs Delayed         | Stacked bar with counts on the bar and percentages in the legend | Admin     |
| Delay Attribution          | Company Side, Partner Side, Unattributed                         | Admin     |
| Quality by Project Type    | Delay attribution split per project type                         | Admin     |
| Throughput and Delay Trend | Completions per week over 8 weeks                                | Admin     |
| Delayed Projects           | Clickable list with the per-side breakdown                       | Admin     |
| Project Progress           | Sortable table with a progress meter per project                 | Admin     |

## 6. Projects

Project status moves one way only: Not Started, then In-Progress, then Completed.

| Feature           | Behaviour                                                                                     | Rule or validation                                                                         |
| ----------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Project list      | Columns: Code, Title, Type, Approved Date Range, Status, Actions; row click opens the project | Live search by code or title                                                               |
| + New Project     | Code, title, type, status, description and three date ranges (company, partner, approved)     | Code unique and case-insensitive; end-before-start refused per range                       |
| Edit              | Same form as create                                                                           | Status options below the current one are disabled                                          |
| Delete            | Removes the project and everything beneath it                                                 | Written reason of at least 5 characters, recorded in the audit trail                       |
| Move to Completed | Closes the project                                                                            | Every milestone must be completed and approved; user must type the project code to confirm |

## 7. Project Detail

Each project opens into three tabs: Project Overview, Milestones and Comments.

| Tab              | Contents                                                                                                                                                                                                                                                                                       |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Project Overview | Status picker, Edit Project, description, the three date ranges on one line (approved emphasised), collapsible Dashboard accordion (progress, on-time vs delayed, delay attribution, milestone cycle time), Organisation Resources and Partner Company POC accordions with + Assign and remove |
| Milestones       | Milestones and sub-tasks with the actions below                                                                                                                                                                                                                                                |
| Comments         | One thread per delayed item, grouped by milestone (see section 9)                                                                                                                                                                                                                              |

### Milestone and sub-task actions

| Action                    | Who                       | Blocked when                                                        |
| ------------------------- | ------------------------- | ------------------------------------------------------------------- |
| + Add Milestone           | Admin                     | Never                                                               |
| + Sub-task                | Admin                     | Milestone is completed                                              |
| Mark Complete (sub-task)  | Admin                     | Project is not In-Progress; sub-task already complete               |
| Mark Complete (milestone) | Admin                     | Any sub-task still open; project is not In-Progress                 |
| Submit for Approval       | Admin                     | Milestone not completed; no Partner POC assigned; already submitted |
| Approve                   | Assigned Partner POC only | Approval is not pending; any delay not yet accepted                 |
| Edit, Delete              | Admin                     | Never (admin only)                                                  |

### Completion and date rules

| Rule                | Detail                                                                                                               |
| ------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Completion is final | Cannot be reversed once marked                                                                                       |
| On-Time or Delayed  | Asked at completion; Delayed requires a side (Company or Partner) and takes a reason                                 |
| Completion date     | Stamped by the database, not the server clock                                                                        |
| Date ranges         | Each milestone carries company, partner and approved ranges; approved governs, the others show only when they differ |

## 8. Approval Workflow

A milestone is approved only after every delay on it has been accepted, and the gate reads the database rather than the request.

| Step | Actor       | Action                                                                                 | Result and notifications                                       |
| ---- | ----------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 1    | Admin       | Completes every sub-task                                                               | Milestone eligible for completion                              |
| 2    | Admin       | Marks the milestone complete                                                           | Final; cannot be reversed                                      |
| 3    | Admin       | Clicks Submit for Approval                                                             | Approval set to pending                                        |
| 4    | Partner POC | Decides each delay (see section 9)                                                     | Each acceptance written by its own authorised request          |
| 5    | Partner POC | Clicks Approve with a 1 to 5 rating and a comment (@mentions of anyone on the project) | Allowed only when every delay is accepted                      |
| 6    | System      | Sets approval to approved                                                              | Approval recorded; @mentioned people are tagged in the comment |

| Control          | Detail                                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------------------------ |
| Approval gate    | No "I agree" payload exists for a crafted call to fabricate                                                        |
| Approve button   | Disabled while anything is outstanding; the modal names what is blocking it                                        |
| Feedback privacy | Company-side only; the serialiser withholds the fields from partners instead of relying on the client to hide them |

## 9. Delay Negotiation

Every delayed milestone or sub-task on a submitted milestone opens a thread that ends only when the POC accepts the delay.

| Thread state | Partner POC options                        | Admin options | Next state and notification             |
| ------------ | ------------------------------------------ | ------------- | --------------------------------------- |
| Pending      | Accept delay; Deny delay (reason required) | None          | Accepted or Denied                      |
| Denied       | Accept and close; Reply                    | Send reply    | Accepted when the POC closes the thread |
| Accepted     | None                                       | None          | Closed to everyone; cannot be reversed  |

| Rule                   | Detail                                                                                        |
| ---------------------- | --------------------------------------------------------------------------------------------- |
| Deny requires a reason | Accept does not                                                                               |
| Accept is final        | Cannot be undone by denying afterwards, so a closed thread stays closed                       |
| Admin reply box        | Appears only on a denied thread, never on pending or accepted                                 |
| Enforcement            | Rules live in rules.js; the API refuses invalid actions, hiding the box is not the protection |

## 10. Attachments

One file per comment, up to 10 MB, in pdf, doc, docx, xls, xlsx, png, jpg or jpeg.

| Step | Upload flow (three steps, because a serverless request body caps at 4.5 MB)                              |
| ---- | -------------------------------------------------------------------------------------------------------- |
| 1    | Server checks permission and issues a signed upload URL                                                  |
| 2    | Browser PUTs the file directly to Supabase Storage                                                       |
| 3    | The comment claims the object; the server re-reads its real size and type instead of trusting the client |

| Control      | Detail                                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Download     | 60-second signed URL forcing Content-Disposition: attachment; both roles can download anything on a project they can see |
| File type    | Extension is the gate; MIME type is derived from it, never trusted from the client                                       |
| Storage path | Object name is a UUID, so nothing user-controlled reaches a path                                                         |
| Bucket       | Private and never served statically                                                                                      |
| Cleanup      | Unclaimed uploads swept by the scheduled job                                                                             |

## 11. User Management (Admin)

Two tables are maintained: Company Resources and Partner POCs.

| Action            | Behaviour                                                                                                       | Safeguard                                                                                                                             |
| ----------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| + Add Resource    | Name and job title; no login                                                                                    | Directory record only                                                                                                                 |
| + Add Partner POC | Name, email and password (minimum 10 characters); creates the Supabase Auth user and the directory row together | If the second write fails, the first is rolled back manually, as no transaction spans both systems                                    |
| Edit              | Rename, change email, optionally reset the password                                                             | Recorded in the audit trail                                                                                                           |
| Delete            | Removes the user and reports how many projects they were unassigned from                                        | Cannot delete your own account; login removed first, so a partial failure leaves the user unable to sign in rather than still able to |

## 12. Audit Trail (Admin)

| Aspect          | Detail                                                                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Events captured | Every state change: projects, milestones, sub-tasks, approvals, delay decisions, user management, password changes                         |
| Viewing         | Search, filter by category, sort, paginated                                                                                                |
| Retention       | 2 years by age, pruned on a schedule; rows are never trimmed on write, so it remains a true audit trail rather than a recent-activity feed |

## 13. Notifications (Deferred)

Email notifications are out of scope for the current phase; users must sign in to check for items awaiting their action.

| Deferred scenario                 | Would notify             |
| --------------------------------- | ------------------------ |
| Milestone submitted for approval  | Every POC on the project |
| Milestone approved                | Submitter                |
| @mentioned in an approval comment | Each mentioned person    |
| Project completed                 | To be confirmed          |
| Newly assigned as POC             | Assigned POC             |
| Delay denied                      | Submitter                |
| Admin replied on a denial         | POC                      |

Also deferred: the outbox, delivery worker, retry and dedupe mechanism, and the /api/emails admin endpoint. Password reset emails sent by Supabase Auth remain in scope, as sign-in recovery depends on them.

## 14. Operations

| Endpoint                | Access          | Purpose                                                        |
| ----------------------- | --------------- | -------------------------------------------------------------- |
| GET /api/health         | Unauthenticated | Shallow health check                                           |
| GET /api/ready          | Admin           | Database status                                                |
| POST /api/internal/cron | Shared secret   | Sweeps unclaimed uploads, prunes rate limits and audit records |

| Script                | Purpose                              |
| --------------------- | ------------------------------------ |
| npm run migrate       | Apply database migrations            |
| npm run seed          | Load seed data                       |
| npm run setup:storage | Provision storage buckets            |
| npm run doctor        | Environment and configuration checks |
| npm run test          | Run the automated test suites        |

## 15. Platform Guarantees

| Guarantee                              | Detail                                                                                                                                                                                        |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Three server-side authorisation layers | Identity (guards.js), then scope as SQL so out-of-scope rows return 404 (scope.js), then the state machine (rules.js); client-side rule copies exist only to explain why a button is disabled |
| Irreversible actions confirm twice     | Completing a project requires typing the project code; deleting one requires a written reason                                                                                                 |
| Flat reads                             | One query per table for a whole result set: 8 queries for the project list regardless of size, against 4,501 for 100 projects under the previous design                                       |
| Automated testing                      | 228 checks across five suites: schema, API, concurrency, N+1 query budget, and frontend in a real browser                                                                                     |
