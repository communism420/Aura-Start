# Settings Schema And Upgrade Compatibility

Reviewed against Aura Start 2.1.1 on October 4, 2026.

Aura Start 2.1.1 migrates settings when reading local data, Google Drive snapshots, Full Backup ZIP, JSON backups, and Restore Point data. A new option receives a default without replacing valid choices already saved for other options. The extension version is not the storage schema version: additive settings changes keep `DATA_VERSION = 1` and the `aura-start-data-v1` storage key.

## Current preference inventory

These are the supported application preference values; not every stored preference has a visible control. Compatible future enum strings can also travel on the wire under the preservation rules below. The registry and types remain authoritative when changing this table.

| Shared path | Default | Supported values |
| --- | --- | --- |
| `theme` | `system` | `system`, `light`, `dark` |
| `language` | `en` | `en`, `ru`, `es`, `de`, `fr`, `pt`, `uk` |
| `columns` | `auto` | `auto` or integer 1–6 |
| `compactMode`, `openLinksInNewTab`, `captureOpenTabs` | `false` | Boolean |
| `showDescriptions`, `showSearch`, `showVersionInHeader`, `autoRestorePoints` | `true` | Boolean |
| `background.preset` | `none` | `none`, `aurora`, `dawn`, `forest`, `custom` |
| `background.blur` | `0` | Number 0–18 |
| `background.dim` | `22` | Number 0–80 |
| `background.position` | `center` | `center`, `top`, `bottom`, `left`, `right` |
| `background.customImageId` | Neutral missing reference | SHA-256 asset ID, explicit `null` for removal, or unresolved absence during legacy migration |
| `widgets.clock`, `widgets.notes`, `widgets.pomodoro`, `widgets.timer` | `false` | Boolean |
| `notes.text` | `""` | String up to 12,000 UTF-16 characters |
| `pomodoro.focusMinutes` | `25` | Integer 5–90 |
| `pomodoro.breakMinutes` | `5` | Integer 1–30 |
| `timer.durationSeconds` | `300` | Integer 1–86,400 |
| `timer.volume` | `80` | Integer 0–100 |
| `timer.customSoundId` | `null` | SHA-256 asset ID or `null` for the built-in sound |
| `sync.deleteCloudFileOnDisconnect` | `true` | Boolean |

Google connection state and automatic synchronization default to disconnected and off. They are installation-local, even though the delete-on-disconnect preference is shared. Synchronizing a preference never authorizes Google access or grants a browser permission on another installation.

`autoRestorePoints` is a stored compatibility preference, not a current Settings checkbox. It controls automatic snapshots for link/group moves and reorders. Required safety snapshots for destructive operations and manually created points have their own behavior; do not describe this field as an on/off switch for every Restore Point.

## Browser-owned settings and permissions

Firefox 2.1.1 packages declare the bundled `newtab.html` as both new-tab replacement and homepage. Firefox owns homepage approval, the Home button/new-window behavior, restoring the previous session, and the user's choice to change the homepage. These browser settings are not Aura Start shared preferences and are not exported, imported, or changed by Drive synchronization. Chromium packages declare only the new-tab replacement.

Firefox's optional `browsingActivity` and `technicalAndInteraction` data-transmission choices, the optional `tabs` grant, and Google OAuth consent are separate local authorization decisions. No schema migration or incoming setting should be documented as transferring those grants. Firefox builds target version 142 or later. See [Privacy Policy](../PRIVACY.md) for the permission and data inventory.

## Shared settings registry

[`src/utils/settingsSchema.ts`](../src/utils/settingsSchema.ts) contains the typed `SETTING_SCHEMA` registry for shared setting paths, including nested leaves such as `background.dim` and `widgets.clock`. Each entry defines its default, normalization, and wire validation. Types live in [`src/types.ts`](../src/types.ts), and initial application defaults live in [`src/constants.ts`](../src/constants.ts).

Use this registry for normalization and synchronization. Do not introduce a second list of shared fields in the Drive transport, storage layer, or backup importer. The registry must cover the shared settings type, so TypeScript can identify missing entries when a setting is added.

`normalizeSharedSettings` adds supported defaults and compatibility metadata; `projectSharedSettings` produces stored shared values, including a retained future enum value behind a UI fallback. `restoreCompatibleSettings` applies only the settings a snapshot actually knew. For a user control, call the store's `updateSettings` with a patch containing only the changed leaves. Its `applyExplicitSettingsPatch` helper in [`settingsPatch.ts`](../src/utils/settingsPatch.ts) preserves siblings and records an explicit choice even when it equals a displayed default.

All user preferences belong in the shared registry, including `notes.text`, `captureOpenTabs`, and `sync.deleteCloudFileOnDisconnect`. Only that named preference inside `settings.sync` is shared; its connection state, mode, account details, timestamps, and installation ID remain local. A synchronized `captureOpenTabs` choice never grants the browser's actual `tabs` permission. Permission requests still require the local user flow. Never copy credentials from a backup or another device.

The `sync` container has a deliberate allowlist exception for `sync.deleteCloudFileOnDisconnect`; it is not an open namespace for unknown future connection properties. Search/filter, onboarding/demo markers, running timers, and Restore Timeline remain outside the shared settings document. Device identifiers are present in causal revision stamps but are not adopted as another installation's connection identity.

Older Drive uploads wrote placeholder values for `captureOpenTabs` and `sync.deleteCloudFileOnDisconnect` while those fields were local. The Drive reader treats these values as absent unless their shared causal registers are present. This cloud-only compatibility rule prevents old placeholders from resetting real preferences. Local storage and user-created JSON backups retain explicit values under their normal schema rules.

## Missing values and explicit choices

An older snapshot may have no value for an option introduced later. Showing a default for that missing value is normalization, not a new user edit. Optional `settingsCompatibility` metadata, with its own version, records which settings were defaulted and which compatible values are not understood by this installation.

The merge distinguishes a synthesized default from a saved choice, even when the saved choice equals today's default. Missing fields must not win over explicit values from another snapshot. Normalization and repeated migration must not advance user-edit revisions or make unchanged data upload forever. A user's later change uses the normal per-setting sync revision.

Preserve this distinction through storage writes, Drive uploads/downloads, backup export/import, and Restore Points. Reconstructing settings from UI-visible values alone loses the distinction. Use the validated data and the existing storage/merge entry points instead of rebuilding a settings object from defaults on each save.

## Forward-compatible values

Safe unknown preference fields are retained during compatible round trips. When a known option has a future value this installation cannot display, retain the original compatible value and sync revision while presenting a supported fallback locally. An unrelated edit must not write that fallback over the future value. An explicit edit to that option may replace it.

This compatibility is limited by validation. Unsafe property names, invalid values, local-only fields, and incompatible structural changes do not become shared preferences simply because they appear in JSON. Adding a new enum value can use this preservation behavior; renaming a key, changing its meaning, or changing its data shape still requires an explicit migration and compatibility review. Do not promise that older binaries support arbitrary future formats.

Unknown values must be bounded plain JSON: finite numbers, booleans, strings, nulls, arrays, or plain objects. Validation limits nesting to 12 levels, a copied value to 4,096 nodes, strings to 65,536 characters, shared paths to 256 characters, and compatibility field collections to 512 paths. Known enum strings have a narrower 128-character wire limit. Prototype/accessor properties and private authentication or installation-specific path segments are not accepted as shared preferences. Unsupported metadata versions or incompatible known-field shapes require a migration rather than opaque preservation.

## Images, history, and recovery

Settings migration does not replace the custom background asset migration. A 2.0.5 image stays available until its asset and reference are saved, and an older snapshot without an image reference does not mean removal. Keep the distinction between an absent custom-image reference and an explicit removal.

Updating an existing 2.0.5 profile and importing a 2.0.5 JSON backup are different operations. The old JSON exporter did not include the widget's locally stored notes or custom image bytes. The importer preserves the fields that are present and defaults or retains newer settings; it cannot recover media or text absent from the source. Local profile migration can recover the old UI-storage values before synchronizing them. Native Chrome authorization with the legacy scope can also read accessible hidden Drive backups; the current Device OAuth flow cannot inspect that space.

New Restore Points call `snapshotSettingsCompatibility` to freeze the current known defaults as captured choices. For example, a point captured while the clock is off can later restore that off state even if the user had never previously touched the control. Capturing the point does not itself change the current settings' sync revisions. Retained future values remain retained, and an unresolved custom-image reference remains absent.

Reading an older Restore Point is different: validation only fills settings the point lacked; it does not retroactively record those additions as choices made when the point was captured. Applying that point therefore preserves the current values for options the point predates. Compatibility metadata must travel with the point's data. Applying a point or importing a backup also preserves the current installation's Drive connection and actual browser permission grants through the existing restore/import flow. The saved Save open tabs preference itself follows the snapshot when explicitly present. Keep asset validation and restore-point protection in that flow.

## Notes and migration from local UI storage

`notes.text` is a shared string with default `""` and a maximum of 12,000 UTF-16 characters, matching the original widget limit. Preserve Markdown, whitespace, and newlines. An absent field receives a neutral default; an explicit empty string is a real user choice that synchronizes clearing. Notes remain in the shared document even when `widgets.notes` is false and are included in Full Backup ZIP and Restore Points.

[`storage.ts`](../src/utils/storage.ts) migrates nonempty legacy `widgetNotes` under the existing storage lock before the first sync. It creates a local Restore Point with `context.source = "legacy_notes_migration"`, adopts the old text only if the shared note is defaulted, saves the main document, then clears the legacy UI copy. An existing explicit shared note is retained, with the old local text recoverable in the point. Failed main writes retain the legacy text and expose `notesMigrationError`; shared remote application and note replacement must stop until migration succeeds. Cleanup retries must not restamp text or duplicate points. UI-state writes must neither clear the last unmigrated copy nor resurrect a stale legacy copy after success.

Notes use the same field-level causal register as other preferences. Concurrent edits to the whole text resolve deterministically, without a collaborative text merge. Local recovery points retain the prior note before remote replacement and before an editor based on stale data overwrites the newer local text. Different settings still merge independently. Cover Unicode/newlines, the length boundary, explicit clearing, a hidden widget, two old installations with different notes, stale editors, and failed storage writes.

## Countdown settings and audio assets

Countdown demonstrates an additive widget upgrade. The registry adds `widgets.timer` with default `false`, `timer.durationSeconds` with default `300` and range `1..86400`, `timer.volume` with default `80` and range `0..100`, and `timer.customSoundId` with default `null`. The numeric values are integers. Old local records, Drive snapshots, JSON backups, and Restore Points receive neutral defaults only for missing fields. Those defaults must not overwrite a newer explicit timer choice, including volume `0` or an explicit return to the built-in sound.

The running countdown is local UI state, not a shared setting. Its deadline and pause state must never be added to the shared settings registry or cloud payload. Independent devices can run different countdowns while using the same synced duration and sound preferences. The alarm sound requires an Aura Start page to remain open; the browser `alarms` permission serves Drive polling and does not provide closed-page audio playback.

`timer.customSoundId` references a SHA-256-addressed IndexedDB asset in [`timerSoundStorage.ts`](../src/utils/timerSoundStorage.ts). An asset contains `name`, original `dataUrl`, and `playbackDataUrl`; the hash covers all three. The original file is limited to 20 MiB, and the playback representation is bounded canonical 24 kHz mono PCM16 WAV from up to the first 60 seconds. Preparing audio uses browser decoding with a packaged FFmpeg fallback; codec conversion stays local. The file-picker's format list is a hint, not a guarantee that every codec, protected file, or damaged file can decode. Do not place either audio data URL in settings, causal registers, or each Restore Point.

Drive sends only the currently referenced sound in `timerSound: { id, name, dataUrl, playbackDataUrl }`, including when the widget is disabled. The reference in settings must agree with causal history and the envelope; downloading verifies the asset and durably saves it before returning settings. A missing local asset must block uploading that snapshot. Replica folding preserves the asset matching the winning reference. An explicit `null` sends no obsolete sound asset.

ZIP format v2 includes a JSON settings/link/note/history document, deduplicated current and historical background files, and only the currently selected original Countdown audio file. It excludes the prepared playback WAV and other historical audio files; selecting the built-in sound produces no audio entry. Neutralize references to different historical sounds in exported Restore Points, without turning them into explicit removals. History that references the exported current sound can retain it. When exporting an individual Restore Point, its selected sound is the current sound of that exported snapshot.

The importer validates the ZIP and original files, prepares the playable sound locally, saves the resulting asset, and updates references before applying data. Reconstructed playback can produce a different content-addressed asset ID, so every retained reference must follow the validated imported asset. Older v1 ZIPs with playback/history files and older portable JSON remain importable. Custom background history continues to transfer in v2. The connection-preserving application and asset-before-reference guarantees remain unchanged.

Settings and links only (JSON) omits embedded media and neutralizes non-null custom-file references plus an active `background.preset = "custom"` in current settings, causal history, and Restore Point settings. Those omitted paths preserve receiver values or fall back to built-in defaults on a fresh profile. Explicit `null` removals and non-Custom presets remain ordinary saved choices and apply according to import mode; do not promise that every media selection remains unchanged. Other preferences, notes, links, and Restore Points remain available. Never turn an omitted custom-file reference into a user-issued deletion stamp.

Older portable JSON still supports `timerSounds: Record<id, TimerSoundAsset>` and background asset bundles. [`timerSoundBackup.ts`](../src/utils/timerSoundBackup.ts) attaches parsed audio bundles to a pending `WeakMap`, outside the persisted data object. The store awaits asset import before applying settings. Missing references may use an already verified local asset; otherwise a complete-media import fails before settings change. Sound selection writes the asset first, rereads durable settings, creates a Restore Point, and applies only `timer.customSoundId`. Superseded asynchronous imports cannot replace a newer selection or removal.

## Checklist for a new setting

1. Separate a user preference from installation state. Share preferences; keep credentials, connection state, runtime state, and actual permission grants local. A preference controlling a permission-gated feature can be shared without granting permission.
2. Add the typed field and its initial default, including the correct nested settings type where applicable.
3. Add the shared path to `SETTING_SCHEMA` with normalization and wire validation. Choose a safe default for an upgraded installation that has never seen the option.
4. Add UI controls and translations separately. Persist only the changed leaves through `updateSettings`, preserving unrelated fields and compatibility metadata. Do not send a whole nested object just to change one option: it would declare the other submitted leaves explicit choices too.
5. For a rename, meaning change, or incompatible shape change, write a specific migration. Define how old and new snapshots interact before changing the wire representation. Do not reset storage or replace the complete settings object.
6. Add regression coverage for an older local record, older Drive snapshot, Full Backup ZIP, media-free JSON, legacy portable JSON, and Restore Point. Include missing nested options, valid non-default choices, an explicit choice equal to the default, and a newly captured point that restores an existing default after a later edit.
7. Check repeated normalization and sync, both merge orders, an unrelated edit from a stale page, and a compatible unknown field or enum value passing through this version.
8. Recheck local connection/permission isolation, legacy notes recovery, the 2.0.5 custom background migration, and audio asset/reference validation for timer changes. Run `npm run test`, `npm run typecheck`, and the required release build validation.
9. Add an appropriate scenario to [`INSTALLED_EXTENSION_TEST_MATRIX.md`](./INSTALLED_EXTENSION_TEST_MATRIX.md), update release notes, and run installed-browser upgrade checks. Automated fixtures do not establish that real Google OAuth and two-device delivery were tested.

For a default-only change, also decide whether users who already made an explicit choice should retain it. Changing a default must never masquerade as a new user edit that wins a sync merge.

## Quiet synchronization lifecycle

Page installation, focus, visibility changes, and closing a page must not force an immediate sync. [`googleDriveSyncLifecycle.ts`](../src/services/googleDriveSyncLifecycle.ts) starts a delayed poll after five seconds and continues while the page is visible, the browser reports online, and automatic sync is active. Showing a page enables the next scheduled check; it does not itself initiate one. The page also projects local storage updates and requests non-forced online recovery when eligible local edits are pending. Loading the store shows its saved state without starting the sync animation. Queue shared writes only when content or causal state changes; local UI, recovery history, connection-only metadata, and unchanged explicit values do not create content edits. An explicit choice equal to a synthesized default still changes its causal state.

[`background.ts`](../src/background.ts) shares one poll cooldown across this installation's pages and the alarm. A poll joins an in-flight synchronization without queuing an extra pass; a real local edit can still queue a follow-up pass. Successful work sets the next polling deadline approximately five seconds later. Failed or reconnect-required results increase that delay to 10, 20, 40, then at most 60 seconds. Page timers follow the remaining shared deadline rather than restarting a full interval after a skipped poll. This prevents multiple pages from multiplying remote checks. The cadence is not a delivery deadline or server push.

Background startup recreates the alarm and recovers pending local work; a clean startup does not force a check. The roughly one-minute alarm continues to check small Drive metadata when pages are hidden or closed, as long as the browser is running. Browser suspension and network work may extend the intervals. Matching verified server revisions skip payload/media transfer and main-data/last-sync-time writes. New or unverified revisions establish or refresh the comparison baseline; successful local uploads also update that baseline. Explicit connect, reconnect, and restore actions can request synchronization; direct forced-check calls are internal APIs used by the test harness, not a separate Sync now control. Keep this cache installation-local and connection-scoped; a failed or partial transfer must never mark an unread remote revision as consumed.

All current flows use the same visible `aura-start-sync.json` with an `auraStartSharedSync` app property. Read accessible legacy snapshots, merge their causal content, verify the canonical file, and only then conditionally remove covered duplicates. Use conditional writes and re-read/merge/retry after a stale revision; do not solve a collision with an unconditional overwrite. Different fields merge independently; concurrent values of the same field use logical revision counters and a deterministic device-ID tie-break, rather than wall-clock order. Deletion records prevent stale field edits from reviving a deleted link. See [`googleDriveSharedSync.ts`](../src/services/googleDriveSharedSync.ts) and [`googleDriveSync.ts`](../src/services/googleDriveSync.ts) for transport and authorization details.

Deletion changes an entity's presence register; it does not purge its field registers. Deleted link/group fields therefore remain in the causal document and may be included in sync and backups. Keep this retention visible in privacy disclosures. Cloud-file deletion removes the accessible snapshots; a normal link deletion is not an erasure of every recovery copy.

## Pausing and deleting a Google Drive backup

`sync.mode = "off"` pauses network activity independently of `sync.connected`. A failed backup deletion or a disappeared established cloud copy can retain `connected = true` and account/file references while paused; normalization must preserve this state and any `reconnectRequired` flag. These fields remain local and must not become shared preferences.

Confirmed deletion durably pauses sync with a new connection ID before waiting for the shared Drive lock. Recheck the connection before and after authorization/deletion, verify matching normal-Drive snapshots are absent, then clear this installation's credentials and connection metadata under the same lock. Include old 2.0.5 files, renamed app-marked snapshots and copies in Trash. Hidden legacy app data is included only with existing access; native Chrome/Web cleanup remains strict for both spaces. Failure retains the paused account for retry, and stale operations must not clear or mark errors on a replacement connection. Local settings, notes, links, Restore Points, and IndexedDB media remain intact.

The current Device OAuth configuration requests only `drive.file` for sync and deletion and must not attempt an automatic `drive.appdata` upgrade. The configured client previously returned an invalid-scope error for that request. This is a constraint of the implemented flow and observed configuration, not a claim that Google's Device protocol universally excludes app data: Google's current [allowed-scopes documentation](https://developers.google.com/identity/protocols/oauth2/limited-input-device#allowedscopes) lists both scopes. Any future change requires deliberate authorization and compatibility testing. A recognized hidden-space scope denial returns verified normal-Drive deletion with unverified legacy coverage; other errors remain failures. The installation-local `sync.lastDeletionLegacyUnchecked` flag records that a previous cleanup could not check hidden data. It stays set after disconnect, reload, reconnect or later deletion, because a new operation may use another Google account. It is not a shared preference and must not travel through cloud sync or portable backups. The UI directs users to the Google account used for that previous cleanup, without claiming hidden data exists or that manual removal was verified.

Updated peers that detect their previously established cloud copy has disappeared pause rather than recreate it. Explicit reconnection can start a new copy; other devices should be disconnected before deletion to cover older versions, remaining hidden backups and uploads already in flight.

## Authorization lifecycle

Authorization flow, credentials and the authorization generation are installation-local. Persist the selected flow so a restart or capability probe cannot silently choose another cached account. Keep extension-local storage authoritative over session mirrors and in-memory caches. Serialize renewal, bound requests and retries, and retain the connection and pending edits on transient network, rate-limit, server and recoverable access-token failures. A confirmed invalid refresh grant still requires explicit reconnection; missing scopes cannot be granted silently.

Manual disconnect invalidates the authorization generation and clears local credentials. A pending sign-in or renewal must check that generation before saving its result; stale results cannot restore the connection or alter a replacement account. Do not call Google's revocation endpoint for an installation-local disconnect: [Google documents that revocation affects all clients in the project](https://developers.google.com/identity/protocols/oauth2/limited-input-device#tokenrevoke). Users can revoke the app everywhere through their Google Account connections.

Google's external OAuth Testing mode issues seven-day refresh tokens for Drive scopes, and other provider rules can invalidate a grant. See [refresh-token expiration](https://developers.google.com/identity/protocols/oauth2#expiration). The actual project's publishing status has not been inspected; client retry logic cannot remove these provider limits. Keep live-account authorization checks separate from HTTP-simulator evidence.
