import {
	RULE_CONDITION_FIELDS,
	RULE_CONDITION_OPS,
	type RuleComparator,
	type RuleCondition,
	type RuleConditionField,
	type RuleConditionGroup,
	type RuleConditionLeaf,
	type RuleConditionOp,
} from "@docstore/shared/rule";
import { Button } from "@docstore/ui/components/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@docstore/ui/components/select";
import {
	ToggleGroup,
	ToggleGroupItem,
} from "@docstore/ui/components/toggle-group";
import { cn } from "@docstore/ui/lib/utils";
import {
	BracketsIcon,
	ChevronDownIcon,
	ChevronRightIcon,
	PlusIcon,
	XIcon,
} from "lucide-react";
import { useId, useState } from "react";

import { CopyButton } from "@/components/settings/copy-button";

import { ConditionValueInput } from "./condition-value-input";
import {
	comparatorsForField,
	DETECTED_IDENTIFIER_KIND_LABELS,
	DETECTED_IDENTIFIER_PREFIX,
	RULE_COMPARATOR_LABELS,
	RULE_CONDITION_FIELD_LABELS,
	RULE_CONDITION_OP_LABELS,
	RULE_CONDITION_OP_SHORT,
} from "./rule-labels";

/** Position of a node in the tree: one child index per level. */
export type ConditionPath = number[];

export function isConditionGroup(
	node: RuleCondition,
): node is RuleConditionGroup {
	return "op" in node;
}

/** Root of a freshly created rule: an empty `and` group matches everything. */
export const EMPTY_GROUP: RuleConditionGroup = { op: "and", children: [] };

/** Default leaf added by the "Condition" button. */
export const DEFAULT_LEAF: RuleConditionLeaf = {
	field: "content",
	cmp: "icontains",
	value: "",
};

/**
 * Applies a comparator to a leaf.
 *
 * Switching to `regex` writes `flags: "i"` rather than leaving the field
 * empty: matching without regard to case is what people expect of a search
 * box, but the engine adds nothing on its own, so the choice has to be spelled
 * out in the leaf. Unticking the toggle then really is case-sensitive.
 */
export function withComparator(
	leaf: RuleConditionLeaf,
	cmp: string,
): RuleConditionLeaf {
	const next: RuleConditionLeaf = { ...leaf, cmp: cmp as RuleComparator };
	if (next.cmp === "regex" && next.flags === undefined) next.flags = "i";
	return next;
}

/** The editor always works on a group: a bare leaf is wrapped in an `and`. */
export function asConditionGroup(node: RuleCondition): RuleConditionGroup {
	return isConditionGroup(node) ? node : { op: "and", children: [node] };
}

function replaceChild(
	group: RuleConditionGroup,
	index: number,
	child: RuleCondition | null,
): RuleConditionGroup {
	const children = [...group.children];
	if (child === null) {
		children.splice(index, 1);
	} else {
		children[index] = child;
	}
	return { ...group, children };
}

/** Immutably replaces (or removes, with `null`) the node at `path`. */
export function updateConditionAt(
	root: RuleConditionGroup,
	path: ConditionPath,
	next: RuleCondition | null,
): RuleConditionGroup {
	const [index, ...rest] = path;
	if (index === undefined) {
		return next === null ? EMPTY_GROUP : asConditionGroup(next);
	}
	if (rest.length === 0) {
		return replaceChild(root, index, next);
	}
	const child = root.children[index];
	if (!child || !isConditionGroup(child)) {
		return root;
	}
	return replaceChild(root, index, updateConditionAt(child, rest, next));
}

/** Field select value: the identifier kinds collapse into one entry. */
const DETECTED_ENTRY = "detected_identifiers";

const SIMPLE_FIELDS = RULE_CONDITION_FIELDS.filter(
	(field) => !field.startsWith(DETECTED_IDENTIFIER_PREFIX),
);

const IDENTIFIER_KINDS = RULE_CONDITION_FIELDS.filter((field) =>
	field.startsWith(DETECTED_IDENTIFIER_PREFIX),
).map((field) => field.slice(DETECTED_IDENTIFIER_PREFIX.length));

const FIELD_SELECT_LABELS: Record<string, string> = {
	...Object.fromEntries(
		SIMPLE_FIELDS.map((field) => [field, RULE_CONDITION_FIELD_LABELS[field]]),
	),
	[DETECTED_ENTRY]: "Detected identifier",
};

export interface ConditionBuilderProps {
	value: RuleCondition;
	onChange: (condition: RuleCondition) => void;
}

/**
 * Recursive condition builder (SPEC §3): `and` / `or` / `not` groups holding
 * leaves "field · comparator · value". The JSON stays in sync and is shown in
 * a collapsible read-only panel.
 */
export function ConditionBuilder({ value, onChange }: ConditionBuilderProps) {
	const root = asConditionGroup(value);
	const [showJson, setShowJson] = useState(false);
	const json = JSON.stringify(root, null, 2);

	const patch = (path: ConditionPath, next: RuleCondition | null) => {
		onChange(updateConditionAt(root, path, next));
	};

	return (
		<div className="flex flex-col gap-3">
			<ConditionGroupEditor
				group={root}
				path={[]}
				depth={0}
				onPatch={patch}
				onRemove={null}
			/>

			<div className="rounded-lg bg-muted/40 ring-1 ring-border">
				<div className="flex items-center gap-2 px-3 py-2">
					<Button
						variant="ghost"
						size="sm"
						aria-expanded={showJson}
						onClick={() => setShowJson(!showJson)}
					>
						{showJson ? <ChevronDownIcon /> : <ChevronRightIcon />}
						JSON
					</Button>
					<span className="min-w-0 flex-1" />
					<CopyButton value={json} label="Condition JSON" />
				</div>
				{showJson ? (
					<pre
						data-testid="condition-json"
						className="max-h-80 overflow-auto border-border border-t px-3 py-2 font-mono text-xs leading-relaxed"
					>
						{json}
					</pre>
				) : null}
			</div>
		</div>
	);
}

/** Nesting colour of the group frame; wraps around after three levels. */
const DEPTH_RING = ["ring-border", "ring-border/70", "ring-border/50"] as const;

function ConditionGroupEditor({
	group,
	path,
	depth,
	onPatch,
	onRemove,
}: {
	group: RuleConditionGroup;
	path: ConditionPath;
	depth: number;
	onPatch: (path: ConditionPath, next: RuleCondition | null) => void;
	onRemove: (() => void) | null;
}) {
	const children = group.children ?? [];

	const addChild = (child: RuleCondition) => {
		onPatch(path, { ...group, children: [...children, child] });
	};

	return (
		<div
			className={cn(
				"flex flex-col gap-2 rounded-xl bg-card p-3 ring-1",
				DEPTH_RING[depth % DEPTH_RING.length],
			)}
		>
			<div className="flex flex-wrap items-center gap-2">
				<ToggleGroup
					value={[group.op]}
					onValueChange={(next: string[]) => {
						const op = next[0] as RuleConditionOp | undefined;
						if (op) {
							onPatch(path, { ...group, op });
						}
					}}
					variant="outline"
					size="sm"
					aria-label="Group operator"
				>
					{RULE_CONDITION_OPS.map((op) => (
						<ToggleGroupItem
							key={op}
							value={op}
							aria-label={RULE_CONDITION_OP_LABELS[op]}
						>
							{RULE_CONDITION_OP_SHORT[op]}
						</ToggleGroupItem>
					))}
				</ToggleGroup>
				<span className="text-muted-foreground text-xs">
					{RULE_CONDITION_OP_LABELS[group.op]} the following
					{children.length === 0 ? " (empty: always true)" : ""}
				</span>

				<span className="min-w-0 flex-1" />

				<Button
					variant="outline"
					size="sm"
					onClick={() => addChild({ ...DEFAULT_LEAF })}
				>
					<PlusIcon />
					Condition
				</Button>
				<Button
					variant="ghost"
					size="sm"
					onClick={() =>
						addChild({ op: "or", children: [{ ...DEFAULT_LEAF }] })
					}
				>
					<BracketsIcon />
					Group
				</Button>
				{onRemove ? (
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label="Remove this group"
						onClick={onRemove}
					>
						<XIcon />
					</Button>
				) : null}
			</div>

			{children.length === 0 ? (
				<p className="px-1 text-muted-foreground text-xs">
					No condition yet: this rule matches every document.
				</p>
			) : (
				<ul className="flex flex-col gap-2">
					{children.map((child, index) => {
						const childPath = [...path, index];
						return (
							<li key={childPath.join("-")}>
								{isConditionGroup(child) ? (
									<ConditionGroupEditor
										group={child}
										path={childPath}
										depth={depth + 1}
										onPatch={onPatch}
										onRemove={() => onPatch(childPath, null)}
									/>
								) : (
									<ConditionLeafEditor
										leaf={child}
										onChange={(next) => onPatch(childPath, next)}
										onRemove={() => onPatch(childPath, null)}
										onWrap={() =>
											onPatch(childPath, { op: "and", children: [child] })
										}
									/>
								)}
							</li>
						);
					})}
				</ul>
			)}
		</div>
	);
}

function ConditionLeafEditor({
	leaf,
	onChange,
	onRemove,
	onWrap,
}: {
	leaf: RuleConditionLeaf;
	onChange: (leaf: RuleConditionLeaf) => void;
	onRemove: () => void;
	onWrap: () => void;
}) {
	const ids = useId();
	const isDetected = leaf.field.startsWith(DETECTED_IDENTIFIER_PREFIX);
	const comparators = comparatorsForField(leaf.field);

	const changeField = (field: RuleConditionField) => {
		const allowed = comparatorsForField(field);
		const cmp = allowed.includes(leaf.cmp)
			? leaf.cmp
			: (allowed[0] as RuleComparator);
		onChange(withComparator({ ...leaf, field, value: undefined }, cmp));
	};

	return (
		<div className="flex flex-col gap-2 rounded-lg bg-muted/40 p-2.5 ring-1 ring-border">
			<div className="flex flex-wrap items-center gap-2">
				<Select
					items={FIELD_SELECT_LABELS}
					value={isDetected ? DETECTED_ENTRY : leaf.field}
					onValueChange={(next) => {
						if (next === DETECTED_ENTRY) {
							changeField(
								`${DETECTED_IDENTIFIER_PREFIX}${IDENTIFIER_KINDS[0]}` as RuleConditionField,
							);
							return;
						}
						changeField(next as RuleConditionField);
					}}
				>
					<SelectTrigger
						id={`${ids}-field`}
						className="w-52"
						aria-label="Condition field"
					>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{SIMPLE_FIELDS.map((field) => (
							<SelectItem key={field} value={field}>
								{RULE_CONDITION_FIELD_LABELS[field]}
							</SelectItem>
						))}
						<SelectItem value={DETECTED_ENTRY}>
							{FIELD_SELECT_LABELS[DETECTED_ENTRY]}
						</SelectItem>
					</SelectContent>
				</Select>

				{isDetected ? (
					<Select
						items={DETECTED_IDENTIFIER_KIND_LABELS}
						value={leaf.field.slice(DETECTED_IDENTIFIER_PREFIX.length)}
						onValueChange={(kind) =>
							changeField(
								`${DETECTED_IDENTIFIER_PREFIX}${kind}` as RuleConditionField,
							)
						}
					>
						<SelectTrigger className="w-36" aria-label="Identifier kind">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{IDENTIFIER_KINDS.map((kind) => (
								<SelectItem key={kind} value={kind}>
									{DETECTED_IDENTIFIER_KIND_LABELS[kind] ?? kind}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				) : null}

				<Select
					items={RULE_COMPARATOR_LABELS}
					value={leaf.cmp}
					onValueChange={(cmp) => {
						if (cmp) onChange(withComparator(leaf, cmp));
					}}
				>
					<SelectTrigger
						id={`${ids}-cmp`}
						className="w-52"
						aria-label="Comparator"
					>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{comparators.map((cmp) => (
							<SelectItem key={cmp} value={cmp}>
								{RULE_COMPARATOR_LABELS[cmp]}
							</SelectItem>
						))}
					</SelectContent>
				</Select>

				<span className="min-w-0 flex-1" />

				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="Wrap this condition in a group"
					onClick={onWrap}
				>
					<BracketsIcon />
				</Button>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="Remove this condition"
					onClick={onRemove}
				>
					<XIcon />
				</Button>
			</div>

			<ConditionValueInput
				id={`${ids}-value`}
				field={leaf.field}
				cmp={leaf.cmp}
				value={leaf.value}
				flags={leaf.flags}
				onValueChange={(value) => onChange({ ...leaf, value })}
				onFlagsChange={(flags) => onChange({ ...leaf, flags })}
			/>
		</div>
	);
}
