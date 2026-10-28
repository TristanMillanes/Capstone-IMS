# Transfer the lightweight update into your Capstone project

1. Cancel the transfer that stopped at 49%.
2. Download `Capstone-IMS-Lightweight.zip` and use Extract All to extract it into a separate folder, such as Downloads.
3. Open the extracted `Capstone-IMS` folder. Copy its contents into your existing Capstone project folder. Choose Replace files when prompted. Copy the contents into the existing project root; do not nest a second project folder inside it.
4. Open the project through your usual web server, or redeploy it using your usual process. Refresh the administrator page after updating.

This is the same updated application, with Git history, the bundled Python environment, caches, and verification fixtures removed from this transfer copy. Application code, official document templates, fonts, vendor libraries, SQL patches, deployment configuration, and setup instructions are retained unchanged. Merging these files does not remove your existing local environment.

The public Service Request form opens without sign-in. The administrator Service Requests page includes the review queue, source/status filters, status processing, PDF/Word downloads, and Print Form.

If you already applied `supabase/PUBLIC_SERVICE_REQUEST_PATCH.sql`, there is no new SQL for the administrator update. Otherwise follow `PUBLIC_SERVICE_REQUEST_SETUP.md`. Administrator instructions are in `ADMIN_SERVICE_REQUEST_UPDATE.md`.

For a fresh Python installation, install the packages listed in `requirements.txt` in a new local environment. An existing working project can keep using its current environment.
