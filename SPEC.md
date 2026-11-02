
# Functional Tool: Complete Feature List

_Last updated: 2 November 2026. Reflects the application as built, including the approval deny/override flow, milestone conversations, in-app notifications and the redesigned dashboard._

## 1. Summary

The Functional Tool is a project delivery and partner approval platform with two signed-in roles (Admin and Partner POC). It tracks projects, milestones and sub-tasks, runs milestone-level approval (approve, deny, override) with delay negotiation, supports a free back-and-forth conversation on every milestone, and keeps a full audit trail. In-app notifications are live; email notifications are deferred. All authorisation is enforced server-side.

| Area              | Key capability                                                                                                  |
| ----------------- | --------------------------------------------------------------------------------------------------------------- |
| Access control    | Two roles, scope-based visibility, out-of-scope requests return 404                                             |
| Delivery tracking | Projects, milestones (including extended milestones) and sub-tasks with one-way status progression              |
| Guided setup      | New-project setup guide; a project cannot start without a Partner POC, a resource and a milestone              |
| Partner approval  | Submit, approve (rating 1 to 5 and comment), deny with a reason, re-review; admin can override at any point     |
| Delay governance  | Per-milestone delay threads with accept, deny and reply, attributed to Company or Partner side; admin can close |
| Conversation      | Admin and Partner POC can message each other on a milestone or sub-task until the milestone is approved         |
| Notifications     | In-app pending-action indicator with one entry per action for Partner POCs; project list highlights            |
| Reporting         | Role-based dashboard (delivery throughput, approval pipeline, delay responsibility, lateness, slippage)        |
| Compliance        | Audit trail with 2-year retention, secure attachments (API), rate-limited authentication                        |

## 2. Roles and Permissions

The platform has two login roles and one directory-only record type.

| Capability                                                   | Admin (company)                                         | Partner POC                                     |
| ------------------------------------------------------------ | ------------------------------------------------------- | ----------------------------------------------- |
| Visibility                                                   | All projects                                            | Only projects where assigned as POC             |
| Create, edit, delete projects, milestones, sub-tasks, people | Yes                                                     | No                                              |
| Assign Partner POCs and resources to a project               | Yes                                                     | No                                              |
| Milestone approval                                           | Submits, re-requests review, can override and approve   | Approves or denies (and can change their mind)  |
| Delays                                                       | Replies on a denied delay; can close a denied thread    | Accepts or denies delays; can reply             |
| Conversation on a milestone                                  | Posts and reads                                         | Posts and reads                                 |
| Feedback (rating and comment)                                | Reads it                                                | Writes it, cannot read it back                  |
| Audit trail                                                  | Yes                                                     | No                                              |
| Dashboard                                                    | Portfolio-wide analytics                                | Own projects: counters, deadlines, progress     |
| Company dates and company-side figures                       | Yes                                                     | No                                              |

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
| Sign in                       | Express exchanges email and password with Supabase Auth and stores both tokens in httpOnly cookies; show/hide password toggle on the field | No client-side token exposure |
| Forgot password               | /forgot-password returns the same response whether or not the address exists                           | Prevents account enumeration                              |
| Reset password (emailed link) | /reset-password?token_hash=… validates length and match, then signs the user in                       | Single-use token; hash removed from the address bar       |
| Change password (Profile)     | Re-authenticates with the current password, then signs out all other devices and keeps the current one | A stolen session alone cannot take over the account       |
| Log out                       | Revokes the refresh token server-side and clears cookies                                               | Server-side session termination                           |
| Token verification            | Access tokens verified locally against the project JWKS (ES256)                                        | No network round-trip per request                         |
| Token refresh                 | Expired access token refreshes silently                                                                | Seamless session continuity                               |
| Rate limiting                 | Postgres-backed, two budgets: 6 failures per email and 40 per IP in 15 minutes                         | One user mistyping does not lock out an office behind NAT |

The sign-in, forgot-password and reset-password pages share a branded layout: a full-screen background image with the card on the left (centred on phones) and the Mako logo.

## 4. Application Shell

| Element                  | Detail                                                                                                         | Access     |
| ------------------------ | -------------------------------------------------------------------------------------------------------------- | ---------- |
| Sidebar                  | Dashboard, Projects; collapsible; Mako logo as the brand mark                                                  | All users  |
| Sidebar (administration) | Users, Audit Trail                                                                                             | Admin only |
| Pending-actions indicator | Inbox icon with a count badge in the top bar; the dropdown lists pending actions (see section 12)            | All users  |
| Avatar menu (top right)  | Name, email, role, Profile, Change password, Log out; closes on Escape or outside click                        | All users  |
| Branding                 | Mako logo used as the sidebar mark, on the authentication pages and as the browser favicon / touch icon        | All users  |
| Deep links               | Work and survive refresh                                                                                       | All users  |
| Role guards              | Redirect unauthorised users instead of showing an empty page                                                   | All users  |

## 5. Dashboard (Landing Page): Delivery Overview

The first page after sign-in. The role decides the view, and the server scopes every figure in SQL. `GET /api/dashboard?range=all|quarter|month&partner=<id>` uses 5 queries for an admin and 4 for a Partner POC. The `partner` filter only narrows an admin's view and is ignored for a Partner POC, so scope can never be widened or redirected from the request.

### Header and controls

| Control            | Behaviour                                                                                                                          |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Title and subtitle | "Delivery overview" with "Portfolio health across N projects and M milestones · Updated <time>"                                    |
| Time range         | All time, This quarter, This month (calendar periods). Limits completed-milestone and approval figures to activity in the period; the pipeline and open work stay current |
| Partner (admin)    | All partners, or one Partner POC; shows only the projects that person is POC on                                                    |
| Export report      | Downloads a CSV of the figures on screen (range, partner, metrics, needs-attention rows); cells that could run as spreadsheet formulas are neutralised |
| URL                | Range and partner live in the address, so a view can be shared and survives refresh                                                |

### Cards (all rows and chips link to the projects list filtered to the matching projects)

| Card               | Content                                                                                                                                                                                  |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| On-time delivery   | Donut with the percentage of completed milestones finished on time; legend: Completed on time, Delayed (partner side), Delayed (company side); a plain-language note on who owned the delays. A Partner POC sees one combined "Delayed" figure |
| Project pipeline   | One segment per project coloured by status, plus Not started, In progress (with % of portfolio) and Completed (with "n on time" / "n delayed" chips); "View all projects" link          |
| Milestone status   | Total milestones in view (extended included), a proportion bar and a table of Completed on time, Delayed (partner / company side) and Not yet completed with counts and share           |
| Approvals          | "n of N approved" with bars: Approved by Partner POC, Approved by admin override, Awaiting partner, Declined (partners see Approved, Awaiting my approval, Declined)                     |
| Needs attention    | Admin: declined and awaiting approvals plus admin overrides from the last 30 days, with milestone, project, status, owner and an action (Review, Open, View note). Partner: milestones awaiting their approval. A count pill and an "Open approvals queue" link |

### Calculation rules

| Rule                 | Detail                                                                                                                                                                  |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Delivery date        | Projects have no completion-date column, so a completed project's delivery date is the date its last milestone was completed (the same basis as Completion Tracking)       |
| On time or delayed   | A completed project is compared with its approved end date; one with no approved end date or no milestones is "not classified" and the dashboard says how many were left out |
| Milestone delays     | Taken from the on-time flag and the delay side recorded at completion; never inferred from dates                                                                        |
| Approval state       | Counted from the current state of each approval, so each milestone is counted once; an override is never also a partner approval, and a denied-then-approved milestone is approved |
| Time range           | Completed milestones are filtered by completion date and approvals by their last state change; "Not yet completed", the pipeline and Needs attention are always current    |
| Partner confidentiality | A Partner POC gets no company-side figures, no override figures, no owner names and no partner list                                                                  |
| States               | Loading, error, a clear message if the server returns an older data format, and an empty state when there are no projects; zero values show as 0                        |

## 6. Projects

Project status moves one way only: Not Started, then In-Progress, then Completed.

| Feature               | Behaviour                                                                                                                                         | Rule or validation                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Project list          | Columns: Code, Title, Type, Approved Date Range, Status, Actions; row click opens the project                                                     | Live search by code or title; refreshes when the browser tab regains focus; optional dashboard filters (`status`, `outcome`, `milestone`, `approval`) with a clearable chip |
| Row highlights        | A coloured row (tint, left bar and a dot before the title) while something awaits the signed-in user; plain white once it is done                | See "Highlight rules" below                                                                              |
| + New Project         | Code, title, type, status, description. Only the Approved dates show; Company and Partner dates sit in a collapsible "Company & Partner Dates" accordion | Code unique and case-insensitive; an end date can never be before its start date (picker and server)      |
| After creation        | Admin lands on the project with the setup guide (see section 7)                                                                                   | `?setup=1` on the project address                                                                        |
| Edit                  | Same form as create; the accordion opens by default when company or partner dates exist                                                           | Status options below the current one are disabled                                                        |
| Delete                | Removes the project and everything beneath it                                                                                                     | Written reason of at least 5 characters, recorded in the audit trail                                     |
| Move to In-Progress   | Starts the project                                                                                                                                | Requires a Partner POC, at least one resource and at least one milestone (server returns 422; button disabled with the reasons listed) |
| Move to Completed     | Closes the project                                                                                                                                | Every milestone must be completed and approved; user must type the project code to confirm               |

### Highlight rules

| Viewer      | Colour | Meaning                                                                                                              |
| ----------- | ------ | -------------------------------------------------------------------------------------------------------------------- |
| Admin       | Red    | A partner-denied delay thread or a partner-denied approval awaits the admin (clears once the admin replies or acts)  |
| Admin       | Amber  | No Partner POC or no resources on an unfinished project, or a milestone is ready to submit for approval              |
| Partner POC | Amber  | A milestone awaits their approval, or a delay needs their decision (including after an admin reply)                  |
| Partner POC | Indigo | A newly assigned project; clears the first time they open it (`seen_at` on the assignment)                           |

## 7. Project Detail

The page header shows the project code, title, type, status badge and the approved dates, with the admin's Advance Status button. A health banner above the tabs shows coloured chips for what needs attention. Each project opens into three tabs: Overview, Resources and Milestones (with count badges on Resources and Milestones).

### Health banner

| Viewer      | Chips                                                                                                                                                                  |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Admin       | No Partner POC; no resources; no milestones; milestones awaiting approval submission; delay threads awaiting a partner decision; approvals denied by the partner; denied delay threads needing action |
| Partner POC | Milestones awaiting their approval; delay threads awaiting their decision                                                                                              |

### Setup guide (admin, new projects)

A three-step card guides a new project: assign a Partner POC, assign at least one resource, then add milestones. The milestone step stays blocked until the first two are done, and the guide dismisses itself when all three are complete or when the admin dismisses it. Add Milestone is also disabled in the Milestones tab until a POC and a resource exist.

### Overview tab

Compact layout. Contents:

| Card                 | Contents                                                                                                                                                  | Access     |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Progress tile        | Percentage of milestones completed                                                                                                                        | All users  |
| Milestones tile      | Completed over total, with "n on time · n company delay · n partner delay" underneath                                                                     | All users  |
| Pending approval     | Admin: completed milestones not yet approved, oldest first, labelled Not submitted, Awaiting partner or Denied by partner, with waiting time               | Admin      |
| Pending actions      | Partner: milestones awaiting their approval and delays awaiting their decision, with waiting time                                                         | Partner POC |
| Completion Tracking  | A "days exceeded" badge (project finish, or days overdue so far, against the approved end date) and a verdict line for the approved end date; the Company end date line is admin-only | All users  |

Clicking a row in the pending card switches to the Milestones tab and opens that milestone's side panel.

### Resources tab

Partner POC and Organisation Resources cards with + Assign and remove (admin only).

### Milestones tab

Milestone cards appear in milestone order. Clicking a card opens the milestone side panel (section 8). A card is a single colour that reflects its approval state, with matching icon, text and chips:

| Card colour | When                                                                                          |
| ----------- | --------------------------------------------------------------------------------------------- |
| White       | Not started, in progress, or completed but not yet submitted for approval                     |
| Amber       | Submitted and awaiting the partner, or denied and still open                                  |
| Green       | Approved, and the milestone was completed on time                                             |
| Red         | Approved, and the milestone was completed with a delay                                        |

Each card shows the title, status chip, an "Extended" label for extended milestones, a "Pending approval" or "Approval denied" chip while sign-off is open, the dates and a comment count. Sub-tasks sit in a collapsed accordion (done/total) containing the tick boxes and the + Sub-task action. A card with no sub-tasks and no actions shows only its header.

### Milestone and sub-task actions

| Action                    | Who                       | Blocked when                                                                                      |
| ------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------- |
| + Add Milestone           | Admin                     | No Partner POC or resource yet (UI); project completed                                            |
| Extended milestone option | Admin                     | Tick in the Add Milestone dialog; lifts the project-start date limit and adds the Extended label  |
| + Sub-task                | Admin                     | Milestone is completed; pressing Enter in the dialog adds it                                      |
| Edit names                | Admin                     | Never; one Edit button in the side panel renames the milestone and its sub-tasks (blank names refused) |
| Mark Complete (sub-task)  | Admin                     | Project is not In-Progress; sub-task already complete                                             |
| Mark Complete (milestone) | Admin                     | Any sub-task still open; project is not In-Progress                                               |
| Submit for Approval       | Admin                     | Milestone not completed; no Partner POC assigned; already submitted (a denied one can be re-requested) |
| Approve                   | Assigned Partner POC only | Approval is not open (pending or denied); any delay not yet accepted                              |
| Deny                      | Assigned Partner POC only | Approval is not open (pending or denied); no reason given                                         |
| Override & Approve        | Admin                     | Already approved; milestone not completed; reason shorter than 5 characters                       |
| Delete                    | Admin                     | Never (admin only)                                                                                |

### Completion and date rules

| Rule                     | Detail                                                                                                                                                      |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Completion is final      | Cannot be reversed once marked                                                                                                                              |
| On-Time or Delayed       | Asked at completion; Delayed requires a side (Company or Partner) and a reason (enforced by the server, so a delay thread always has its reason)             |
| Complete and submit      | When a Partner POC is assigned, the completion dialog offers "Also submit for partner approval" (ticked by default) and performs both steps in one action   |
| Completion date          | Stamped by the database, not the server clock                                                                                                               |
| Milestone date ranges    | Each milestone carries company, partner and approved ranges; the approved range governs the card                                                            |
| Milestone start date     | A milestone start (approved, company or partner) cannot be earlier than the project's approved start date, unless the milestone is marked extended          |
| End before start         | Refused for every date range, in the date pickers and on the server                                                                                         |

## 8. Milestone Side Panel

Opens from a milestone card (or from a pending-action row or the notification list on the Milestones tab). Esc, the X or a click outside closes it.

| Section               | Contents                                                                                                                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Header                | Milestone title, status, sub-task count; admin Edit button (rename milestone and sub-tasks)                                                                                    |
| Action strip (partner) | When the milestone awaits the partner: what is needed, how many delay threads must be accepted first, and Approve / Deny buttons                                              |
| Details               | Approved dates (admins also see company and partner dates), and the sub-tasks with their done or open state                                                                    |
| Conversation          | Chat-style thread between admin and Partner POCs (see below)                                                                                                                   |
| Delay threads         | Milestone-level and sub-task-level delay threads with their actions (section 10)                                                                                               |
| Approval              | Status, submitted / denied / approved dates, denial reason, override note, rating and comment (admin only), and the approval actions                                           |

### Conversation

| Aspect          | Detail                                                                                                                                                                  |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Who             | Admin and the project's Partner POCs; out-of-scope users cannot read or post                                                                                           |
| Posting         | At any time while the milestone is not approved; up to 2000 characters; @mentions; Ctrl/Cmd+Enter sends                                                                |
| Target          | The whole milestone or one of its sub-tasks (a "Sub-task: …" tag marks the message)                                                                                    |
| Closing         | Once the milestone is approved the conversation becomes read-only; a denied approval stays open                                                                         |
| Live updates    | The panel refreshes every 15 seconds while open; the card's comment count includes conversation messages                                                                |
| Decisions       | A partner denial and an admin override are also posted into the conversation ("Approval denied: …", "Approved by admin override: …")                                    |
| Audit           | Each message is recorded in the audit trail (`comment_posted`)                                                                                                          |

## 9. Approval Workflow

A milestone is approved only after every delay on it has been accepted, unless the admin overrides. The gate reads the database rather than the request.

| Step | Actor       | Action                                                                                    | Result                                                                                       |
| ---- | ----------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 1    | Admin       | Completes every sub-task, then marks the milestone complete (optionally submitting at once) | Final; cannot be reversed                                                                    |
| 2    | Admin       | Submit for Approval                                                                       | Approval set to pending; the milestone card turns amber                                      |
| 3    | Partner POC | Decides each delay (section 10)                                                           | Each decision written by its own authorised request                                          |
| 4a   | Partner POC | Approve with a 1 to 5 rating and a comment                                                | Allowed only when every delay is accepted; approval becomes approved; the conversation closes |
| 4b   | Partner POC | Deny with a written reason                                                                | Approval becomes denied and stays open; the reason appears in the conversation               |
| 5    | Both        | Discuss in the conversation                                                               | The partner can then approve, or deny again with a new reason                                |
| 6    | Admin       | Ask Partner to Re-review (optional)                                                       | Sends a denied approval back to pending and notifies the partner again                       |
| 7    | Admin       | Override & Approve (at any point before approval)                                         | Approves on the partner's behalf with a reason of at least 5 characters; recorded in the audit trail and shown to the partner |

| Approval state | Meaning                                              | Partner options       | Admin options                                  |
| -------------- | ---------------------------------------------------- | --------------------- | ---------------------------------------------- |
| (none)         | Completed but not submitted                          | None                  | Submit; Override & Approve                     |
| Pending        | Submitted, waiting for the partner                   | Approve; Deny         | Override & Approve                             |
| Denied         | Partner denied; open for conversation                | Approve; Deny again   | Ask to Re-review; Override & Approve           |
| Approved       | Closed; conversation read-only                       | None                  | None                                           |

| Control          | Detail                                                                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Approval gate    | No "I agree" payload exists for a crafted call to fabricate                                                                                |
| Approve button   | Disabled while anything is outstanding; the dialog names what is blocking it and links to the delay threads                                |
| Concurrency      | Approve, deny and override only update a row that is still open, so two actors cannot both succeed                                         |
| Override and delays | An override bypasses open delays but does not resolve them; they remain visible                                                         |
| Feedback privacy | Rating and comment are company-side only; the serialiser withholds them from partners instead of relying on the client to hide them         |
| Override visibility | The override note and a partner's denial reason are visible to both sides                                                               |

## 10. Delay Negotiation

A milestone completed late opens a delay thread (side and reason supplied at completion). The thread ends when the POC accepts the delay or the admin closes it.

| Thread state | Partner POC options                        | Admin options                   | Next state                                   |
| ------------ | ------------------------------------------ | ------------------------------- | -------------------------------------------- |
| Pending      | Accept delay; Deny delay (reason required) | None                            | Accepted or Denied                           |
| Denied       | Accept and close; Reply                    | Reply; Close Thread             | Accepted when the POC accepts or the admin closes |
| Accepted     | None                                       | None                            | Closed to everyone; cannot be reversed       |

| Rule                   | Detail                                                                                                                                  |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Deny requires a reason | Accept does not                                                                                                                         |
| Accept is final        | Cannot be undone by denying afterwards, so a closed thread stays closed                                                                 |
| Admin reply            | Only on a denied thread; the interface offers a single admin reply before Close Thread (this limit is enforced in the interface only)    |
| Admin Close Thread     | Force-accepts a denied thread, recorded as `delay_closed` in the audit trail                                                            |
| Enforcement            | Rules live in rules.js; the API refuses invalid actions, hiding a button is not the protection                                          |
| Sub-task delays        | The interface and API support threads tied to a sub-task, but nothing currently creates them; delays are created at milestone completion |

## 11. Attachments

One file per delay-thread message, up to 10 MB, in pdf, doc, docx, xls, xlsx, png, jpg or jpeg. The API is complete; the current interface does not yet expose an attach control.

| Step | Upload flow (three steps, because a serverless request body caps at 4.5 MB)                              |
| ---- | -------------------------------------------------------------------------------------------------------- |
| 1    | Server checks permission and issues a signed upload URL                                                  |
| 2    | Browser PUTs the file directly to Supabase Storage                                                       |
| 3    | The message claims the object; the server re-reads its real size and type instead of trusting the client |

| Control      | Detail                                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Download     | 60-second signed URL forcing Content-Disposition: attachment; both roles can download anything on a project they can see |
| File type    | Extension is the gate; MIME type is derived from it, never trusted from the client                                       |
| Storage path | Object name is a UUID, so nothing user-controlled reaches a path                                                         |
| Bucket       | Private and never served statically                                                                                      |
| Cleanup      | Unclaimed uploads swept by the scheduled job                                                                             |

## 12. In-App Notifications

The top-bar inbox shows a count badge when something awaits the signed-in user. It refreshes on every page change and each time it is opened.

| Viewer      | Entries                                                                                                                                                               | Where a click goes          |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| Partner POC | One entry per action, each with the project code and milestone: New project assigned; Milestone awaiting your approval; Delay awaiting your decision; Admin replied to your denied delay | That project's page         |
| Admin       | Counts: milestones ready to submit for approval; approvals denied by the partner; denied delay threads needing a response                                             | The projects list           |

Project list rows and the project health banner use the same rules (section 6). A new-project entry clears the first time the partner opens the project.

## 13. User Management (Admin)

Two tables are maintained: Company Resources and Partner POCs.

| Action            | Behaviour                                                                                                       | Safeguard                                                                                                                             |
| ----------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| + Add Resource    | Name and job title; no login                                                                                    | Directory record only                                                                                                                 |
| + Add Partner POC | Name, email and password (minimum 10 characters); creates the Supabase Auth user and the directory row together | If the second write fails, the first is rolled back manually, as no transaction spans both systems                                    |
| Edit              | Rename, change email, optionally reset the password                                                             | Recorded in the audit trail                                                                                                           |
| Delete            | Removes the user and reports how many projects they were unassigned from                                        | Cannot delete your own account; login removed first, so a partial failure leaves the user unable to sign in rather than still able to |

## 14. Audit Trail (Admin)

| Aspect          | Detail                                                                                                                                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Events captured | Every state change: projects, milestones, sub-tasks, assignments, approvals (submitted, resubmitted, approved, rejected, overridden), delay decisions (accepted, denied, closed), conversation messages, user management, password changes |
| Viewing         | Search, filter by category, sort, paginated                                                                                                                                                                  |
| Retention       | 2 years by age, pruned on a schedule; rows are never trimmed on write, so it remains a true audit trail rather than a recent-activity feed                                                                  |

## 15. Email Notifications (Deferred)

Email notifications are out of scope for the current phase; users rely on the in-app indicator (section 12) and must sign in to see items awaiting them.

| Deferred scenario                 | Would notify             |
| --------------------------------- | ------------------------ |
| Milestone submitted for approval  | Every POC on the project |
| Milestone approved                | Submitter                |
| @mentioned in a comment           | Each mentioned person    |
| Project completed                 | To be confirmed          |
| Newly assigned as POC             | Assigned POC             |
| Delay denied                      | Submitter                |
| Approval denied                   | Admin                    |
| New conversation message          | The other party          |
| Admin replied on a denial         | POC                      |

Also deferred: the outbox, delivery worker, retry and dedupe mechanism, and the /api/emails admin endpoint. Password reset emails sent by Supabase Auth remain in scope, as sign-in recovery depends on them.

## 16. Data Model Changes Since the Original Schema

| Migration                          | Change                                                                                                                                 |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 001_schema.sql                     | Base schema: people, projects, assignments, milestones, sub-tasks, approvals, attachments, delays, delay messages, audit log, rate limits |
| 002_assignment_seen.sql            | `project_assignments.seen_at`; drives the Partner POC "new project" highlight                                                          |
| 003_approval_reject_override.sql   | Approval status gains `rejected`; adds rejected_at/by, rejection_reason, overridden_by, override_reason                                |
| 004_milestone_comments.sql         | `milestone_comments` table for the admin and partner conversation                                                                      |
| 005_milestone_extended.sql         | `milestones.is_extended` flag                                                                                                          |

## 17. Operations

| Endpoint                | Access          | Purpose                                                        |
| ----------------------- | --------------- | -------------------------------------------------------------- |
| GET /api/health         | Unauthenticated | Shallow health check                                           |
| GET /api/ready          | Admin           | Database status                                                |
| GET /api/me/pending     | Signed in       | Pending-action entries for the notification indicator          |
| GET /api/dashboard      | Signed in       | Role-based delivery overview (range and, for admins, partner filter) |
| POST /api/internal/cron | Shared secret   | Sweeps unclaimed uploads, prunes rate limits and audit records |

| Script                | Purpose                              |
| --------------------- | ------------------------------------ |
| npm run migrate       | Apply database migrations (also run on every backend build) |
| npm run seed          | Load seed data                       |
| npm run setup:storage | Provision storage buckets            |
| npm run doctor        | Environment and configuration checks |
| npm run test          | Run the automated test suites        |

Deployment: the API and the static frontend deploy to Render from the `main` branch (see render.yaml); the frontend's development server proxies `/api` to the deployed API.

## 18. Platform Guarantees

| Guarantee                              | Detail                                                                                                                                                                                        |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Three server-side authorisation layers | Identity (guards.js), then scope as SQL so out-of-scope rows return 404 (scope.js), then the state machine (rules.js); client-side rule copies exist only to explain why a button is disabled |
| Irreversible actions confirm twice     | Completing a project requires typing the project code; deleting one requires a written reason                                                                                                 |
| Flat reads                             | One query per table for a whole result set rather than a query per row                                                                                                                        |
| Automated testing                      | Six suites: schema, API, concurrency, N+1 query budget, dashboard (authorisation, range and partner filters, drill-down filters, and metric definitions checked against real rows inside a rolled-back transaction) and frontend in a real browser. The newest approval, conversation, extended-milestone and notification features do not yet have dedicated tests. Five schema checks fail because they expect columns the schema never had (projects.start_date, milestones.due_date, attachments.project_id) |

## 19. Known Limitations

| Area                | Limitation                                                                                                                             |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Delay threads       | The single-admin-reply limit is enforced in the interface only, not by the API                                                         |
| Multi-step writes   | Accept, deny and close update the thread, add a message and write the audit entry as separate statements without a transaction        |
| Delay concurrency   | Accept, deny and close check the thread state before writing but do not guard the write itself                                         |
| Audit coverage      | Delay replies are not written to the audit trail                                                                                       |
| Attachments         | No attach control in the interface                                                                                                     |
| Notifications       | No in-app indicator for a new conversation message; email deferred                                                                     |
| Data cleanliness    | Milestones completed late before the delay-reason rule was enforced may have no delay thread                                           |
