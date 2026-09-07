import type { IntakeDefaults } from "@docstore/shared/intake";
import { Switch } from "@docstore/ui/components/switch";
import { useId } from "react";

import { CategoryPicker } from "@/components/documents/category-picker";
import { TagInput } from "@/components/documents/tag-input";
import { FormField, FormSection } from "@/components/form-field";
import { PartyPicker } from "@/components/parties/party-picker";

export interface IntakeDefaultsFieldsProps {
	value: IntakeDefaults;
	onValueChange: (defaults: IntakeDefaults) => void;
	description?: string;
}

/**
 * Values applied to every document arriving through a channel (intake source
 * or public upload link): category, tags, party and sensitivity.
 */
export function IntakeDefaultsFields({
	value,
	onValueChange,
	description = "Applied to every document that arrives through this channel.",
}: IntakeDefaultsFieldsProps) {
	const fieldId = useId();
	const patch = (next: Partial<IntakeDefaults>) =>
		onValueChange({ ...value, ...next });

	return (
		<FormSection title="Defaults" description={description}>
			<FormField label="Category" htmlFor={`${fieldId}-category`}>
				<CategoryPicker
					id={`${fieldId}-category`}
					value={value.categoryId ?? null}
					onValueChange={(categoryId) => patch({ categoryId })}
					placeholder="No category"
				/>
			</FormField>

			<FormField label="Tags" htmlFor={`${fieldId}-tags`}>
				<TagInput
					id={`${fieldId}-tags`}
					value={value.tagIds ?? []}
					onValueChange={(tagIds) => patch({ tagIds })}
				/>
			</FormField>

			<FormField label="Party" htmlFor={`${fieldId}-party`}>
				<PartyPicker
					id={`${fieldId}-party`}
					value={value.partyId ?? null}
					onValueChange={(partyId) => patch({ partyId })}
				/>
			</FormField>

			<div className="flex items-center justify-between gap-4">
				<div>
					<label htmlFor={`${fieldId}-sensitive`} className="text-sm">
						Sensitive
					</label>
					<p className="text-muted-foreground text-xs">
						Documents arrive flagged as sensitive.
					</p>
				</div>
				<Switch
					id={`${fieldId}-sensitive`}
					checked={value.sensitive ?? false}
					onCheckedChange={(sensitive) => patch({ sensitive })}
				/>
			</div>
		</FormSection>
	);
}
