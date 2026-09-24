# Company announcements — what is built, and the LINE OA mode that is not

Built 24 Sep 2026 on `feat/announcements`. Owner's rulings: หัวหน้า + admin write and send; staff read; phase 1 sends through the person's own LINE (LIFF share picker) only.

## Built

| Piece | Where |
|---|---|
| Status table (draft → ready → published → sent / partiallySent, cancelled) | `src/lib/announcementStatus.ts`, rules `announcementMove()` |
| Numbering `PZM-ANN-2569-0001`, per company, per Buddhist year, issued at publish | `src/services/announcements.ts` `publishAnnouncement`, `src/services/sequence.ts` |
| Company logo and prefix (`companyProfile/main` per brand) | `src/services/companyProfile.ts`, Settings → ข้อมูลบริษัท |
| A5 sheet, overflow check, PDF (one picture per page) | `src/components/AnnouncementSheet.tsx`, `src/lib/a5.ts` |
| LINE text | `src/lib/announcementText.ts` (5,000-character limit) |
| Files (PDF, picture, preview), kept without expiry | `functions/api/po-image.ts` kinds `ann-*`, served by `functions/a/[token].ts` |
| Sending | the existing `src/share/*` providers; `?announce=<id>` resumes after LINE Login |
| Send log | `Announcement.sends[]`: `sent` only when LIFF says so, `shareOpened` + a person's confirmation otherwise |

## Not built: AUTO_GROUP_SEND through a LINE Official Account

This waits for the owner to create an OA. The older decision stands until then: no LINE OA and no bot (HANDOFF §4).

What it would take, in order:

1. **Owner**
   - Create a LINE Official Account and enable the Messaging API channel.
   - Store its channel access token as a Cloudflare Pages secret, `LINE_CHANNEL_TOKEN`, and its channel secret as `LINE_CHANNEL_SECRET`.
   - Create a least-privilege service account (`roles/datastore.user`, the same kind the cron Worker needs), because a webhook has no signed-in user and must write to Firestore.
2. **Webhook** `functions/api/line-webhook.ts`
   - Verify `X-Line-Signature` (HMAC-SHA256 of the body with the channel secret).
   - On a `join` event in a group, store `lineGroups/{groupId}` = `{groupId, groupName, supplierId?, companyScope[], active, registeredAt}`, reading `groupName` from `GET /v2/bot/group/{groupId}/summary`.
   - On `leave`, set `active: false`.
   - `lineGroups` is a shared collection (not brand-prefixed), because one supplier group may serve both companies. Admins map a group to a supplier in Settings.
3. **Sending**
   - A Pages Function `functions/api/line-push.ts`, called with the user's Firebase ID token, checks the caller is a หัวหน้า or admin (it has to read `users/{uid}`).
   - It pushes `POST /v2/bot/message/push` to each selected group:
     - TEXT: one text message.
     - A5: an image message (the stored picture and preview URLs) followed by a text message carrying the PDF link. The Messaging API has no PDF message.
   - Each group's result goes into `sends[]` with `mode: 'auto'`, `via: 'oa'`, and `groupId`/`groupName`.
   - Status becomes `partiallySent` if some groups failed and `sent` if all went.
4. **Screen**
   - Target selector: all supplier groups, by supplier, or by group; filtered by `companyScope`.
   - A count before confirming ("จะส่ง 18 กลุ่ม").
   - `cleanContent()` currently refuses `mode: 'auto'` and must stop doing so.

**Cost to check before building:** LINE counts a push to a group as one message per member of the group, and the free plan's monthly allowance is small. Eighteen groups of five people is about 90 messages per announcement.
