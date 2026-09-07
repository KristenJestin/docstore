import type {
	ConditionTraceEntry,
	RuleCondition,
	RuleConditionLeaf,
	RuleConditionValue,
} from "@docstore/shared/rule";
import { Badge } from "@docstore/ui/components/badge";
import { CheckIcon, XIcon } from "lucide-react";

import { isConditionGroup } from "./condition-builder";
import {
	RULE_COMPARATOR_LABELS,
	RULE_CONDITION_FIELD_LABELS,
	RULE_CONDITION_OP_LABELS,
} from "./rule-labels";

/**
 * The engine returns a flat trace in post-order (children before their parent).
 * Walking the same tree in the same order pairs every node with its result.
 */
function resultsByPath(
	condition: RuleCondition,
	trace: ConditionTraceEntry[],
): Map<string, boolean> {
	const results = new Map<string, boolean>();
	let cursor = 0;

	const walk = (node: RuleCondition, path: number[]): void => {
		if (isConditionGroup(node)) {
			for (const [index, child] of (node.children ?? []).entries()) {
				walk(child, [...path, index]);
			}
		}
		results.set(path.join("-"), trace[cursor]?.result ?? false);
		cursor += 1;
	};

	walk(condition, []);
	return results;
}

/** Human-readable operand of a leaf. */
function describeValue(value: RuleConditionValue | undefined): string {
	if (value === undefined) {
		return "";
	}
	if (Array.isArray(value)) {
		return value.map(String).join(", ");
	}
	return String(value);
}

export function describeLeaf(leaf: RuleConditionLeaf): string {
	const target = RULE_CONDITION_FIELD_LABELS[leaf.field];
	const comparator = RULE_COMPARATOR_LABELS[leaf.cmp];
	const operand = describeValue(leaf.value);
	if (leaf.cmp === "exists") {
		return `${target} ${leaf.value === false ? "is absent" : "is present"}`;
	}
	return operand.length > 0
		? `${target} ${comparator} "${operand}"`
		: `${target} ${comparator}`;
}

export interface ConditionTraceProps {
	condition: RuleCondition;
	trace: ConditionTraceEntry[];
}

/** Condition tree annotated with the result of each node (✓ / ✗). */
export function ConditionTrace({ condition, trace }: ConditionTraceProps) {
	const results = resultsByPath(condition, trace);

	return (
		<div data-testid="condition-trace" className="flex flex-col gap-1.5">
			<TraceNode node={condition} path={[]} results={results} depth={0} />
		</div>
	);
}

/** Indentation of one nesting level. */
const DEPTH_PADDING = ["", "pl-4", "pl-8", "pl-12"] as const;

function TraceNode({
	node,
	path,
	results,
	depth,
}: {
	node: RuleCondition;
	path: number[];
	results: Map<string, boolean>;
	depth: number;
}) {
	const result = results.get(path.join("-")) ?? false;
	const padding = DEPTH_PADDING[Math.min(depth, DEPTH_PADDING.length - 1)];

	if (isConditionGroup(node)) {
		const children = node.children ?? [];
		return (
			<div className={padding}>
				<p className="flex items-center gap-2 text-sm">
					<TraceMark result={result} />
					<Badge tone="outline">{RULE_CONDITION_OP_LABELS[node.op]}</Badge>
					{children.length === 0 ? (
						<span className="text-muted-foreground text-xs">
							empty group — always true
						</span>
					) : null}
				</p>
				<div className="mt-1.5 flex flex-col gap-1.5">
					{children.map((child, index) => (
						<TraceNode
							key={[...path, index].join("-")}
							node={child}
							path={[...path, index]}
							results={results}
							depth={depth + 1}
						/>
					))}
				</div>
			</div>
		);
	}

	return (
		<p className={`flex items-center gap-2 text-sm ${padding}`}>
			<TraceMark result={result} />
			<span className="min-w-0 truncate">{describeLeaf(node)}</span>
		</p>
	);
}

function TraceMark({ result }: { result: boolean }) {
	return (
		<span
			role="img"
			aria-label={result ? "matched" : "not matched"}
			className={
				result
					? "flex size-4 shrink-0 items-center justify-center rounded-full bg-tone-success text-tone-success-foreground"
					: "flex size-4 shrink-0 items-center justify-center rounded-full bg-tone-danger text-tone-danger-foreground"
			}
		>
			{result ? <CheckIcon className="size-3" /> : <XIcon className="size-3" />}
		</span>
	);
}
