# Application components (`apps/web/src/components`)

Primitives without business logic go to `packages/ui`. This folder holds the
components that know about the application (routes, oRPC API, the "premium"
visual direction of [`docs/DESIGN.md`](../../../../docs/DESIGN.md): night blue
+ yellow, dark by default). Look through this list before adding a new
component.

## Shell

| Component | Usage |
| --- | --- |
| `AppShell` | Shell of the signed-in pages: 256 px sidebar, top bar (prominent Ctrl K search + `ReminderBell` + yellow "Add" button), command palette, `ConfirmDialogProvider`, keyboard shortcuts. `<AppShell>{children}</AppShell>`. |
| `Sidebar` | Sidebar content: brand, navigation by section (`NAV_SECTIONS`: Dashboard / Documents / Review, then **Organisation** — parties, document types, dossiers, reminders) with counters on the right, the `SavedSearchNav` block, library block, and the footer holding the user block plus the **Settings gear** (tooltip "Settings", shortcut `g ,`). There is no "System" section any more: Settings left the navigation and the rules became its "Automations" tab. The "Document types" counter turns into a red badge when enabled recurring types are missing a period. Props: `onNavigate?`, `className?`. |
| Navigation (`@/lib/navigation`) | `NAV_ITEMS` (sidebar rows) and `SECONDARY_NAV_ITEMS` (Settings `g ,`, Automations `g a`) are merged into `ALL_NAV_ITEMS`, the single source of the keyboard shortcuts and of the "Go to" group of the palette. `SETTINGS_TABS` drives the `/settings` sub-navigation. |
| `PageHeader` | Page header: mono kicker, tight bold title, description, actions. Props: `kicker`, `title`, `description?`, `actions?`, `breadcrumb?`, `children?` (filters). |
| `ComingSoonPage` | Placeholder page for a section that is not implemented yet. Props: `kicker`, `title`, `description?`, `icon?`, `preview?`. |
| `ThemeToggle` | Light / dark icon button (`next-themes`). Props: `size?` (`icon` \| `icon-sm`). Used on `/login`. |
| `ThemeMenuItem` | Same switch as a `DropdownMenuItem`: this is the form used in the sidebar user menu. No props. |
| `AuthCard` | Frame of the `/login` screens: centred `BrandLogo`, double-rimmed card. Props: `kicker`, `title`, `description?`, `footer?`. |
| `BrandLogo` / `BrandSymbol` | Brand mark (proposal 05 "Onglet jaune" of `prototypes/logos.html`): a plain document card marked by a yellow tab protruding from its right edge, plus the "docstore" wordmark. The document body and its cut lines follow the theme (`--foreground` / `--background`) so it reads on both dark and light surfaces; the tab stays the single yellow accent (`--primary`). Props: `size?` (`sm` \| `md` \| `lg` \| `xl`), `symbolOnly?`, `tagline?`. Used by the sidebar, `/login` and `/u/$token`; the favicon (`public/favicon.svg`) is the same drawing with resolved colours, plus a `prefers-color-scheme` variant since it cannot read the app's theme. The app icons (`apple-touch-icon.png`, `icon-512.png`) are a "negative" tile: the same symbol carved in ink on a solid yellow square, generated with `sharp` alongside `favicon-32.png` / `favicon-16.png`. **Everything about the identity lives in this one file**: swapping the mark later is a single-file change. |

## Command palette and shortcuts

| Component | Usage |
| --- | --- |
| `CommandPaletteProvider` | Mounted by `AppShell`; handles the Ctrl+K / ⌘K opening. |
| `useCommandPalette()` | `{ open, setOpen, toggle, registerGroup }` — `registerGroup(group)` returns the unregister function. |
| `useCommandGroup(group)` | Registers a group for the lifetime of the component: `{ id, heading, order?, getItems(query) }`, `getItems` may be asynchronous. |
| `PartyCommandGroups` | Default groups: "Go to" (navigation) and "Parties" (`party.list`). |
| `DocumentCommandGroups` | Two groups, mounted by `AppShell`: "Archive" (a bare number is read as an ASN and resolved through `document.byAsn`) and "Documents" (full-text search through `document.list`). The ASN hit carries `preselect`, so an exact match is highlighted and Enter opens it. |

An item may set `preselect: true` to claim the highlight instead of the first
item of the first group. Reserve it for a query that resolves to exactly one
thing (an ASN). The palette drives cmdk's `value` itself: the first claimer
wins, otherwise the first item of the first group is highlighted.
| `useHotkeys(hotkeys)` | In-house hook (`@/hooks/use-hotkeys`): single keys, `mod+k`, "g d" sequences. |
| `usePageAction(action, handler)` | Receives the global actions `PAGE_ACTIONS.focusSearch` ("/") and `PAGE_ACTIONS.create` ("n"). |

## Filters (`components/filters/`)

Declarative filter bar shared by `/documents`, `/parties`, `/types` and
`/review`: a compact search field on the left, the active filters as editable
pills (`Field · operator · value`), an "Add filter" popover listing the
remaining fields with their icons, and "Clear all". Everything is kept in the
URL through the existing zod `validateSearch` schemas, so a pasted link
restores the bar exactly and the saved searches keep working.

| Component | Usage |
| --- | --- |
| `FilterBar<S>` | The bar itself. Props: `fields` (`FilterField<S>[]`), `value` (the URL search object), `onChange(patch)`, `search?` (compact `SearchInput`), `trailing?` (result count, sort select), `className?`. Only the half-filled filter lives in local state: picking a field opens its value editor at once and nothing is written until the value is complete. |
| `FilterField<S>` (`filter-types.ts`) | One declaration: `id`, `label`, `icon`, `type` (`text` \| `select` \| `multiSelect` \| `date` \| `dateRange` \| `number` \| `boolean`), `operators` (the first one is the default), `options?`, and the two functions binding it to the URL: `read(search)` → `FilterValue \| null` and `write(value \| null)` → search patch. Operator presets: `OP_IS`, `OP_CONTAINS`, `OP_HAS_ALL`, `DATE_RANGE_OPERATORS` (`is between` / `is on or after` / `is on or before`), `BOOLEAN_OPTIONS`. |
| Builders (`filter-fields.ts`) | `idField`, `idsField`, `booleanField`, `textField` and `dateRangeField`: the shapes every screen reuses, each bound to one or two keys of its search object. |
| `FilterValueEditor` | Value control drawn inside the pill popover, by type: searchable `Command` list (single choice), the same list with checkboxes plus "Apply" (multi-selection), one or two `DatePicker`s (date, range), text or number with Enter to commit. |
| Option sources (`use-filter-options.ts`) | `useCategoryFilterOptions` (tree, indented, searched on the full path), `usePartyFilterOptions`, `useDocumentTypeFilterOptions`, `useTagFilterOptions`. They are ordinary hooks called by the page that builds its fields: `FilterBar` never talks to the API. |

Test ids: `filter-bar`, `add-filter`, `filter-pill-<fieldId>`.

## Lists and forms

| Component | Usage |
| --- | --- |
| `DataList<T>` | Dense list with declarative columns (12-column grid), 56 px rows, laid inside a double-rimmed card (page margins included). Props: `items`, `columns`, `getKey`, `isLoading`, `onRowClick?`, `getRowLabel?`, `empty?`, `pagination?`, `rowLeading?` / `headerLeading?` (selection checkbox, rendered **outside** the clickable area). Row actions are revealed on hover: `opacity-0 transition-opacity group-hover/row:opacity-100`. A column containing buttons forces you to drop `onRowClick` (no button inside a button): put a `Link` on the title column, the way `/review` does. |
| `Pagination` | List footer: mono counter + previous / next. Props: `page`, `pageSize`, `total`, `totalPages`, `onPageChange`, `itemLabel?`. |
| `SearchInput` | Search field (magnifier, clear button, shortcut chip). Props: `value`, `onValueChange`, `shortcut?`, `size?`, `inputRef?`. |
| `EmptyState` | Double-rimmed empty state (`.shell` + card). Props: `icon?`, `title`, `description?`, `action?`, `size?` (`default` \| `sm` for dashboard panels). |
| `ConfirmDialogProvider` / `useConfirm()` | `const ok = await confirm({ title, description, destructive })`. |
| `FormField` | Form row: `label`, `htmlFor?`, `hint?`, `errors?` (coming from `field.state.meta.errors`), `required?`. |
| `FormSection` | Group of fields preceded by a mono label. Props: `title`, `description?`. |
| `fieldErrorMessages(errors)` | Normalises `@tanstack/react-form` errors (string \| ZodIssue) into `string[]`. |
| `ChipsInput` | Multi-value **free-text** input rendered as chips (Enter / comma adds): aliases, domains, e-mail addresses. For tags use `TagInput`, which resolves against `tag.list`. Props: `values`, `onValuesChange`, `type?`, `normalize?` (canonical form applied to a value as it is added — the party form passes `normalizeIdentifier`). |
| `DatePicker` | Date field in `en-GB` ("15 Mar 2024"): the text stays typable (the displayed form, `2024-03-15` and `15/03/2024` are all accepted) and the calendar button opens the grid matching the precision. The value is always the `YYYY-MM-DD` the API expects. Props: `value`, `onValueChange`, `precision?` (`day` \| `month` \| `year`), `label?`, `placeholder?`, `id?`, `disabled?`. **Every editable date goes through it**: document metadata, review sheet, reminder snooze, share and upload link expiry, API key expiry, filter range, rule conditions and actions, `date` custom fields. |
| `DatePrecisionPicker` | `DatePicker` plus the precision select (Day / Month / Year, each with its icon): switching the precision re-truncates the value to the first day of the month or year. Props: `value`, `precision`, `onChange(value, precision)`, `label?`, `id?`, `disabled?`. |
| `formatDateValue(value, precision)` / `parseDateInput(raw, precision)` / `isoToDate` / `dateToIso` | Helpers of `date-picker.tsx`: display, parse and convert without a time-zone shift. |
| `TitleTemplateInput` | Title template field: an input plus the `TITLE_PLACEHOLDERS` chips, each appending its token. Shared by the `set_title` rule action and the document type form — the same engine renders both server side. Props: `value`, `onValueChange`, `id?`, `placeholder?`, `className?`. |
| `IconLabel` | Lucide icon + label, the shape every enum takes in a `Select`, a `Combobox` option or a `Badge`. Props: `icon`, `label`. |
| `iconLabelItems(values, labels, icons)` | Builds the `items` record a Base UI `Select` needs, so the closed trigger shows the same icon + label as the open list. |
| `useDebouncedValue(value, delayMs?)` | `@/hooks/use-debounced-value`: value that only follows its source once it stopped changing (server-side searches). |

## Domain display

| Component | Usage |
| --- | --- |
| `MonoLabel` | Mono section label in small caps (class `.mono-label`). |
| `DateText` | Mono date following `datePrecision`. Props: `value`, `precision?` (`day` \| `month` \| `year`), `fallback?`. |
| `formatDate(value, precision)` | Function form of `DateText`, for composed strings. Formats in `en-GB`: "12 Oct 2025", "Dec 2025", "2025". |
| `PartyAvatar` / `initialsForName` | Round chip: the logo when there is one, otherwise yellow initials on a `muted` background ringed by a rim. Props: `name`, `logoKey?`, `partyId?`, `size?` (`sm` \| `md` \| `lg`). A `logoKey` that is not an absolute URL is a storage key served by `GET /parties/:id/logo`, so pass `partyId` whenever you have it. |
| `PartyTypeBadge` / `PARTY_TYPE_LABELS` / `PARTY_TYPE_ICONS` | Coloured badge of the party type: icon + capitalised label ("Company", "Public body"…). |
| `PartyRelations` / `PARTY_RELATION_KIND_LABELS` / `PARTY_RELATION_KIND_ICONS` | Relations of a party (list, add through `PartyPicker` + kind select, remove). Props: `party: PartyDetail`. |
| `PartyFormSheet` | Create / edit a party in a side sheet: logo, identity, identifiers, notes. Props: `open`, `onOpenChange`, `party?`, `onSaved?`. It owns the **whole** identifiers block, so the update is sent with `replaceIdentifiers: true`: `party.update` merges identifiers key by key by default, and a field the user just emptied has to be a deletion. A `CONFLICT` naming another party (`partyConflict` of `@/lib/api-error`) is shown under the field it is about — the submitted identifiers are compared with the ones of that party to find which — with a link to it and a "Merge instead" opening `PartyMergeDialog` on it. |

### Parties (`components/parties/`)

| Component | Usage |
| --- | --- |
| `PartyPicker` | **The** party combobox of the application: server-side search through `party.list` (debounced, merged with the always-loaded first page so a selection keeps its name), each option showing `PartyAvatar` + name + `PartyTypeBadge`, and a last "Create ‘…’" entry opening `PartyQuickCreateDialog`. Props: `value`, `onValueChange`, `label?`, `placeholder?`, `id?`, `excludeIds?`, `allowCreate?`, `disabled?`. Replaces every ad-hoc party combobox (document parties, relations, series, intake defaults, filters, rule conditions and actions, `party_ref` custom fields). |
| `PartyMultiPicker` | Same list in multi-selection, rendered as removable chips. Props: `value: string[]`, `onValueChange`, plus the same options. |
| `PartyQuickCreateDialog` | Minimal creation form (name prefilled from the query, type, optional domain) calling `party.create`; the caller selects the result. Props: `open`, `onOpenChange`, `name`, `onCreated`. |
| `PartyMergeDialog` | "Merge into…" of a party (`party.mergeInto`): a `PartyPicker` for the survivor (self excluded, no creation) and, under it, the summary of what is about to move — documents, relations, identifiers, and the absorbed name kept as an alias — read from `party.get` on both sides. The dialog **is** the confirmation; the source is archived, never deleted. Props: `open`, `onOpenChange`, `sourceId`, `initialTargetId?`, `onMerged?` (the caller decides where to go: the party page and the form sheet navigate to the target, the duplicates panel just refreshes). Opened from the party page ("Merge into…"), from the "Merge into another party" action of the `CONFLICT` toast raised when deleting a party documents still point at (`isPartyInUseError`), from the duplicates panel and from the conflict notice of `PartyFormSheet`. |
| `PartyDuplicatesPanel` | Panel of `/parties` opened by "Find duplicates", the twin of `DuplicatesPanel`: pairs from `party.duplicates` with their reason (`PARTY_DUPLICATE_REASON_LABELS`: "Same domain", "Same name"), the shared value, an avatar and a document count per side — marked **A** (the older, natural target) and **B** — then "Merge A into B", "Merge B into A" and "Ignore". There is no API behind the ignore: it only lasts as long as the panel is open, and "Show ignored" brings the pairs back. Props: `onClose`. |
| `PartyLogoField` / `applyLogoDraft` | Logo field of the party form: preview, "Upload" (file input), "Fetch from domain" (`party.fetchLogo`, enabled once a domain identifier exists) and "Remove". It never writes on its own — it holds a `LogoDraft` that `applyLogoDraft(partyId, draft, queryClient)` replays once the party has an id, so creating (two-step, transparent) and editing share one path. |

Related utility: `@/lib/party-form` (the zod schema of the form and
`toPartyPayload`, plus `PARTY_IDENTIFIER_ORDER` / `PARTY_IDENTIFIER_LABELS`,
the reading order and the singular English label of every identifier key,
shared by the identifier band of `/parties/$partyId` and the merge summary).

## Documents (`components/documents/`)

Screens `/documents`, `/documents/$documentId`, `/review` and the dashboard.
The English enum labels (`DOCUMENT_STATUS_LABELS`, `DOCUMENT_PARTY_ROLE_LABELS`,
`ASSIGNMENT_SOURCE_LABELS`, `REVIEW_REASON_LABELS`, `DOCUMENT_SORT_LABELS`,
`DATE_PRECISION_LABELS`, `DOCUMENT_RELATION_KIND_TITLES`) and the
`formatFileSize` / `formatConfidence` / `formatMoney` formatters live in
`document-labels.ts`.

Every label is capitalised ("Processing", "Issuer", "Version of"…) and comes
with a matching `*_ICONS` record of Lucide icons; render the pair through
`IconLabel` in the options and directly inside the badges. The lowercase
`DOCUMENT_RELATION_KIND_LABELS` of `@docstore/shared` stays as it is: the MCP
tools use it inside sentences.

| Component | Usage |
| --- | --- |
| `DocumentThumbnail` | Square thumbnail of a document. Props: `thumbnailKey?` (key from `document.list`), `fileId?`, `sensitive?`, `size?` (`sm` \| `md` \| `lg`). Falls back to an icon (padlock when sensitive). |
| `DocumentTitleCell` | Thumbnail + title + issuing party + badges (sensitive, status). "Document" column of the lists. Props: `item`, `size?`. |
| `DocumentRow` | Compact clickable row (dashboard, party page). Props: `item`, `onOpen`, `trailing?`. `documentIssuer(item)` returns the issuer or the first linked party. |
| `DocumentStatusBadge` / `CategoryBadge` / `TagChip` / `AssignmentSourceBadge` | Domain badges. `DocumentStatusBadge` covers the five statuses, `failed` included (red, `AlertTriangle`). `AssignmentSourceBadge` renders nothing for manual input and an "auto · 0.98" badge for a rule or an MCP agent. |
| `DocumentFilters` / `useDocumentFilterFields()` | `FilterBar` of `/documents`: search box plus the declarative fields category, party, document type, tags, status, year, document date range, valid until range, sensitive, has an ASN, physical location and trash — then the result count and the sort select on the right. Props: `value` (`DocumentSearch`), `onChange`, `searchRef?`, `total?`. The query is written back to the URL after 300 ms. |
| `DocumentRelationsCard` | "Related documents" card of the metadata panel: `relations[]` with their kind and direction, add dialog (`TestDocumentPicker` + kind) through `document.addRelation`, remove. Props: `documentId`, `relations`. |
| `DuplicatesPanel` | Panel of `/documents` opened by "Find duplicates": pairs from `document.duplicates` with their reason (`DUPLICATE_REASON_LABELS`), "Merge into" (`document.mergeAsVersion`) and "Ignore" (`document.ignoreDuplicate`, stored server side). A "Show ignored" switch re-reads with `includeIgnored`, badges the dismissed pairs and swaps the button for "Unignore" (`document.unignoreDuplicate`). Both sides are drawn from the pair itself (title, date + precision, `thumbnailFileId`): no per-document read. Props: `onClose`. |
| `SavedSearchNav` / `SaveSearchDialog` | Sidebar block listing `savedSearch.list` (click opens `/documents` with the filters, drag handle for the order → `savedSearch.reorder`, row menu for rename / delete) and the "Save search" dialog of `/documents`. Props: `onNavigate?` / `open`, `onOpenChange`, `filters`. |
| `BulkActionsBar` | Floating bar of the multi-selection (`document.bulk`): document type (`setDocumentType`), category, tags, sensitive, trash / restore. It slides in and out (`bar-in` / `bar-out`), keeping the last selection while it leaves. Props: `ids`, `onClear`, `trashed?`. |
| `UploadProvider` / `useUpload()` | Mounts `UploadDialog` once for the whole application. `openUpload(files?)` is called by the shell "Add" button, the "n" shortcut and drag and drop. |
| `UploadDialog` | Multi-file upload: a dropzone that shrinks to an "Add more" strip once files are queued, one row per file following it from `queued` → `uploading` → `processing` (the dialog polls `document.get` until the pipeline is over) → `done` ("Open") / `duplicate` ("Open the original", "Restore" when the original is trashed) / `error`, a batch summary and an optional document type applied to the **whole batch** through `documentType.apply` once every file settled. Props: `open`, `onOpenChange`, `initialFiles?`. |
| `DocumentPreview` | Preview column: PDF in an `iframe` (`/files/:id/download?disposition=inline`), direct image, navigation between files, "Text" tab (OCR content with highlighted in-document search). Props: `document`, `fill?` (stretches to the height of the container instead of the fixed `h-160` frame — that is what the sticky column of the document page uses). It also exports `FileFrame` (one file rendered by mime type, same `fill?`), which `ReviewSheet` reuses. |
| `DocumentMetaPanel` | Metadata column: status (with the `failed` banner and its "Reprocess") + `processingError` + review reasons (each with its one-click action when its `meta` allows it), **type** (`DocumentTypeCard`), dates, parties, filing, dossiers, relations, custom fields (each with its `FieldExtractButton`), archiving (ASN with "Assign next" → `document.assignAsn`, physical location), files (name, kind, pages, size, Open / Download). Props: `document`. `validateDateDraft` mirrors the cross-field rules of the API in English. The `possibleDuplicate` reason gets its own `PossibleDuplicateActions`, so "Approve" is never the only way out of it: "Open the other document" (`reason.ref`), "Merge into it" (`document.mergeAsVersion`, confirmed, then navigates to the survivor), "Keep both" (`document.ignoreDuplicate` + `review.recompute`, no confirmation) and "Trash this one" (`document.trash`, confirmed), with "Nothing is deleted until you choose." underneath. Shared with `ReviewSheet`, which embeds this panel. |
| `FieldExtractButton` | "Extract" button of a custom field: the rules of the layout the document carries (`extractionRule.applicable({ documentId })`) that target the field, `extractionRule.test` on the chosen one, then the value with its confidence and an "Apply the value" writing `document.setFieldValue({ …, source: "rule", confidence })`. Props: `document`, `field`, `onApplied`. |
| `PartyRoleList` | Linked parties with their role: add through a combobox + role, remove. Props: `documentId`, `parties`. |
| `CategoryPicker` / `useCategoryOptions()` | Tree combobox (`category.list` flattened, indented descendants, filtering on the full path). Props: `value`, `onValueChange`, `placeholder?`, `label?`, `id?`. |
| `TagInput` | Single input-looking field holding the tags as removable chips: typing filters `tag.list` in a dropdown below, Enter or a comma takes the highlighted row — or creates the tag through `tag.create` with the colour `colorForTagName` derives from its name — and Backspace on an empty field removes the last chip. Arrow keys move the highlight, `Escape` closes. Props: `value`, `onValueChange`, `allowCreate?`, `label?`, `placeholder?`, `id?`, `disabled?`. Used by the metadata panel, the review sheet, the bulk bar, the filters, the intake defaults and the rule conditions and actions. |
| `FieldValueEditor` | Editor of a custom field value, by type (`text`/`number`/`money`/`date`/`boolean`/`select`/`url`/`party_ref`). The value is checked against the definition with the shared `customFieldValueIssue` before it is sent, and the reason is shown under the control; the currency of a `money` field comes from the definition and is displayed, never typed. Props: `field`, `value`, `onCommit`, `disabled?`, `id?`. |
| `DocumentListForParty` | Documents of a party (`document.list` with `partyId`), wired into `/parties/$partyId`. Props: `partyId`, `partyName`. |

Related utilities: `@/lib/document-search` (zod schema of the URL filters,
`toListDocumentsInput`, plus `toSavedSearchFilters` / `toExportFilters` /
`fromSavedSearchFilters` which bridge the URL and the persisted filters),
`@/lib/file-urls` (HTTP file routes and `exportApiUrl`),
`@/lib/share-link-url` (`publicSharePageUrl`, `publicShareApiUrl`,
`shareFileUrl`), `@/lib/public-link-url` (`resolvePublicPageUrl`, the shared
rule behind the two public-page helpers; see "Public link URLs" at the bottom
of this file), `@/lib/api-error` (`apiErrorMessage` / `toastApiError`, which
promote the English API message to the headline, accept an `action` button, and
reword the ones worth rewording: trashed document (edited or reprocessed),
document that left the review queue, rejected manual assignment, relation
cycle, past expiry, unknown export placeholder;
`isTrashedDocumentError` backs `useDocumentErrorToast`, the hook every write of
the document page goes through so the toast carries a "Restore", while
`partyConflict` and `isPartyInUseError` back the party form and the
"Merge into another party" of the delete toast),
`@/hooks/use-force-retry` (`useForceRetry`: `documentType.apply` and `rule.run`
refused on a disabled target ask "Apply anyway?" / "Run anyway?" and replay with
`force: true`), `@/components/share/sensitive-links`
(`useActiveShareLinks` / `shareRevocationWarning`: the confirmation that raises
`sensitive` says how many public links it closes),
`@/lib/plural` (`plural` / `countLabel`: the single way to write a counted noun,
never `"document(s)"` nor `count > 1 ? "s" : ""`, which say "0 document")
and `@/hooks/use-file-drop` (page-wide drag and drop).

## Document types (`components/document-types/`)

Screens `/types`, `/types/$typeId`, the extraction rule editor under
`/types/$typeId/extraction/…` and the "Type" card of the document page and of
the review sheet (SPEC §9, `docs/document-types.md`). Document types replaced
and absorbed the former Series: a recurring type *is* a Series, and `/series`
now redirects to `/types?recurring=true`, where "Recurring" is a filter pill of
the `FilterBar` and the segmented tab is gone. A type is the single entry point
for "the same document we keep receiving": the dashboard, the review reasons
and the empty state of `/documents` all point at it.

`document-type-labels.ts` holds the capitalised periodicity titles
(`PERIODICITY_TITLES`) with their icons (`PERIODICITY_ICONS`), the period status
labels and tones (`PERIOD_STATUS_LABELS` / `_TONES`), the layout selection
reasons (`LAYOUT_REASON_LABELS`) and the membership labels and tones
(`MEMBERSHIP_LABELS` / `_TONES`).

| Component | Usage |
| --- | --- |
| `DocumentTypePicker` | **The** document type combobox of the application: `documentType.list` filtered in the browser, each option showing its icon tile, its issuer + category and its recurrence badge, a "Create ‘…’" entry (minimal `documentType.create`) and, when `fromDocumentId` is set, "Create type from this document" (`createFromDocument`, then navigation to the new type). Props: `value`, `onValueChange`, `label?`, `placeholder?`, `id?`, `allowCreate?`, `fromDocumentId?`, `disabled?`, `className?`. Used by the "Type" card, the bulk bar, the `/documents` filters, the upload dialog and the `set_document_type` rule action. `useDocumentTypeOptions()` exposes the same list. |
| `DocumentTypeCard` | Body of the "Type" card of `DocumentMetaPanel` (so the review sheet gets it too): current type with its icon, its `AssignmentSourceBadge`, its layout, its period and its `MembershipBadge`, "Re-apply", the recurrence overrides ("Force in" / "Exclude" / "Reset" → `documentType.setDocumentOverride`) and the picker. Props: `document`. |
| `CreateTypeFromReasonButton` / `ApplyTypeFromReasonButton` | Buttons rendered next to the `recurringCandidate` and `typeCandidate` review reasons, both driven by the `meta` of the reason (`createFromSuggestion` / `apply`). |
| `DocumentTypeFormSheet` | Create / edit a type in a side sheet (`size="md"`): name with the `IconPicker`, `ColorPicker`, description, category, issuer and subject through `PartyPicker`, `TagInput`, title template through `TitleTemplateInput`, sensitive default, the collapsible "Auto-detect" block wrapping the rule `ConditionBuilder`, and the recurrence block (switch → periodicity, first and last period through `PeriodPicker`, expected day, grace days). Props: `open`, `onOpenChange`, `documentType?`, `initial?`, `onSaved?`. `emptyDocumentTypeDraft()` is exported for the callers that prefill it. |
| `DocumentTypeSuggestions` | Panel of `/types` fed by `documentType.suggest`: recurrences spotted in the filed documents, each turned into a recurring type in one click through `createFromSuggestion`. Renders nothing when there is no suggestion. |
| `DocumentTypeLayouts` | "Layouts" tab of `/types/$typeId`, **the only place extraction rules are created and edited**: the layouts reordered by drag and drop (`documentType.reorderLayouts`, which is the signature evaluation order) with a "Default" badge on `layout.isDefault` and their extraction rules under each row, the add / edit sheet, "Create layout from document" (`createLayoutFromDocument`, signature seeded from the OCR text) and "Test layout" on a chosen document with the per-field results. While the default layout is **the only one** it is hidden: its rules are shown directly under an "Extraction rules" heading, with the hint "Add a layout when the document's look changes". Deleting the last layout is never offered. Props: `detail`. |
| `LayoutFormSheet` | Layout form: name, validity range, collapsible signature `ConditionBuilder`. Props: `open`, `onOpenChange`, `documentTypeId`, `layout?`, `onSaved?`. The extraction rules of the layout are listed by `LayoutExtractionRules` (`components/rules/extraction-rule-list.tsx`), which the Layouts tab renders. |
| `DocumentTypeDetection` | "Detection" tab: read-only view of the detection condition with its confidence, `documentType.detect` dry run on a chosen document (every candidate, with the layout each would pick) and `documentType.preview` of what applying would write. Props: `detail`. |
| `RecurrenceTimeline` | Period grid of the Overview tab: `present` links to its document, `missing` is red, `pending` stays muted. Rows fade in with a small stagger. Props: `timeline`. Test id `recurrence-timeline`. |
| `PeriodicityBadge` | Icon + capitalised periodicity, the badge of `/types`, of the detail page and of the suggestions. Props: `periodicity`. |
| `DocumentTypeMark` | Square icon tile of a type, tinted with its colour (same fixed icon list as the categories). Props: `icon`, `color`, `size?`. |
| `RecurrenceProgress` | "8/12" plus up to two missing period keys as red chips, then a "+N" chip whose tooltip lists every missing period (scrollable past 24). Stays on one line, `whitespace-nowrap`, for the fixed-width table column it renders in. Props: `stats`, `showMissing?`. |
| `LayoutReasonBadge` / `MembershipBadge` | Why a layout was picked; how a document belongs to the recurrence. |
| `PeriodPicker` | Period field driven by the periodicity: weekly → a day picker snapped to the Monday, monthly → month grid ("Sep 2026"), quarterly → a year field plus the four quarters as a segmented control ("Q3 2026"), yearly → year list ("2026"). The stored value stays the first day of the period, the format the API expects. Props: `value`, `onValueChange`, `periodicity`, `label?`, `id?`. Helpers: `toPeriodStart`, `quarterOf`, `formatPeriod`, `periodRangeLabel`. |
| `OutOfRangeNotice` | "Out of range" card of the Overview tab: the `outOfRange` members of `documentType.get()` (title + period), each with "Extend start period to <period>" (`documentType.update`, recurrence sent whole) and "Exclude" (`setDocumentOverride`). Renders nothing on a type without one. Props: `detail`. Test id `out-of-range`. |
| `PeriodHint` | Sentence shown under a `PeriodPicker`: "Covers Jul 2026 → Sep 2026 (Q3 2026)". Props: `value`, `periodicity`, `prefix?`, `fallback?`. |

## Drag and drop (`components/dnd/`)

One helper for every ordered list, on `@dnd-kit/core` + `@dnd-kit/sortable`.
It owns the sensors (pointer and keyboard, so a reorder never needs a
mouse), the vertical-axis modifiers and the `arrayMove` arithmetic; the callers
only receive the reordered ids and post them to their own `reorder` procedure.
The up / down chevron buttons were removed everywhere it is used: categories,
custom fields, rules, saved searches, the layouts of a document type and the
actions of a rule.

| Component | Usage |
| --- | --- |
| `SortableList` | Context of one sortable group. Props: `ids`, `onReorder(ids)`, `label?`, `disabled?`. |
| `SortableRow` | One draggable row; children is a render function receiving `{ handleProps, isDragging }`. Props: `id`, `as?` (`li` \| `div`), `className?`. |
| `DragHandle` | Grip button, the only grabbable area of a row (the links and buttons inside keep working). Focus it and press Space to move it with the arrows. Props: `handleProps`, `label`, `className?`, `disabled?`. |

## Dossiers (`components/dossiers/`)

Screens `/dossiers`, `/dossiers/$dossierId` and the "Dossiers" card of the
document page.

| Component | Usage |
| --- | --- |
| `DossierFormSheet` | Create / rename a Dossier (name, description). Props: `open`, `onOpenChange`, `dossier?`, `onSaved?`. `/dossiers` passes an `onSaved` that navigates to the new dossier, the way `/parties` does. |
| `DossierDocumentPicker` | "Add documents" dialog: search through `document.list`, multi-selection (members are ticked and disabled), then `dossier.addDocuments`. Props: `open`, `onOpenChange`, `dossierId`, `memberIds`. |
| `DocumentDossiersCard` | Membership of a document: the dossiers holding it, add through a combobox, remove. Props: `documentId`, `dossiers?`. Pass `document.get().dossiers` when you have it (`DocumentMetaPanel` does); without it the card reads `dossier.listForDocument` itself. |

## Reminders (`components/reminders/`)

Screen `/reminders` (SPEC §2 "Misc"). Reminders are generated, never entered by
hand.

| Component | Usage |
| --- | --- |
| `ReminderList` | `reminder.list` grouped by kind (expiry / missing document / review pending) with snooze (date popover), done and dismiss on every row. Props: `items`, `isLoading?`. |
| `ReminderBell` | Bell of the top bar: `reminder.count` badge linking to `/reminders`. |

## Share links (`components/share/`)

| Component | Usage |
| --- | --- |
| `ShareDialog` | Share links of a document or a dossier: existing links (`shareLink.list`, with views / quota, expiry, state badge — a revoked one says why through `SHARE_REVOKED_REASON_LABELS`, “Revoked automatically: document became sensitive” for `revokedReason: "sensitive"` — copy and revoke or delete) and the creation form (expiry, password, maximum views, allow download). The displayed URL is `link.url`, resolved by `publicSharePageUrl` (see below); the created one is copied to the clipboard. On a dossier, `document.list({ dossierId, sensitive: true, pageSize: 1 })` is probed first: a single sensitive member disables the whole form with a warning rather than letting the API refuse the submit. Props: `open`, `onOpenChange`, `documentId?` \| `dossierId?`, `title`. The public page is the route `/s/$token`, which reads `/api/s/:token` without any session. |

## Export (`components/export/`)

| Component | Usage |
| --- | --- |
| `ExportDialog` | Tree export of the current `/documents` selection: layout (`EXPORT_LAYOUT_LABELS`), title template with the `TITLE_PLACEHOLDERS` chips, metadata, sensitive documents (with a warning), live `export.preview` (count, size, sample paths) and "Download ZIP" through `POST /api/export`. The saved file takes its name from the `Content-Disposition` of the response (`filenameFromContentDisposition`, which reads both `filename*=UTF-8''…` and the quoted `filename="…"`); the header is only readable because the server lists it in `Access-Control-Expose-Headers`, and `docstore-export.zip` is used when it is missing. Props: `open`, `onOpenChange`, `filters`. |

## Rules (`components/rules/`)

Two screens, deliberately kept in two different places:

- Automations, the cross-cutting rules of the engine (SPEC §3), under
  `/settings/automations`, `/settings/automations/new` and
  `/settings/automations/$ruleId`. The old `/rules` addresses redirect there.
  In the interface they are always called *automations*, never "rules".
- Extraction rules, which only exist inside a layout of a document type
  (SPEC §9): `/types/$typeId/extraction/new?layoutId=…` and
  `/types/$typeId/extraction/$extractionRuleId`, both reached from the Layouts
  tab of the type. There is no standalone list any more, and `/rules/extraction`
  redirects to `/types`.

The English enum labels (`RULE_TRIGGER_LABELS` / `_SHORT` / `_HINTS`,
`RULE_CONDITION_OP_LABELS` / `_SHORT`, `RULE_CONDITION_FIELD_LABELS`,
`RULE_COMPARATOR_LABELS`, `RULE_ACTION_TYPE_LABELS` + `ruleActionLabel()`,
`EXTRACTION_TARGET_LABELS`, `ANCHOR_POSITION_LABELS`,
`POSTPROCESS_STEP_LABELS`, `DOCUMENT_SOURCE_LABELS`) live in
`rule-labels.ts`, together with `AUTOMATIONS_DESCRIPTION` (the one-line
description of the tab), `UI_RULE_ACTION_TYPES` (the actions the editor offers)
and the
helpers that drive the builders: `ruleFieldKind`, `comparatorsForField`,
`valueControlFor`, `TITLE_PLACEHOLDERS` and `regexError`.

| Component | Usage |
| --- | --- |
| `RuleList` | Body of `/settings/automations`: priority reordered by drag and drop (`rule.reorder`), name + description, trigger badges, match counter and last match, enable `Switch` (`rule.toggle`), row menu (edit, duplicate, "Run on…" with confirmation, delete). Empty state with "Create your first automation". It reproduces the `DataList` frame by hand rather than using it: `DataList` owns its row element and cannot hand it over to `SortableRow`. |
| `LayoutExtractionRules` (`extraction-rule-list.tsx`) | Extraction rules of **one** layout (`extractionRule.list({ layoutId })`): name + target, strategy badge, delete on hover, and an "Add extraction rule" button opening the editor prefilled with the layout. Props: `documentTypeId`, `layoutId`. Rendered by the Layouts tab of a document type. |
| `RuleEditor` | Full page `/settings/automations/$ruleId` and `/settings/automations/new` (outside the settings shell, so no header is stacked): definition (name, description, enabled, triggers, stop on match), condition and actions on the left, sticky test panel on the right. Props: `rule?`. |
| `ConditionBuilder` | Recursive `and` / `or` / `not` tree. Each leaf is a field select (`detected_identifiers.*` collapsed into one entry plus a "kind" sub-select), a comparator select filtered by field type, and a value control. Collapsible read-only "JSON" view with a copy button. Helpers: `asConditionGroup`, `updateConditionAt`, `isConditionGroup`, `EMPTY_GROUP`. |
| `ConditionValueInput` | Operand of a leaf, chosen by `valueControlFor`: text, number, `DatePicker`, regex with its flags and inline validity, list for `in`, two bounds for `between`, `CategoryPicker` / `TagInput` / `PartyPicker` (or `PartyMultiPicker` for `in`) for the reference fields. |
| `ConditionTrace` | Condition tree annotated with ✓ / ✗ per node. Rebuilds the pairing from the flat post-order trace returned by `rule.test`. `describeLeaf(leaf)` gives the sentence form. |
| `RuleActionsEditor` | Ordered list of actions (`UI_RULE_ACTION_TYPES`), one control set per type, drag-and-drop reorder (`SortableList`, the array position is the identity), delete. `set_document_type` carries a `DocumentTypePicker`; `set_field` only takes a **literal** value. `set_category` and `run_extraction` are gone: filing a recurring document and reading a value off the page are the job of a document type and of the extraction rules of its layout. |
| `RuleTestPanel` | Document picker + "Test" (`rule.test` on the draft): matched badge, enabled badge, `ConditionTrace`, `PlannedOperationList` — replaced by "This automation has no actions" when `hasActions` is `false` — extraction results. On a saved rule: "Run on this document" and a "Run on all matching" dialog (`rule.run`). |
| `PlannedOperationList` | Operations returned by `rule.test` / `rule.runs`, with the names of the referenced categories, tags, parties and fields plus their confidence. |
| `RuleRunsDrawer` | `rule.runs` journal in a side sheet (paginated). Props: `ruleId?` (absent = every rule). |
| `ExtractionRuleEditor` | Full page `/types/$typeId/extraction/…`: breadcrumb back to the type, name, target, the layout it belongs to (required, never detachable), strategy tabs **Regex** / **Anchor** / **Zone**, post-processing chain, test panel and text layout. Props: `documentTypeId`, `rule?`, `layoutId?`. |
| `PostprocessEditor` | Chain of `trim` / `number_fr` / `date_fr` / `month_fr` / `uppercase` / `regex_replace` steps, reorderable. |
| `LayoutLinesList` / `ZoneSelector` | Right column of the extraction editor: page-by-page lines rebuilt by `extractionRule.preview` (clicking a line fills the anchor label), and an SVG of the word boxes from `document.getFileLayout` where dragging draws the normalised `zone` rectangle. `ZoneRect` is the shared shape. |
| `TestDocumentPicker` | Document chooser of the two test panels and of the relation dialog (`document.list`, full-text search). Props: `value`, `onValueChange`, `label?`, `excludeId?` (hides one document, e.g. the current one). |

## Review (`components/review/`)

| Component | Usage |
| --- | --- |
| `ReviewSheet` | Side panel of `/review` (`Sheet` `size="xl"`): PDF preview, `ReviewAssignments`, the whole `DocumentMetaPanel`, then Trash / Reprocess / Approve / Approve & next. Shortcuts `j`, `k`, `a`, `r`, `Esc`. |
| `ReviewAssignments` | Metadata filled in during ingestion (category, tags, parties, custom fields) with their `AssignmentSourceBadge`, a "keep" tick (local mark) and a "reject" cross (`review.rejectAssignment`). `REVIEW_REJECT_ATTRIBUTE` marks the buttons the `r` shortcut focuses. |

## Settings (`components/settings/`)

The `/settings` section and its nine tabs (`SETTINGS_TABS` in
`@/lib/navigation`, one child route each). `/settings` redirects to
`/settings/general`; every tab component is the whole page, laid out with
`SettingsStack` + `SettingsPanel`. The English enum labels
(`CUSTOM_FIELD_TYPE_LABELS`, `API_KEY_SCOPE_LABELS` / `_HINTS`,
`INTAKE_SOURCE_TYPE_LABELS`, `FOLDER_AFTER_IMPORT_LABELS`,
`MAIL_AFTER_IMPORT_LABELS`, `INTAKE_OUTCOME_LABELS` / `_TONES`,
`WEBHOOK_EVENT_LABELS`, `DELIVERABLE_EVENT_LABELS`) and the `statusTone` /
`formatDateTime` helpers live in `settings-labels.ts`.

| Component | Usage |
| --- | --- |
| `SettingsStack` / `SettingsPanel` / `SettingsRow` | Layout of a settings page: page margins, double-rimmed block with a mono title, description and actions, then a "label + control" row. |
| `GeneralSettings` | `/settings/general`: `settings.get` / `settings.set`, one save per control (confidence `Slider`, "category required" and "issuer required" `Switch`, expiry lead days as a `ChipsInput` of numbers), plus the read-only `ServerInfoPanel` fed by `settings.serverInfo` (public web URL, API URL, version, configuration file path, each with a `CopyButton`). |
| `CategoryTree` | `/settings/categories`: three-level tree, inline creation and editing, drag-and-drop reorder **inside one sibling group** (one `SortableList` per level → `category.reorder({ parentId, ids })`), move to another parent through the dialog (`category.move`) and deletion with document reassignment. Each row also shows the number of custom fields scoped to the category; extraction rules are not counted here any more, they belong to a layout of a document type. |
| `TagManager` | `/settings/tags`: counters, inline creation and renaming, colour, deletion (`useConfirm`) and merge into another tag. |
| `CustomFieldList` | `/settings/custom-fields`: list reordered by drag and drop (`customField.reorder`), side sheet for the form (name, auto slug, type, `select` choices, `money` currency, an "Allow negative values" `Switch` for `money` and `number` (`options.allowNegative`), categories). Changing the type of a field that already has values is refused by the API: the `CONFLICT` message is surfaced by `toastApiError`. |
| `ApiKeyList` | `/settings/api-keys`: keys with prefix, scopes, last use and expiry; creation dialog (scopes as checkboxes), one-shot secret dialog with a copy button and a warning, revocation and deletion. Also the "Connect an MCP client" box (`claude mcp add …`), whose host comes from `settings.serverInfo().apiUrl` — the API is the only side that knows the origin an MCP client can reach. |
| `IntakeSourceList` / `IntakeSourceSheet` | `/settings/intake-sources`: channels with their state, counters and last error; toggle, "run now", "test connection", journal dialog (paginated), deletion. The configuration file path (`settings.serverInfo().configPath`) is shown above the list. A source declared by that file (`managed: true`) carries a "Server config" badge with the tooltip "Defined in docstore.config.json", and its toggle, edit and delete are disabled — run, test and the journal stay live. The sheet holds one form per type (folder / mailbox), a "Test connection" button (`intakeSource.test`, on the draft or on the stored source when the password is left untouched) and the defaults; opened on a managed source it is read-only. |
| `UploadLinkList` | `/settings/upload-links`: public links with their URL (copy button), quota and expiry; sheet for the form, disable and delete. The public page is the route `/u/$token`. |
| `WebhookList` | `/settings/webhooks`: subscriptions with their events and last status, enable switch, `ping` test, delivery journal (paginated), sheet for the form with a secret generated in the browser. |
| `IntakeDefaultsFields` | Shared "defaults" block (`CategoryPicker`, `TagInput`, `PartyPicker`, sensitive) of the intake sources and of the upload links. |
| `CategoryMultiSelect` / `CategoryBadges` | Multi-selection of categories by full path, used by the custom fields. |
| `IconPicker` / `CategoryIcon` / `CATEGORY_ICONS` | Fixed list of ~40 Lucide icons offered for a category (the API stores the kebab-case name). |
| `ColorPicker` / `TAXONOMY_COLORS` | Palette of twelve Tailwind hues (step `500`) for categories and tags, plus a "no colour" entry. |
| `CopyButton` | Copy to the clipboard with a two-second tick. Props: `value`, `label`, `children?`, `variant?`. |

Related utility: `@/lib/upload-link-url` (`publicUploadPageUrl` for the URL
handed to the depositor, `publicUploadApiUrl` for the plain `GET`/`POST`
endpoints of the server). `publicUploadPageUrl` takes the whole link, not just
its token, because it starts from the `url` the API returns (see below).

## Public link URLs

`shareLink` and `uploadLink` both return a ready-made `url`, built server side
from `PUBLIC_URL` (falling back to `BETTER_AUTH_URL`). That value wins: the API
is the only side that knows the origin a third party can reach behind the
reverse proxy, so `publicSharePageUrl(link)` and `publicUploadPageUrl(link)`
display it verbatim. Both take the link, not just its token.

The single exception is the split-port development setup: `bun run dev` serves
this application on `:3001` while `PUBLIC_URL` / `BETTER_AUTH_URL` point at the
API on `:3000`, so the URL handed out would open the wrong host. The rule,
implemented once in `resolvePublicPageUrl` (`@/lib/public-link-url`):

> keep the `window.location.origin` fallback only when the build is a
> development build (`import.meta.env.DEV`) and the host of the API URL
> differs from the one the browser sits on.

In production the two hosts match and the API URL is used as is; during the
server-rendered pass there is no origin to compare against, so the API URL is
used as is there too. A `url` that is empty or unparsable also falls back to the
current origin.

## Primitives added to `packages/ui`

Both are logic-free, drawn with the theme tokens, and never talk to the API.

| Primitive | Usage |
| --- | --- |
| `Calendar` / `MonthGrid` / `YearGrid` (`components/calendar`) | Dependency-free `en-GB` grids (weeks start on Monday). `Calendar` is a six-week day grid with roving-tabindex keyboard navigation (arrows cross months, Home / End jump to the ends of the week, PageUp / PageDown change month); `MonthGrid` is the twelve months of a year; `YearGrid` a twelve-year page. Props: `value`, `onSelect`, `label?`. The app wraps them in `DatePicker` and `PeriodPicker`. |
| `TagsInput` / `TagsInputChip` / `TagsInputField` (`components/tags-input`) | Field that looks like a single `Input` but holds chips followed by a free-text entry; clicking anywhere focuses the entry. The caller owns the values, the suggestions and the keyboard — see `TagInput`. |

## Conventions

- Tailwind: theme scale and tokens only (`bg-background`, `text-muted-foreground`,
  `bg-tone-success`…). No arbitrary value, no `dark:` colour class: everything goes
  through the variables of `packages/ui/src/styles/globals.css`.
- Titles in `font-extrabold tracking-tight` (Plus Jakarta Sans); dates, identifiers,
  amounts, counters and section labels in `font-mono` + `tabular-nums`.
- Yellow (`primary`) is the only accent: primary button, focus ring, active
  navigation, party initials. `selection` is the translucent yellow of the active
  navigation, the text selection and the `primary` badge; `accent` is the neutral
  hover surface. Badge tones are `neutral`, `success` (emerald), `warning` (amber),
  `info` (sky), `danger` (red), `primary`, `sensitive`, `outline`, `solid`.
- "Double rim" frames: a `.shell` shell (utility from `globals.css`) around a
  `rounded-xl bg-card shadow-soft ring-1 ring-border` core, which is exactly
  what `Card` from `packages/ui` already does (its `className` applies to the
  shell).
- Width of a side sheet: `SheetContent` takes a `size` prop (`sm` by default,
  then `md`, `lg`, `xl`). A plain `sm:max-w-*` in `className` is ignored,
  because the built-in `data-[side=right]:sm:max-w-*` selector is more specific.
- Transitions: `duration-200 ease-premium` (token `--ease-premium`), always
  between 150 ms and 250 ms. Overlays (dialog, popover, dropdown, select,
  combobox, tooltip, sheet) transition through the Base UI
  `data-starting-style:` / `data-ending-style:` attributes rather than keyframe
  classes. List rows appear with the `row-in` utility, the bulk bar with
  `bar-in` / `bar-out`. The base layer of `globals.css` collapses every one of
  them when `prefers-reduced-motion` is set, so never add a duration that
  escapes it.
- Sticking under the top bar: the height of the shell header is the theme
  token `--spacing-header` (4 rem). `AppShell` draws the bar with `h-header`;
  every sticky element that would otherwise disappear behind it uses
  `top-header` (tabs of `/types/$typeId`, test panel of the rule editor,
  preview column of the document page), and a column that must fill the rest of
  the screen uses `h-below-header` / `max-h-below-header`. No arbitrary
  `top-[64px]` anywhere.
- All visible text is in English; dates use `en-GB` ("12 Oct 2025"), amounts use
  `Intl.NumberFormat("en-GB", { style: "currency" })` and file sizes read "245 KB".
- Enum labels are capitalised ("Company", "Issuer", "Processing", "Monthly")
  and each family carries a `*_ICONS` record; `IconLabel` / `iconLabelItems`
  render the icon + label pair in the options, the trigger and the badges.
- No text glyph as UI: arrows, ticks, crosses and separators are Lucide
  icons (`ArrowRightIcon`, `ChevronRightIcon`, `CheckIcon`, `XIcon`, `DotIcon`).
  `…` stays inside sentences ("Search a party…"), `·` stays as the separator of
  a composed sentence.
- Toasts use `sonner`. API errors go through `toastApiError(error, fallback)`:
  the headline is always English, the raw server message only appears as a
  secondary line for known codes.
