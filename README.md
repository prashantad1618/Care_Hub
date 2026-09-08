# UCC CareHub — Full Live App

This package keeps the full CareHub interface from the uploaded app, but removes the demo/localStorage data layer and connects it to the production Supabase project.

## Public cPanel upload
Upload/replace ONLY these files in `app.unitecanberracare.com.au`:
- index.html
- app.js
- config.js
- manifest.json
- sw.js
- ucc-logo.png

Do NOT upload the `database` folder to cPanel.

## Main production behaviour
- Real Supabase email/password authentication
- Manager / Admin role validation
- Manager + Support Worker mode switching
- Staff profiles from `profiles`
- Sites / houses / client homes from `sites`
- Clients from `clients`
- Site/location based clock-in
- Support workers see client care records only for their current clocked-in site
- Roster and shift publishing
- Timesheet approvals
- Progress notes, medication, health records, handover and incidents
- Training/compliance
- Notifications
- No localStorage demo records

After uploading all files together, close old CareHub tabs and reopen:
`https://app.unitecanberracare.com.au/?v=full-production-20260906`


## 2026-09-06 care documentation upgrade
- Cleaner responsive Progress Notes page
- Cleaner responsive Medication page
- View / Edit / Delete controls for notes and medication records
- Form validation and newest-first record history
- Cache version updated so browsers receive the new app files

Upload all production-named files from this folder to the CareHub cPanel app directory.
If Edit/Delete shows a Supabase RLS error, run `carehub-edit-delete-rls.sql` in Supabase SQL Editor.


## 2026-09-06c care forms update
Progress Notes, Medication, Health Records, Handover and Incidents now use the same responsive card layout with history plus View/Edit/Delete actions.


## Timesheet manager upgrade
- Manager can add a manual timesheet when staff forgot to clock in or clock out.
- Manager can View, Edit, Delete and Approve timesheets.
- Manual entries support overnight shifts by choosing the next calendar day for Clock Out.
- Support workers can view their own timesheets, but manager-only correction controls remain restricted in the interface.
- If Supabase reports an RLS error for manual/edit/delete, run `carehub-edit-delete-rls.sql` in the Supabase SQL Editor.


## PDF / Excel downloads
The top bar now includes PDF and Excel export buttons. They export the currently open CareHub list/table, including staff, clients, sites, roster, timesheets, progress notes, medication, health records, handovers, incidents, compliance, documents, notifications and online staff.


## Timesheet hours reporting update
Timesheets now show Day, Day Category (Weekday/Saturday/Sunday), worked hours, and a per-staff Hours Summary. PDF and Excel exports include weekday, Saturday, Sunday and total hours.

## Manager Settings upgrade
The old technical Settings page has been replaced with useful manager settings:
- Company details and report branding
- Weekday, Saturday, Sunday, public holiday and sleepover pay-rate fields
- Default Day/Evening/Night/Sleepover roster times
- Manual timesheet and auto-approval preferences
- Shift, clock-in and compliance reminder timing
- Documentation/permission preferences
- PDF/export preferences

Before saving Settings for the first time, run `carehub-settings.sql` once in Supabase SQL Editor.

## KM / Client Travel upgrade
Run `carehub-km-travel.sql` once in Supabase SQL Editor before using the new KM fields.
Timesheets now support KM travelled, travel purpose, from/to locations and travel notes. Managers can set a KM reimbursement rate in Settings. The Timesheet Hours Summary, PDF and Excel exports include total KM and calculated reimbursement. Support workers can use the `KM / Travel` action on their own timesheet; managers can also enter or edit KM in manual/edit timesheets.


## Individual staff pay & KM rates (new)
Run `carehub-staff-rates.sql` once in Supabase SQL Editor.

Then in CareHub: Manager Mode → Staff Management → **Pay & KM Rates**.
Each support worker can have their own weekday, Saturday, Sunday, public holiday, sleepover and KM reimbursement rates. Blank individual fields fall back to the default rates in Settings.

Timesheet Hours Summary, PDF and Excel reports use the individual worker rate where configured. Pay-rate records are stored in a manager-only table so support workers cannot read other staff wage rates.


## Unrostered clock-in
Run `carehub-unrostered-clockin.sql` once in Supabase SQL Editor. This adds optional client tracking plus an unrostered flag/reason to timesheets. If a support worker has no rostered shift for today, Clock In opens a selector for Site / House or Client. These entries are clearly marked Unrostered for manager review.

## Unrostered client access approval
Run `carehub-client-access-approval.sql` once in Supabase SQL Editor.

When a support worker clocks in without a roster:
- they may select a site/house or client and clock in;
- CareHub automatically creates a Pending client access request;
- client care pages remain locked while the request is Pending or Denied;
- a manager/admin can Approve or Deny the request from the Manager Dashboard;
- approved access is temporary and is ended when the worker clocks out (with a 12-hour safety expiry as well).

## Client Care Profile upgrade (7 Sep 2026)
Run `carehub-client-care-profile.sql` once in Supabase SQL Editor before using the new client-care-profile fields.

Client Management now includes support categories, key alerts, mobility, communication, medication support, BSP/behaviour information, diet/meal requirements, preferred routine, a prominent "What staff must know before shift" section, emergency/family contacts, support coordinator and GP/clinical contacts. Support workers can only see clients already permitted by the existing CareHub roster/site/access rules; managers can add and edit the care profile.

## Incident attachments + email (2026-09-07)
Run `carehub-incident-files.sql` once in Supabase SQL Editor before using the new attachment feature.

Incident Reports now support:
- Multiple file uploads from computer/phone/device (PDF, JPG/PNG, Word, Excel, TXT; max 15 MB each)
- Files stored privately in the Supabase `incident-files` bucket
- Attachment viewing/deleting from the incident record
- Email action that opens the user's default mail application with the incident details and one-hour secure attachment links
- Optional "Prepare email after saving" flow

Important: the Email button prepares an email in the device's configured email client. It does not silently send mail from the browser. For true one-click server-side email sending, configure a mail provider (for example Resend/SMTP) through a Supabase Edge Function; never put a mail-provider secret key in `config.js` or other browser files.

## Automatic incident email (2026-09-07 upgrade)

This package now supports the complete incident workflow requested:

1. Staff completes the incident form.
2. Staff selects one or more files before submitting.
3. CareHub saves the incident and uploads files into the private `incident-files` Supabase Storage bucket.
4. If **Email UCC automatically after submission** is enabled, CareHub calls the `send-incident-email` Supabase Edge Function.
5. The Edge Function sends the incident to the manager-configured recipient and optional CC address. Supporting files are included as private signed links valid for 24 hours.
6. CareHub records `Pending`, `Sent`, or `Failed` email status on the incident.

### One-time database step
Run `carehub-incident-auto-email.sql` in Supabase SQL Editor. If you have not previously enabled incident files, also run `carehub-incident-files.sql`.

### Configure the recipient in CareHub
Manager Mode → Settings → **Incident Email Notifications**:
- Incident report recipient
- CC recipient (optional)
- Automatically email UCC after submission

### Deploy the Edge Function
The function source is included at:
`supabase/functions/send-incident-email/index.ts`

Deploy it from a computer with the Supabase CLI connected to this project:

```bash
supabase functions deploy send-incident-email
```

Add these Edge Function secrets (do NOT put them in `config.js` or `app.js`):

```bash
supabase secrets set RESEND_API_KEY=YOUR_RESEND_API_KEY
supabase secrets set INCIDENT_FROM_EMAIL="UCC CareHub <incidents@your-verified-domain.com.au>"
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are read by the function from the Supabase Edge Function environment.

For initial Resend testing, `INCIDENT_FROM_EMAIL` may use a sender allowed by your Resend account. For production, verify the organisation's sending domain with the email provider.


## Logged-in staff identity on incident emails

Incident emails now automatically identify the staff member who submitted the report from their authenticated CareHub profile. The email includes the staff member's name and CareHub login email. The email is still sent securely by the `send-incident-email` Edge Function; staff do not need to connect Gmail or Outlook and no staff email password is stored in CareHub.

The Edge Function also sets the email **Reply-To** address to the reporting staff member's CareHub email when one is available. This lets UCC management reply directly to the worker who submitted the incident while keeping the sender address as the verified UCC/Resend sender.


## 2026-09-07 — Shift compliance + house handover + GPS clock-in
Run `carehub-shift-compliance-handover-geofence.sql` once in Supabase SQL Editor before using this upgrade.

New behaviour:
- Progress notes are linked to the current timesheet and show staff, site, shift time and worked hours.
- Clock out is blocked until required shift documentation is complete.
- A progress note is required for supported clients before clock out.
- Medication documentation is required for Medium/High-risk clients whose profile says staff medication support is required.
- SIL/shared-house shifts require a house/site handover before clock out.
- Handovers belong to a site/house; client is optional.
- Handover task status: Not Done / In Progress / Done / Not Required.
- Handover Acknowledge and Mark Done buttons record staff and timestamps.
- Staff clock-in is geofenced to the registered site/client location. Managers configure site latitude/longitude and radius under Sites / Houses.
- Login itself remains available anywhere so staff can view roster/notifications; only Clock In is location-restricted.


## Smart current-roster Clock In fix (7 Sep 2026)
- Clock In no longer uses the first/previous roster record as the default site.
- CareHub resolves the roster shift that is actually active now (including overnight shifts).
- If multiple current shifts match, staff must choose the correct shift.
- If no current roster matches, the unrostered Site/Client clock-in form opens.
- GPS is checked against the selected shift site before clock-in.
- A confirmation screen shows site, shift time, optional client and distance from the site.
- No new SQL is required for this fix.


## 07 Sep 2026 — Notifications & Manager Offline upgrade

Run `carehub-notifications-manager-offline.sql` once in Supabase SQL Editor, then upload the updated web files to cPanel.

New behaviour:
- Notifications can be marked Read individually or all at once.
- Read notifications can be cleared, and individual notifications can be cleared.
- Online Staff has a manager-only **Offline / Clock Out** action for forgotten clock-outs.
- Before manager clock-out, CareHub checks Progress Note, applicable Medication, and House Handover requirements.
- If documentation is missing, the timesheet becomes **Pending Documentation** and the staff member receives a pending notice.
- Staff can reopen the care documentation pages after a manager-forced clock-out to finish records linked to that pending shift.
- Manager-forced clock-outs are audit-tagged when the new SQL has been run.

## Staff Availability + 24-hour Shift Confirmation + Open Shifts
Run `carehub-staff-availability-open-shifts.sql` once in Supabase SQL Editor before uploading the new app files.
- Staff can submit Available, Preferred or Unavailable time ranges.
- Smart Roster uses availability when ranking staff.
- Directly assigned shifts require Confirm/Decline within 24 hours.
- Managers can publish an Open Shift with no staff assigned.
- Staff can pick open shifts; the first successful claim gets the shift immediately.
- Existing rostered shifts are preserved and marked Confirmed by the migration.


## Persistent availability upgrade
- Regular weekly availability now repeats every week and remains active until staff or a manager changes/deletes it.
- Temporary date exceptions override the normal weekly pattern only for that specific date.
- Smart Roster uses the date exception first, otherwise the recurring weekly pattern.
- Explicit Unavailable status blocks open-shift pickup until availability is changed or a manager intervenes.
- Staff and managers can edit/delete availability entries.

Run `carehub-staff-availability-open-shifts.sql` again once. The migration is additive/idempotent and preserves existing availability and roster records.

## Consolidated v1.2 verification
After upload, open Roster & Shifts. A blue banner must say **Consolidated roster build active** and the sidebar/footer version must say **UCC CareHub v1.2 • Availability + Roster Actions**. If you do not see these exact words, the browser is still loading an older app.js/index.html.

This build includes a visible Staff Availability button on the Roster page as well as the sidebar Availability menu. Manager roster rows include View, Edit, Duplicate, Cancel and Delete actions. Delete is blocked when a linked timesheet/care record exists; use Cancel instead to preserve the audit trail.
