# ICS form update

## Install

1. Extract **ICS_Form_Updated.zip**.
2. Copy the included **User** and **logo** folders into your existing Capstone-IMS project. Allow the matching files to be replaced.
3. Restart your normal local server or redeploy as usual.
4. Open **User/ics-form.html** and press **Ctrl + F5**.

Use the complete-system ZIP if you prefer to replace the full source folder. This update uses the existing submission service and does not need a new SQL patch.

## Updated design

- Visitor-style layout: evergreen welcome panel, one property illustration, and a clear form panel.
- Five steps: reference numbers, property details, cost and procurement, accountability, then review and submit.
- Required-field progress, inline validation, Back and Continue buttons, and Edit links on the review page.
- Automatic quantity × unit cost calculation, a clear confirmation receipt, and a new-form action.
- Responsive light and dark appearances, large mobile inputs, keyboard focus, and a readable printed receipt.
- The authenticated **Fill Up ICS Form** dialog has matching section cards, field spacing and a fixed action footer.

The original 18 field names and the existing `submit_public_ics` request contract are retained. Failed unchanged retries reuse the same submission reference, and repeated submit events are blocked while a request is pending. Input text is inserted safely in the review screen.

## Main files

- `User/ics-form.html` — public form and review layout.
- `User/ics-form.css` — public ICS styles and one property illustration.
- `User/ics-form.js` — wizard, validation, calculations, existing API submission and receipt.
- `User/ics-details.css` — staff form dialog and registry review states.
- `User/ics.html` — refreshed stylesheet reference for the staff dialog.

The patch also includes the shared User theme and presentation files it needs. Keep their filenames intact. The **(1)** suffix from chat downloads is not part of the code filenames.

## Verification

The updated ICS form passed 25 automated scenarios with intercepted API responses and local fixture records, covering both themes, five screen widths, validation, numeric bounds, calculations, review edits, safe text rendering, successful submission, retries, offline errors, duplicate submission prevention, receipt printing and staff dialog sizing. No live database record was submitted during these checks.

Test source and results are in `verification/ics-form` in the complete-system ZIP.
