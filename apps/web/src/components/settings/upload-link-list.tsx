import type { IntakeDefaults } from "@docstore/shared/intake";
import type { UploadLink } from "@docstore/shared/upload-link";
import { Badge } from "@docstore/ui/components/badge";
import { Button } from "@docstore/ui/components/button";
import { Input } from "@docstore/ui/components/input";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
} from "@docstore/ui/components/sheet";
import { Skeleton } from "@docstore/ui/components/skeleton";
import { Textarea } from "@docstore/ui/components/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	BanIcon,
	LinkIcon,
	PencilIcon,
	PlusIcon,
	Trash2Icon,
} from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";

import { useConfirm } from "@/components/confirm-dialog";
import { DatePicker } from "@/components/date-picker";
import { EmptyState } from "@/components/empty-state";
import { FormField, FormSection } from "@/components/form-field";
import { toastApiError } from "@/lib/api-error";
import { plural } from "@/lib/plural";
import { publicUploadPageUrl } from "@/lib/upload-link-url";
import { orpc } from "@/utils/orpc";
import { CopyButton } from "./copy-button";
import { IntakeDefaultsFields } from "./intake-defaults-fields";
import { formatDateTime } from "./settings-labels";
import { SettingsPanel, SettingsStack } from "./settings-panel";

/**
 * Public upload links (SPEC §2 "Divers"): a URL without authentication where a
 * third party drops files, with an expiry date and a usage quota.
 */
export function UploadLinkList() {
	const queryClient = useQueryClient();
	const confirm = useConfirm();
	const links = useQuery(orpc.uploadLink.list.queryOptions({ input: {} }));

	const [creating, setCreating] = useState(false);
	const [editing, setEditing] = useState<UploadLink | null>(null);

	const disable = useMutation(orpc.uploadLink.disable.mutationOptions());
	const remove = useMutation(orpc.uploadLink.delete.mutationOptions());

	const invalidate = async () => {
		await queryClient.invalidateQueries({ queryKey: orpc.uploadLink.key() });
	};

	const onDisable = async (link: UploadLink) => {
		try {
			await disable.mutateAsync({ id: link.id });
			await invalidate();
			toast.success("Link disabled.");
		} catch (error) {
			toastApiError(error, "The link could not be disabled.");
		}
	};

	const onDelete = async (link: UploadLink) => {
		const ok = await confirm({
			title: `Delete "${link.name}"?`,
			description: "The URL stops working immediately.",
			confirmLabel: "Delete",
			destructive: true,
		});
		if (!ok) {
			return;
		}
		try {
			await remove.mutateAsync({ id: link.id });
			await invalidate();
			toast.success("Link deleted.");
		} catch (error) {
			toastApiError(error, "The link could not be deleted.");
		}
	};

	if (links.isLoading) {
		return (
			<SettingsStack>
				<Skeleton className="h-64 w-full" />
			</SettingsStack>
		);
	}

	const items = links.data ?? [];

	return (
		<SettingsStack>
			<SettingsPanel
				title="Upload links"
				description="Let someone drop documents into the library without an account."
				actions={
					<Button size="sm" onClick={() => setCreating(true)}>
						<PlusIcon />
						New link
					</Button>
				}
			>
				{items.length === 0 ? (
					<div className="p-3">
						<EmptyState
							icon={LinkIcon}
							title="No upload link"
							description="Create a link to collect documents from an accountant, a relative or a supplier."
							size="sm"
							action={
								<Button variant="outline" onClick={() => setCreating(true)}>
									<PlusIcon />
									New link
								</Button>
							}
						/>
					</div>
				) : (
					<ul className="divide-y divide-border">
						{items.map((link) => (
							<li
								key={link.id}
								className="group/row flex flex-wrap items-center gap-3 px-4 py-3 transition-colors duration-200 ease-premium hover:bg-muted/70"
							>
								<div className="min-w-0 flex-1">
									<p className="truncate font-medium text-sm">{link.name}</p>
									<p
										data-testid="upload-link-url"
										className="truncate font-mono text-muted-foreground text-xs"
									>
										{publicUploadPageUrl(link)}
									</p>
								</div>

								<CopyButton
									value={publicUploadPageUrl(link)}
									label={`Copy the URL of ${link.name}`}
									variant="outline"
								/>

								<div className="w-40 shrink-0 text-right">
									<p className="font-mono text-muted-foreground text-xs tabular-nums">
										{link.uses}
										{link.maxUses === null ? "" : ` / ${link.maxUses}`}{" "}
										{plural(link.uses, "use")}
									</p>
									<p className="font-mono text-muted-foreground text-xs tabular-nums">
										{link.expiresAt
											? `expires ${formatDateTime(link.expiresAt)}`
											: "no expiry"}
									</p>
								</div>

								{link.enabled ? (
									<Badge tone="success">Enabled</Badge>
								) : (
									<Badge tone="neutral">Disabled</Badge>
								)}

								<div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/row:opacity-100">
									{link.enabled ? (
										<Button
											variant="ghost"
											size="icon-sm"
											aria-label={`Disable ${link.name}`}
											onClick={() => void onDisable(link)}
										>
											<BanIcon />
										</Button>
									) : null}
									<Button
										variant="ghost"
										size="icon-sm"
										aria-label={`Edit ${link.name}`}
										onClick={() => setEditing(link)}
									>
										<PencilIcon />
									</Button>
									<Button
										variant="ghost"
										size="icon-sm"
										aria-label={`Delete ${link.name}`}
										onClick={() => void onDelete(link)}
									>
										<Trash2Icon />
									</Button>
								</div>
							</li>
						))}
					</ul>
				)}
			</SettingsPanel>

			<UploadLinkSheet
				open={creating || editing !== null}
				link={editing ?? undefined}
				onOpenChange={(open) => {
					if (!open) {
						setCreating(false);
						setEditing(null);
					}
				}}
				onSaved={invalidate}
			/>
		</SettingsStack>
	);
}

/** ISO instant → "YYYY-MM-DD", the shape `DatePicker` works with. */
function toDateInput(value: Date | null): string | null {
	if (!value) {
		return null;
	}
	return value.toISOString().slice(0, 10);
}

function UploadLinkSheet({
	open,
	link,
	onOpenChange,
	onSaved,
}: {
	open: boolean;
	link?: UploadLink;
	onOpenChange: (open: boolean) => void;
	onSaved: () => Promise<void>;
}) {
	const fieldId = useId();
	const isEdit = Boolean(link);

	const [name, setName] = useState("");
	const [message, setMessage] = useState("");
	const [expiresAt, setExpiresAt] = useState<string | null>(null);
	const [maxUses, setMaxUses] = useState("");
	const [defaults, setDefaults] = useState<IntakeDefaults>({});
	const [loadedFor, setLoadedFor] = useState<string | null>(null);

	const createLink = useMutation(orpc.uploadLink.create.mutationOptions());
	const updateLink = useMutation(orpc.uploadLink.update.mutationOptions());
	const pending = createLink.isPending || updateLink.isPending;

	const key = link?.id ?? "__new__";
	if (open && loadedFor !== key) {
		setLoadedFor(key);
		setName(link?.name ?? "");
		setMessage(link?.message ?? "");
		setExpiresAt(toDateInput(link?.expiresAt ?? null));
		setMaxUses(link?.maxUses ? String(link.maxUses) : "");
		setDefaults(link?.defaults ?? {});
	}
	if (!open && loadedFor !== null) {
		setLoadedFor(null);
	}

	const submit = async () => {
		const trimmed = name.trim();
		if (trimmed.length === 0) {
			return;
		}
		const payload = {
			name: trimmed,
			message: message.trim().length > 0 ? message.trim() : null,
			expiresAt: expiresAt
				? new Date(`${expiresAt}T23:59:59Z`).toISOString()
				: null,
			maxUses: maxUses.trim().length > 0 ? Number(maxUses) : null,
			defaults,
		};
		try {
			if (link) {
				await updateLink.mutateAsync({ id: link.id, ...payload });
				toast.success("Upload link updated.");
			} else {
				await createLink.mutateAsync({ ...payload, enabled: true });
				toast.success(`Upload link "${trimmed}" created.`);
			}
			await onSaved();
			onOpenChange(false);
		} catch (error) {
			toastApiError(error, "The link could not be saved.");
		}
	};

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent side="right" className="w-full gap-0 sm:max-w-lg">
				<SheetHeader className="shrink-0 border-border border-b px-6 py-5">
					<SheetTitle>
						{isEdit ? "Edit upload link" : "New upload link"}
					</SheetTitle>
					<SheetDescription>
						Anyone holding the URL can drop files until it expires or runs out
						of uses.
					</SheetDescription>
				</SheetHeader>

				<div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-6 py-6">
					<FormSection title="Link">
						<FormField label="Name" htmlFor={`${fieldId}-name`} required>
							<Input
								id={`${fieldId}-name`}
								value={name}
								placeholder="Documents from the accountant"
								onChange={(event) => setName(event.target.value)}
							/>
						</FormField>

						<FormField
							label="Message"
							htmlFor={`${fieldId}-message`}
							hint="Shown on the public page above the drop zone."
						>
							<Textarea
								id={`${fieldId}-message`}
								value={message}
								onChange={(event) => setMessage(event.target.value)}
							/>
						</FormField>

						<div className="grid grid-cols-2 gap-3">
							<FormField
								label="Expiry"
								htmlFor={`${fieldId}-expires`}
								hint="Empty = never expires."
							>
								<DatePicker
									id={`${fieldId}-expires`}
									label="Expiry"
									value={expiresAt}
									onValueChange={setExpiresAt}
								/>
							</FormField>
							<FormField
								label="Maximum uses"
								htmlFor={`${fieldId}-max-uses`}
								hint="Empty = unlimited."
							>
								<Input
									id={`${fieldId}-max-uses`}
									type="number"
									min={1}
									value={maxUses}
									onChange={(event) => setMaxUses(event.target.value)}
									className="font-mono"
								/>
							</FormField>
						</div>
					</FormSection>

					<IntakeDefaultsFields
						value={defaults}
						onValueChange={setDefaults}
						description="Applied to every document dropped through this link."
					/>
				</div>

				<SheetFooter className="shrink-0 flex-row justify-end border-border border-t px-6 py-4">
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button
						onClick={submit}
						disabled={pending || name.trim().length === 0}
					>
						{isEdit ? "Save" : "Create link"}
					</Button>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}
