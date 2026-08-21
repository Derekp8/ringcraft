# Project Ringcraft PWA Human Install Review

This checklist is intentionally unexecuted until a human reviewer performs each item on the candidate build. Automated Chromium installability/offline checks do not substitute for desktop install, Start Menu, standalone-window, or hands-on save/update review.

| ID | Human check | Result | Evidence / notes |
|---|---|---|---|
| PWA-H01 | Install hosted Ringcraft from Chrome or Edge on Windows. | NOT RUN | |
| PWA-H02 | Verify the Ringcraft desktop / Start Menu application icon. | NOT RUN | |
| PWA-H03 | Launch installed Ringcraft from the installed application entry. | NOT RUN | |
| PWA-H04 | Confirm standalone presentation without a normal browser tab/address bar where supported. | NOT RUN | |
| PWA-H05 | Play an Exhibition match through completion. | NOT RUN | |
| PWA-H06 | Open Career, save, load, and confirm the expected Career returns. | NOT RUN | |
| PWA-H07 | Close the installed app completely and reopen it. | NOT RUN | |
| PWA-H08 | Disconnect networking and reopen an already-warmed installed app. Confirm the local application shell and local save access remain available. | NOT RUN | |
| PWA-H09 | Restore networking and confirm normal online behavior resumes. | NOT RUN | |
| PWA-H10 | Deploy/install a newer candidate build and verify the application updates without losing the reviewed Career/save data. | NOT RUN | |

## External boundary

Do not mark `PWA RELEASE-CANDIDATE READY` until PWA-H01 through PWA-H10 have actually been executed and the evidence is recorded here or in an equivalent signed review record.

Before destructive browser/profile testing, export important Career data using Ringcraft's existing Campaign JSON or save-bundle export controls.
