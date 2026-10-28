PGENRO SERVICE REQUEST UPDATE

Installation
1. Keep a backup of your current serviceAdmin.html, serviceAdmin.css and
   serviceAdmin.js.
2. Copy ALL contents of this folder into the same PGENRO admin folder that
   currently contains serviceAdmin.html. Replace the three existing files.
   Keep the vendor and assets subfolders, and serviceRequestFile.js, beside them.
3. Keep your existing ../shared/supabase.js and the rest of your PGENRO system.
4. Open PGENRO through your existing web server or Live Server, sign in as an
   administrator, and refresh the service request page.

How it works
- Complete the three form steps, then choose SAVE & VIEW FILE. The record is
  saved through your existing Supabase connection, and the completed official
  service request form opens automatically.
- VIEW FILE in the form previews the entries before saving. BACK TO FORM
  returns to the same entries. A preview does not save a record.
- VIEW FILE beside a saved request opens its completed form again. EDIT loads
  the request into the form. Saving edits regenerates the document.
- DOWNLOAD PDF saves the completed printable form. OPEN PDF opens it in a
  separate browser tab, where the browser also provides printing controls.
- DOWNLOAD WORD fills an editable .docx based on the form you supplied,
  including the checkboxes, client information and course of action.
- Long entries continue on additional pages instead of being cut off.
- Options matching the printed form were added to the category lists. Existing
  options are retained and appear under Others when there is no exact match.

Included files
serviceAdmin.html               Updated module page
serviceAdmin.css                Existing styles plus file viewer styles
serviceAdmin.js                 Existing module plus file actions
serviceRequestFile.js           PDF and Word generation and preview
assets/service-request/         Word/PDF templates, field map and font
vendor/                         Bundled document and preview dependencies

Notes
- No SQL migration, Edge Function or additional service is required. The module
  uses the existing service_requests table and preserves the supplied support
  for both a JSON data column and direct columns.
- Completed files are generated in the browser from the saved request data.
  They are not automatically uploaded to a Supabase Storage bucket. They can be
  regenerated whenever VIEW FILE is selected, or saved with DOWNLOAD.
- The original logos, privacy statement, form number and footer were retained.
  Spacing was adjusted so the last workflow row clears the footer. The form
  uses its supplied 8.5 by 13 inch page size.
- Printed names are filled. Handwritten signatures and PIC initials remain
  available for the actual signatories.
- The supplied module has no supporting document upload field. WITH/WITHOUT
  is left unmarked unless an existing record explicitly includes attachment
  information. This update does not invent an attachment declaration.
- If generation fails, the saved record remains saved. The viewer shows an
  error and RETRY. Verify that all assets and vendor files were copied.
- The included document tools load locally. Your existing Supabase SDK and
  Google font references still use the connections already in your module.

Verification
See VALIDATION.txt for the checks completed for this package.
