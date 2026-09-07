import type { PostprocessStep } from "@docstore/shared/extraction";
import { SIMPLE_POSTPROCESS_STEPS } from "@docstore/shared/extraction";
import { Badge } from "@docstore/ui/components/badge";
import { Button } from "@docstore/ui/components/button";
import { Input } from "@docstore/ui/components/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
} from "@docstore/ui/components/select";
import {
	ChevronDownIcon,
	ChevronUpIcon,
	PlusIcon,
	Trash2Icon,
} from "lucide-react";
import { useId } from "react";

import { FormField } from "@/components/form-field";

import {
	POSTPROCESS_STEP_LABELS,
	REGEX_REPLACE_LABEL,
	regexError,
} from "./rule-labels";

const REGEX_REPLACE = "regex_replace";

const STEP_LABELS: Record<string, string> = {
	...POSTPROCESS_STEP_LABELS,
	[REGEX_REPLACE]: REGEX_REPLACE_LABEL,
};

function isRegexReplace(
	step: PostprocessStep,
): step is Extract<PostprocessStep, { regex_replace: unknown }> {
	return typeof step === "object";
}

function stepLabel(step: PostprocessStep): string {
	return isRegexReplace(step) ? REGEX_REPLACE_LABEL : STEP_LABELS[step];
}

export interface PostprocessEditorProps {
	value: PostprocessStep[];
	onChange: (steps: PostprocessStep[]) => void;
}

/**
 * Chain of post-processing steps applied to the raw extracted value (SPEC §4).
 * Each step feeds the next one; the first failure empties the value.
 */
export function PostprocessEditor({ value, onChange }: PostprocessEditorProps) {
	const ids = useId();

	const move = (index: number, direction: -1 | 1) => {
		const target = index + direction;
		if (target < 0 || target >= value.length) {
			return;
		}
		const next = [...value];
		const [moved] = next.splice(index, 1);
		if (!moved) {
			return;
		}
		next.splice(target, 0, moved);
		onChange(next);
	};

	return (
		<div className="flex flex-col gap-2">
			{value.length === 0 ? (
				<p className="text-muted-foreground text-xs">
					No post-processing: the raw text is used as is.
				</p>
			) : (
				<ul className="flex flex-col gap-2">
					{value.map((step, index) => (
						<li
							key={`${stepLabel(step)}-${index}`}
							className="flex items-start gap-2 rounded-lg bg-muted/40 p-2.5 ring-1 ring-border"
						>
							<div className="flex shrink-0 flex-col">
								<Button
									variant="ghost"
									size="icon-sm"
									className="h-4"
									disabled={index === 0}
									aria-label={`Move step ${index + 1} up`}
									onClick={() => move(index, -1)}
								>
									<ChevronUpIcon />
								</Button>
								<Button
									variant="ghost"
									size="icon-sm"
									className="h-4"
									disabled={index === value.length - 1}
									aria-label={`Move step ${index + 1} down`}
									onClick={() => move(index, 1)}
								>
									<ChevronDownIcon />
								</Button>
							</div>

							<div className="flex min-w-0 flex-1 flex-col gap-2">
								<div className="flex items-center gap-2">
									<Badge tone="outline">{index + 1}</Badge>
									<p className="min-w-0 flex-1 truncate text-sm">
										{stepLabel(step)}
									</p>
									<Button
										variant="ghost"
										size="icon-sm"
										aria-label={`Remove the step ${stepLabel(step)}`}
										onClick={() =>
											onChange(
												value.filter((_, position) => position !== index),
											)
										}
									>
										<Trash2Icon />
									</Button>
								</div>

								{isRegexReplace(step) ? (
									<RegexReplaceFields
										ids={`${ids}-${index}`}
										step={step}
										onChange={(next) =>
											onChange(
												value.map((item, position) =>
													position === index ? next : item,
												),
											)
										}
									/>
								) : null}
							</div>
						</li>
					))}
				</ul>
			)}

			<Select
				items={STEP_LABELS}
				value=""
				onValueChange={(next) => {
					if (!next) {
						return;
					}
					onChange([
						...value,
						next === REGEX_REPLACE
							? { regex_replace: { pattern: "", replacement: "" } }
							: (next as PostprocessStep),
					]);
				}}
			>
				<SelectTrigger
					className="w-full"
					aria-label="Add a post-processing step"
				>
					<span className="flex items-center gap-2 text-muted-foreground">
						<PlusIcon className="size-4" />
						Add a step
					</span>
				</SelectTrigger>
				<SelectContent>
					{SIMPLE_POSTPROCESS_STEPS.map((step) => (
						<SelectItem key={step} value={step}>
							{POSTPROCESS_STEP_LABELS[step]}
						</SelectItem>
					))}
					<SelectItem value={REGEX_REPLACE}>{REGEX_REPLACE_LABEL}</SelectItem>
				</SelectContent>
			</Select>
		</div>
	);
}

function RegexReplaceFields({
	ids,
	step,
	onChange,
}: {
	ids: string;
	step: Extract<PostprocessStep, { regex_replace: unknown }>;
	onChange: (step: PostprocessStep) => void;
}) {
	const config = step.regex_replace;
	const error = regexError(config.pattern, config.flags ?? "g");

	const patch = (next: Partial<typeof config>) =>
		onChange({ regex_replace: { ...config, ...next } });

	return (
		<div className="grid gap-3 sm:grid-cols-3">
			<FormField
				label="Pattern"
				htmlFor={`${ids}-pattern`}
				errors={error ? [error] : undefined}
			>
				<Input
					id={`${ids}-pattern`}
					value={config.pattern}
					className="font-mono"
					onChange={(event) => patch({ pattern: event.target.value })}
				/>
			</FormField>
			<FormField label="Replacement" htmlFor={`${ids}-replacement`}>
				<Input
					id={`${ids}-replacement`}
					value={config.replacement}
					className="font-mono"
					onChange={(event) => patch({ replacement: event.target.value })}
				/>
			</FormField>
			<FormField label="Flags" htmlFor={`${ids}-flags`}>
				<Input
					id={`${ids}-flags`}
					value={config.flags ?? ""}
					maxLength={8}
					placeholder="g"
					className="font-mono"
					onChange={(event) =>
						patch({
							flags:
								event.target.value.replace(/[^dgimsuvy]/g, "") || undefined,
						})
					}
				/>
			</FormField>
		</div>
	);
}
