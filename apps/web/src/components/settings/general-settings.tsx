import type { SettingKey, Settings } from "@docstore/shared/settings";
import { Skeleton } from "@docstore/ui/components/skeleton";
import {
	Slider,
	SliderControl,
	SliderIndicator,
	SliderThumb,
	SliderTrack,
} from "@docstore/ui/components/slider";
import { Switch } from "@docstore/ui/components/switch";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";

import { ChipsInput } from "@/components/chips-input";
import { toastApiError } from "@/lib/api-error";
import { orpc } from "@/utils/orpc";

import { CopyButton } from "./copy-button";
import { SettingsPanel, SettingsRow, SettingsStack } from "./settings-panel";

/** Step of the confidence slider: 5 points of a 0 → 1 scale. */
const THRESHOLD_STEP = 0.05;

/** Highest lead time accepted by `expiryLeadDaysSchema`. */
const MAX_LEAD_DAYS = 3650;

/** English wording of each key, used by the "saved" toast. */
const SETTING_LABELS: Record<SettingKey, string> = {
	"review.confidenceThreshold": "Confidence threshold",
	"review.requireCategory": "Category required",
	"review.requireIssuer": "Issuer required",
	"reminders.expiryLeadDays": "Expiry reminders",
};

/**
 * Household-wide settings (`settings.get` / `settings.set`). Each control
 * saves on its own as soon as it is released: there is no form to submit.
 */
export function GeneralSettings() {
	const queryClient = useQueryClient();
	const fieldId = useId();
	const settings = useQuery(orpc.settings.get.queryOptions({ input: {} }));
	const setSetting = useMutation(orpc.settings.set.mutationOptions());

	const [threshold, setThreshold] = useState<number | null>(null);

	// The slider is driven locally while dragging, then realigned on the server
	// value once it comes back.
	useEffect(() => {
		if (settings.data) {
			setThreshold(settings.data["review.confidenceThreshold"]);
		}
	}, [settings.data]);

	const save = async (key: SettingKey, value: unknown) => {
		try {
			const next = await setSetting.mutateAsync({ key, value });
			queryClient.setQueryData(
				orpc.settings.get.queryKey({ input: {} }),
				next satisfies Settings,
			);
			toast.success(`${SETTING_LABELS[key]} saved.`);
		} catch (error) {
			await queryClient.invalidateQueries({ queryKey: orpc.settings.key() });
			toastApiError(error, `${SETTING_LABELS[key]} could not be saved.`);
		}
	};

	if (settings.isLoading || !settings.data) {
		return (
			<SettingsStack>
				<Skeleton className="h-48 w-full" />
			</SettingsStack>
		);
	}

	const data = settings.data;
	const leadDays = data["reminders.expiryLeadDays"];

	const saveLeadDays = (values: string[]) => {
		const parsed: number[] = [];
		for (const value of values) {
			const day = Number.parseInt(value, 10);
			if (!Number.isInteger(day) || day < 0 || day > MAX_LEAD_DAYS) {
				toast.error(
					`"${value}" is not a valid lead time: use whole days between 0 and ${MAX_LEAD_DAYS}.`,
				);
				return;
			}
			parsed.push(day);
		}
		if (parsed.length === 0) {
			toast.error("Keep at least one expiry reminder.");
			return;
		}
		void save("reminders.expiryLeadDays", parsed);
	};

	return (
		<SettingsStack>
			<SettingsPanel
				title="Review queue"
				description="What sends a document to the review queue instead of making it active straight away."
			>
				<div className="divide-y divide-border">
					<SettingsRow
						label="Confidence threshold"
						description="An automatically extracted value below this score has to be checked."
						control={
							<div className="flex w-56 items-center gap-3">
								<Slider
									value={threshold ?? data["review.confidenceThreshold"]}
									min={0}
									max={1}
									step={THRESHOLD_STEP}
									onValueChange={(value) => setThreshold(value as number)}
									onValueCommitted={(value) =>
										void save("review.confidenceThreshold", value as number)
									}
									aria-label="Confidence threshold"
								>
									<SliderControl>
										<SliderTrack>
											<SliderIndicator />
											<SliderThumb />
										</SliderTrack>
									</SliderControl>
								</Slider>
								<span className="w-10 shrink-0 text-right font-mono text-sm tabular-nums">
									{(threshold ?? data["review.confidenceThreshold"]).toFixed(2)}
								</span>
							</div>
						}
					/>

					<SettingsRow
						label="Category required"
						htmlFor={`${fieldId}-category`}
						description="A document without a category stays in the review queue."
						control={
							<Switch
								id={`${fieldId}-category`}
								checked={data["review.requireCategory"]}
								onCheckedChange={(checked) =>
									void save("review.requireCategory", checked)
								}
							/>
						}
					/>

					<SettingsRow
						label="Issuer required"
						htmlFor={`${fieldId}-issuer`}
						description="A document without an issuing party stays in the review queue."
						control={
							<Switch
								id={`${fieldId}-issuer`}
								checked={data["review.requireIssuer"]}
								onCheckedChange={(checked) =>
									void save("review.requireIssuer", checked)
								}
							/>
						}
					/>
				</div>
			</SettingsPanel>

			<SettingsPanel
				title="Expiry reminders"
				description="Days of notice counted back from the expiry date of a document. Type a number then press Enter."
			>
				<div className="px-4 py-4">
					<ChipsInput
						id={`${fieldId}-lead-days`}
						className="max-w-md"
						values={leadDays.map(String)}
						onValuesChange={saveLeadDays}
						placeholder="90, then Enter"
					/>
				</div>
			</SettingsPanel>

			<ServerInfoPanel />
		</SettingsStack>
	);
}

/**
 * Read-only identity card of the server (`settings.serverInfo`): the two
 * origins — they differ in the split-port development setup — the version and
 * where `docstore.config.json` is looked for.
 */
function ServerInfoPanel() {
	const info = useQuery(orpc.settings.serverInfo.queryOptions({ input: {} }));

	return (
		<SettingsPanel
			title="Server"
			description="Where this installation answers from, and the file it reads its managed configuration from."
		>
			{info.isLoading || !info.data ? (
				<div className="px-4 py-4">
					<Skeleton className="h-32 w-full" />
				</div>
			) : (
				<div className="divide-y divide-border">
					<SettingsRow
						label="Public web URL"
						description="Origin handed out in share and upload links."
						control={
							<>
								<code className="min-w-0 max-w-md truncate font-mono text-sm">
									{info.data.publicUrl}
								</code>
								<CopyButton
									value={info.data.publicUrl}
									label="Copy the public web URL"
								/>
							</>
						}
					/>
					<SettingsRow
						label="API URL"
						description="Base of the /rpc and /mcp endpoints."
						control={
							<>
								<code className="min-w-0 max-w-md truncate font-mono text-sm">
									{info.data.apiUrl}
								</code>
								<CopyButton value={info.data.apiUrl} label="Copy the API URL" />
							</>
						}
					/>
					<SettingsRow
						label="Version"
						control={
							<span className="font-mono text-sm tabular-nums">
								{info.data.version}
							</span>
						}
					/>
					<SettingsRow
						label="Configuration file"
						description="Read at start-up, whether or not the file exists."
						control={
							<>
								<code className="min-w-0 max-w-md truncate font-mono text-sm">
									{info.data.configPath}
								</code>
								<CopyButton
									value={info.data.configPath}
									label="Copy the configuration file path"
								/>
							</>
						}
					/>
				</div>
			)}
		</SettingsPanel>
	);
}
