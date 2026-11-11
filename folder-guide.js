export const LIBRARY_README=`SDS Desk library
================

Open this collection in SDS Desk by selecting its parent folder in Settings.
This folder contains the original PDFs, library records and internal metadata.

Folders and files
-----------------
documents/  Original supplier PDFs, grouped by product. Open these PDFs to read them.
records/    Record versions and history. IDs keep shared edits and history linked.
_system/pdf-index/     Links between PDFs and their current document paths.
_system/pending-pdfs/  Imported PDFs awaiting a verified organised copy. Some may be retained for recovery.
_system/recovery/      Recovery copies, rename logs and readable recovery reports.
index.json             A generated catalogue summary. SDS Desk can rebuild it.
README.txt             This guide.

Safe maintenance
----------------
Use Settings > Advanced > Update document names to preview and apply new PDF names.
Use Settings > Advanced > Clean duplicate copies to remove only verified pending duplicates.
Use Settings > Advanced > Check library health to identify unreadable records or missing PDFs.
Do not manually rename or delete documents, record versions, PDF indexes or pending files.
Historical PDFs and records in Trash are retained. Duplicate cleanup does not remove them.

Sharing and backup
------------------
Let OneDrive or Dropbox finish syncing before editing and after saving.
Close other SDS Desk windows before maintenance. Prefer one editor at a time.
Keep the collection available offline on each computer that uses it.
Download ZIP backups regularly and store them OUTSIDE this SDS-Desk folder.
Keeping backup ZIPs inside this folder causes later backups to include earlier backups.
Restore a full backup into an empty connected folder when recovering a collection.
Cloud sync is not a backup. Clearing browser site data can remove browser-only libraries.

Original documents
------------------
Read the supplier PDF for safety information. Check extracted details and suggested dates.
Filename changes do not change PDF contents, record IDs, review dates or document history.
`;
export function recoveryReadme({originalPath,reason,created}){return `SDS Desk recovery copy\n======================\nCreated: ${created}\nOriginal location: ${originalPath}\nReason: ${reason}\n\nThe original file was confirmed empty before being moved out of the active records folder.\nThe copy and its audit information are kept here. No non-empty record was automatically removed.\nDo not copy this empty file back into records. Keep this folder with your backups.\n`}
