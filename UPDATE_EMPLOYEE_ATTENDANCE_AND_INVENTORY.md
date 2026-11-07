# Employee registration, personal attendance and inventory update

My Attendance now shows the record count on each tab and opens Uniform Monitoring automatically when it has records and Flag Ceremony is empty. For a project already using the User Attendance Only update, copy the updated `User/my-attendance.html`, `User/my-attendance.js`, and `User/my-attendance.css` files and reload the page.

## Latest User side change

Employee Profiles/Directory is now Admin-only. The User menu and dashboard show **My Attendance** for personal monitoring. Old Employee page bookmarks redirect to My Attendance and do not load personnel profiles.

Attendance and uniform changes made by Admin refresh the matching User's open attendance page through a private account revision signal. The page also refreshes when returning to the tab and keeps its Refresh button. If Admin links an older account by employee number while My Attendance is already open, the linked records appear automatically.

For this follow-up update, run the latest `supabase/EMPLOYEE_REGISTRATION_AUTO_SYNC_PATCH.sql` again and redeploy the website files. If you already deployed `employee-register` from the preceding update, that Edge Function does not need to be redeployed again for this change.

## Apply this update to your current system

1. Extract this project and replace your website files with this version.
2. Open your existing Supabase project → SQL Editor. Run the **whole** file `supabase/EMPLOYEE_REGISTRATION_AUTO_SYNC_PATCH.sql` **last**. It includes the employee-link and attendance changes. You do not need to rerun the older account patches on an existing system. Keep the current database and its records.
3. If you have not deployed the preceding registration update, deploy its function from the project root:

   ```powershell
   supabase functions deploy employee-register --project-ref zssrxubajhqryrwijyzm --no-verify-jwt
   ```

   Use your own project reference if you changed Supabase projects. If using the Dashboard editor, include `supabase/functions/_shared/employee-accounts.ts` as well as the registration `index.ts` file. The `supabase/` folder at the project root is the canonical deployment folder.
4. Publish/redeploy the website files, then refresh the browser. Uploading the website alone does not run the SQL patch or redeploy the Supabase function.

For a completely new database, first follow the existing base setup in `ADMIN_USER_SETUP.md`, then apply the auto-sync patch last. Existing Admin001 setup and account approval continue to work.

## Account and employee flow

- A staff member enters their employee number, name, office division, optional position and password. No Employee Directory verification button is needed.
- Registration creates a basic Employee record automatically. If that employee number is already encoded, the account links to that existing record and keeps its personnel details and attendance history.
- The account, Employee link and pending account request are created in one database transaction. A failed registration does not leave an extra Employee record.
- The account remains **Pending** until the administrator approves it. Admin opens **Employees → pencil/Edit** to complete the remaining personnel details on the existing record.
- One employee number can have one account or pending request. Matching ignores case and surrounding spaces. Leading zeroes remain significant: `0007` and `7` are different employee numbers.

Separate first, middle, last and extension fields send the correct name parts to the Employee masterfile. The earlier full-name-only form remains compatible with the updated registration service.

## Attendance and uniform monitoring

1. Admin opens **Employees**, selects the employee and records their flag ceremony attendance or uniform monitoring.
2. After account approval, that employee opens **My Attendance** on the User side.
3. Only that employee's attendance and uniform entries are returned. URL parameters, browser caches and editable user metadata cannot choose another employee's history.

The Employee masterfile and directory remain on the Admin side. User accounts cannot call the personnel-directory RPC, read other employees' update signals or edit their employee link.

The account uses the permanent Employee record ID internally. Admin can correct a name or employee number while keeping the same attendance history. Do not add a second Employee record for the same person.

The patch links older employee-ID accounts with sufficient identifying information. Its result reports linked and unlinked User counts. For an older email account that remains unlinked, an authorized Admin can explicitly link an existing Employee record:

```sql
select public.pgenro_link_employee_account(
  '<REAL_AUTH_USER_UUID>'::uuid,
  '<EXISTING_EMPLOYEE_NUMBER>'
);
```

Use the real account UUID and employee number. If the patch reports duplicate employee numbers, correct those duplicate numbers before rerunning it. The update does not merge or delete personnel or attendance records.

## Inventory: one pencil button

Each item now has one **pencil** entry point for these tabs:

| Tab | Use |
| --- | --- |
| Item details | Update the item name, specifications, unit, threshold and remarks. |
| Stock movement | Record Stock In, Stock Out or a stock adjustment for the selected item. |

The separate Record Movement button and row arrow button have been removed. Select the item's pencil, open **Stock movement**, enter the quantity and reference, then click **Record Transaction**. The existing stock transaction and movement history remain in use. Stock Out above the available balance is refused.

Current quantity is read-only while editing an existing item's details. Use Stock movement to change it so the history records the transaction. New items still accept an initial quantity.

## Validation

The local checks exercise production SQL on normalized and JSON-backed employee tables, the actual registration handler and application pages with isolated browser fixtures. They do not contact or modify the hosted database. See `verification/employee-sync/README.md` for commands and results.
