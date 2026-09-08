import type { CustomField } from "@docstore/shared/custom-field";
import type { DocumentPartyRole } from "@docstore/shared/document";
import { DOCUMENT_PARTY_ROLES } from "@docstore/shared/document";
import type { RuleAction } from "@docstore/shared/rule";
import { Badge } from "@docstore/ui/components/badge";
import { Button } from "@docstore/ui/components/button";
import { Input } from "@docstore/ui/components/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@docstore/ui/components/select";
import { Switch } from "@docstore/ui/components/switch";
import { useQuery } from "@tanstack/react-query";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { useId } from "react";

import { DatePicker } from "@/components/date-picker";
import {
	DragHandle,
	SortableList,
	SortableRow,
} from "@/components/dnd/sortable";
import { DocumentTypePicker } from "@/components/document-types/document-type-picker";
import { CategoryPicker } from "@/components/documents/category-picker";
import {
	DOCUMENT_PARTY_ROLE_ICONS,
	DOCUMENT_PARTY_ROLE_LABELS,
} from "@/components/documents/document-labels";
import { TagInput } from "@/components/documents/tag-input";
import { EmptyState } from "@/components/empty-state";
import { FormField } from "@/components/form-field";
import { IconLabel, iconLabelItems } from "@/components/icon-label";
import { PartyPicker } from "@/components/parties/party-picker";
import { orpc } from "@/utils/orpc";

import {
	RULE_ACTION_TYPE_LABELS,
	ruleActionLabel,
	TITLE_PLACEHOLDERS,
	UI_RULE_ACTION_TYPES,
	type UiRuleActionType,
} from "./rule-labels";

const ROLE_ITEMS = iconLabelItems(
	DOCUMENT_PARTY_ROLES,
	DOCUMENT_PARTY_ROLE_LABELS,
	DOCUMENT_PARTY_ROLE_ICONS,
);

/** Blank action of each type, used when the user picks one in the select. */
function emptyAction(type: UiRuleActionType): RuleAction {
	switch (type) {
		case "set_category":
			return { type, categoryId: "" };
		case "add_tag":
		case "remove_tag":
			return { type, tagId: "" };
		case "add_to_dossier":
			return { type, dossierId: "" };
		case "link_party":
			return { type, partyId: "", role: "issuer" };
		case "set_field":
			return { type, fieldId: "", value: "" };
		case "set_document_date":
		case "set_period":
		case "set_valid_until":
			return { type };
		case "set_title":
			return { type, template: "{date:YYYY-MM} - {issuer} - {category}" };
		case "set_sensitive":
			return { type, sensitive: true };
		case "set_document_type":
			return { type, documentTypeId: "" };
		default:
			return { type: "webhook", url: "" };
	}
}

export interface RuleActionsEditorProps {
	value: RuleAction[];
	onChange: (actions: RuleAction[]) => void;
}

/**
 * Ordered list of the actions applied when the condition matches (SPEC §3).
 * Each type carries its own controls; the order is the execution order.
 */
export function RuleActionsEditor({ value, onChange }: RuleActionsEditorProps) {
	// The actions have no identifier of their own: the position is the key, and
	// the drag and drop reorders the array from it.
	const ids = value.map((_, index) => String(index));

	const onReorder = (nextIds: string[]) => {
		onChange(
			nextIds
				.map((id) => value[Number(id)])
				.filter((action): action is RuleAction => action !== undefined),
		);
	};

	return (
		<div className="flex flex-col gap-3">
			{value.length === 0 ? (
				<EmptyState
					size="sm"
					title="No action yet"
					description="A rule without an action only records a match."
				/>
			) : (
				<SortableList
					ids={ids}
					onReorder={onReorder}
					label="Reorder the actions of the rule"
				>
					<ul className="flex flex-col gap-2">
						{value.map((action, index) => (
							<SortableRow
								key={index}
								id={String(index)}
								className="flex items-start gap-2 rounded-lg bg-muted/40 p-2.5 ring-1 ring-border"
							>
								{({ handleProps }) => (
									<>
										<DragHandle
											handleProps={handleProps}
											label={`Reorder the action ${ruleActionLabel(action.type)}`}
										/>
										<div className="flex min-w-0 flex-1 flex-col gap-2">
											<div className="flex items-center gap-2">
												<Badge tone="primary">{index + 1}</Badge>
												<p className="font-semibold text-sm">
													{ruleActionLabel(action.type)}
												</p>
												<span className="min-w-0 flex-1" />
												<Button
													variant="ghost"
													size="icon-sm"
													aria-label={`Remove the action ${ruleActionLabel(action.type)}`}
													onClick={() =>
														onChange(
															value.filter((_, position) => position !== index),
														)
													}
												>
													<Trash2Icon />
												</Button>
											</div>
											<ActionFields
												action={action}
												onChange={(next) =>
													onChange(
														value.map((item, position) =>
															position === index ? next : item,
														),
													)
												}
											/>
										</div>
									</>
								)}
							</SortableRow>
						))}
					</ul>
				</SortableList>
			)}

			<AddActionSelect onAdd={(action) => onChange([...value, action])} />
		</div>
	);
}

function AddActionSelect({ onAdd }: { onAdd: (action: RuleAction) => void }) {
	return (
		<Select
			items={RULE_ACTION_TYPE_LABELS}
			value=""
			onValueChange={(type) => {
				if (type) {
					onAdd(emptyAction(type as UiRuleActionType));
				}
			}}
		>
			<SelectTrigger className="w-full" aria-label="Add an action">
				<span className="flex items-center gap-2 text-muted-foreground">
					<PlusIcon className="size-4" />
					Add an action
				</span>
			</SelectTrigger>
			<SelectContent>
				{UI_RULE_ACTION_TYPES.map((type) => (
					<SelectItem key={type} value={type}>
						{RULE_ACTION_TYPE_LABELS[type]}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

/** Controls of one action, dispatched on its type. */
function ActionFields({
	action,
	onChange,
}: {
	action: RuleAction;
	onChange: (action: RuleAction) => void;
}) {
	const ids = useId();

	switch (action.type) {
		case "set_document_type":
			return (
				<FormField
					label="Document type"
					htmlFor={`${ids}-document-type`}
					hint="Applies the whole type: category, parties, tags, title and the extraction of its layout."
				>
					<DocumentTypePicker
						id={`${ids}-document-type`}
						value={action.documentTypeId || null}
						onValueChange={(documentTypeId) =>
							onChange({ ...action, documentTypeId: documentTypeId ?? "" })
						}
					/>
				</FormField>
			);

		case "set_category":
			return (
				<FormField
					label="Category"
					htmlFor={`${ids}-category`}
					hint="For a one-off family. A recurring one belongs in a document type, which files it and extracts from it."
				>
					<CategoryPicker
						id={`${ids}-category`}
						value={action.categoryId || null}
						onValueChange={(categoryId) =>
							onChange({ ...action, categoryId: categoryId ?? "" })
						}
					/>
				</FormField>
			);

		case "add_to_dossier":
			return (
				<AddToDossierAction action={action} onChange={onChange} ids={ids} />
			);

		case "add_tag":
		case "remove_tag":
			return (
				<FormField label="Tag" htmlFor={`${ids}-tag`}>
					<TagInput
						id={`${ids}-tag`}
						label="Tag"
						value={action.tagId ? [action.tagId] : []}
						onValueChange={(ids_) =>
							onChange({ ...action, tagId: ids_.at(-1) ?? "" })
						}
					/>
				</FormField>
			);

		case "link_party":
			return (
				<div className="grid gap-3 sm:grid-cols-2">
					<FormField label="Party" htmlFor={`${ids}-party`}>
						<PartyPicker
							id={`${ids}-party`}
							value={action.partyId || null}
							onValueChange={(partyId) =>
								onChange({ ...action, partyId: partyId ?? "" })
							}
						/>
					</FormField>
					<FormField label="Role" htmlFor={`${ids}-role`}>
						<Select
							items={ROLE_ITEMS}
							value={action.role}
							onValueChange={(role) =>
								onChange({ ...action, role: role as DocumentPartyRole })
							}
						>
							<SelectTrigger id={`${ids}-role`} className="w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{DOCUMENT_PARTY_ROLES.map((role) => (
									<SelectItem key={role} value={role}>
										<IconLabel
											icon={DOCUMENT_PARTY_ROLE_ICONS[role]}
											label={DOCUMENT_PARTY_ROLE_LABELS[role]}
										/>
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</FormField>
				</div>
			);

		case "set_field":
			return <SetFieldAction action={action} onChange={onChange} ids={ids} />;

		case "set_document_date":
		case "set_period":
		case "set_valid_until":
			return (
				<p className="text-muted-foreground text-xs">
					The date is the one detected automatically in the text. To read it at
					a precise place on the page, add an extraction rule to the layout of a
					document type.
				</p>
			);

		case "set_title":
			return (
				<FormField
					label="Title template"
					htmlFor={`${ids}-template`}
					hint="A placeholder with no value is dropped, along with its separator."
				>
					<Input
						id={`${ids}-template`}
						value={action.template}
						className="font-mono"
						onChange={(event) =>
							onChange({ ...action, template: event.target.value })
						}
					/>
					<div className="mt-1 flex flex-wrap gap-1">
						{TITLE_PLACEHOLDERS.map((placeholder) => (
							<Button
								key={placeholder.token}
								variant="outline"
								size="sm"
								title={placeholder.hint}
								onClick={() =>
									onChange({
										...action,
										template: `${action.template}${placeholder.token}`,
									})
								}
							>
								<span className="font-mono text-xs">{placeholder.token}</span>
							</Button>
						))}
					</div>
				</FormField>
			);

		case "set_sensitive":
			return (
				<div className="flex items-center justify-between gap-4">
					<label htmlFor={`${ids}-sensitive`} className="text-sm">
						Mark the document as sensitive
					</label>
					<Switch
						id={`${ids}-sensitive`}
						checked={action.sensitive}
						onCheckedChange={(sensitive) => onChange({ ...action, sensitive })}
					/>
				</div>
			);

		case "webhook":
			return (
				<FormField
					label="Webhook URL"
					htmlFor={`${ids}-url`}
					hint="Planned but not delivered yet: the call is only logged."
				>
					<Input
						id={`${ids}-url`}
						value={action.url}
						placeholder="https://example.com/hooks/docstore"
						className="font-mono"
						onChange={(event) =>
							onChange({ ...action, url: event.target.value })
						}
					/>
				</FormField>
			);

		default:
			return null;
	}
}

/** Dossier the document is filed into when the automation matches. */
function AddToDossierAction({
	action,
	onChange,
	ids,
}: {
	action: Extract<RuleAction, { type: "add_to_dossier" }>;
	onChange: (action: RuleAction) => void;
	ids: string;
}) {
	// A closed dossier still accepts documents: it only drops out of the default
	// lists, so an automation may legitimately point at one.
	const dossiers = useQuery(
		orpc.dossier.list.queryOptions({ input: { includeClosed: true } }),
	);
	const items = dossiers.data ?? [];
	const labels = Object.fromEntries(
		items.map((dossier) => [dossier.id, dossier.name]),
	);

	return (
		<FormField label="Dossier" htmlFor={`${ids}-dossier`}>
			<Select
				items={labels}
				value={action.dossierId}
				onValueChange={(dossierId) =>
					onChange({ ...action, dossierId: dossierId ?? "" })
				}
			>
				<SelectTrigger id={`${ids}-dossier`} className="w-full">
					<SelectValue placeholder="Choose a dossier…" />
				</SelectTrigger>
				<SelectContent>
					{items.map((dossier) => (
						<SelectItem key={dossier.id} value={dossier.id}>
							{dossier.name}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</FormField>
	);
}

/** Custom field and the literal value written into it. */
function SetFieldAction({
	action,
	onChange,
	ids,
}: {
	action: Extract<RuleAction, { type: "set_field" }>;
	onChange: (action: RuleAction) => void;
	ids: string;
}) {
	const fields = useQuery(orpc.customField.list.queryOptions({ input: {} }));
	const items: CustomField[] = fields.data ?? [];
	const selected = items.find((field) => field.id === action.fieldId) ?? null;

	const fieldLabels = Object.fromEntries(
		items.map((field) => [field.id, field.name]),
	);

	return (
		<div className="flex flex-col gap-3">
			<FormField label="Custom field" htmlFor={`${ids}-field`}>
				<Select
					items={fieldLabels}
					value={action.fieldId}
					onValueChange={(fieldId) =>
						onChange({ ...action, fieldId: fieldId ?? "" })
					}
				>
					<SelectTrigger id={`${ids}-field`} className="w-full">
						<SelectValue placeholder="Choose a field…" />
					</SelectTrigger>
					<SelectContent>
						{items.map((field) => (
							<SelectItem key={field.id} value={field.id}>
								{field.name}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</FormField>

			<FormField
				label="Literal value"
				htmlFor={`${ids}-literal`}
				hint="Reading the value off the page is the job of the extraction rules of a layout."
			>
				<LiteralValueInput
					id={`${ids}-literal`}
					field={selected}
					value={action.value}
					onChange={(value) => onChange({ ...action, value })}
				/>
			</FormField>
		</div>
	);
}

function LiteralValueInput({
	id,
	field,
	value,
	onChange,
}: {
	id: string;
	field: CustomField | null;
	value: string | number | boolean | undefined;
	onChange: (value: string | number | boolean) => void;
}) {
	if (field?.type === "boolean") {
		return (
			<Switch
				id={id}
				checked={value === true}
				onCheckedChange={(checked) => onChange(checked)}
			/>
		);
	}
	if (field?.type === "number" || field?.type === "money") {
		return (
			<Input
				id={id}
				type="number"
				className="font-mono tabular-nums"
				value={typeof value === "number" ? String(value) : ""}
				onChange={(event) => onChange(Number(event.target.value))}
			/>
		);
	}
	if (field?.type === "date") {
		return (
			<DatePicker
				id={id}
				label="Literal value"
				value={typeof value === "string" ? value : null}
				onValueChange={(next) => onChange(next ?? "")}
			/>
		);
	}
	return (
		<Input
			id={id}
			value={typeof value === "boolean" ? "" : (value ?? "")}
			onChange={(event) => onChange(event.target.value)}
		/>
	);
}
