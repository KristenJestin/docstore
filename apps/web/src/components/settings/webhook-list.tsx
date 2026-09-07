import type { Webhook, WebhookEvent } from "@docstore/shared/webhook";
import {
	WEBHOOK_EVENTS,
	WEBHOOK_SECRET_LENGTH,
} from "@docstore/shared/webhook";
import { Badge } from "@docstore/ui/components/badge";
import { Button } from "@docstore/ui/components/button";
import { Checkbox } from "@docstore/ui/components/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@docstore/ui/components/dialog";
import { Input } from "@docstore/ui/components/input";
import { Label } from "@docstore/ui/components/label";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
} from "@docstore/ui/components/sheet";
import { Skeleton } from "@docstore/ui/components/skeleton";
import { Switch } from "@docstore/ui/components/switch";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
	PencilIcon,
	PlusIcon,
	RefreshCwIcon,
	ScrollTextIcon,
	SendIcon,
	Trash2Icon,
	WebhookIcon,
} from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";

import { useConfirm } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { FormField, FormSection } from "@/components/form-field";
import { Pagination } from "@/components/pagination";
import { toastApiError } from "@/lib/api-error";
import { orpc } from "@/utils/orpc";

import { CopyButton } from "./copy-button";
import {
	DELIVERABLE_EVENT_LABELS,
	formatDateTime,
	statusTone,
	WEBHOOK_EVENT_LABELS,
} from "./settings-labels";
import { SettingsPanel, SettingsStack } from "./settings-panel";

/** Page size of the delivery journal dialog. */
const DELIVERY_PAGE_SIZE = 25;

/** Random signing secret, generated in the browser (hex, never sent in clear). */
function generateSecret(): string {
	const bytes = new Uint8Array(WEBHOOK_SECRET_LENGTH / 2);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
		"",
	);
}

/**
 * Outgoing webhooks (SPEC §2 "Divers"): subscriptions, `ping` test and the
 * delivery journal. The signing secret is readable so it can be copied into
 * the receiving service.
 */
export function WebhookList() {
	const confirm = useConfirm();
	const webhooks = useQuery(orpc.webhook.list.queryOptions({ input: {} }));

	const [creating, setCreating] = useState(false);
	const [editing, setEditing] = useState<Webhook | null>(null);
	const [deliveriesFor, setDeliveriesFor] = useState<Webhook | null>(null);

	const test = useMutation(orpc.webhook.test.mutationOptions());
	const update = useMutation(orpc.webhook.update.mutationOptions());
	const remove = useMutation(orpc.webhook.delete.mutationOptions());

	const onTest = async (webhook: Webhook) => {
		try {
			const result = await test.mutateAsync({ id: webhook.id });
			toast.success(
				result.queued
					? "Ping queued: the delivery journal shows the answer."
					: "The delivery queue is not available right now.",
			);
		} catch (error) {
			toastApiError(error, "The ping could not be sent.");
		}
	};

	const onToggle = async (webhook: Webhook, enabled: boolean) => {
		try {
			await update.mutateAsync({ id: webhook.id, enabled });
			toast.success(enabled ? "Webhook enabled." : "Webhook disabled.");
		} catch (error) {
			toastApiError(error, "The webhook could not be switched.");
		}
	};

	const onDelete = async (webhook: Webhook) => {
		const ok = await confirm({
			title: `Delete "${webhook.name}"?`,
			description: "The webhook and its delivery journal are removed.",
			confirmLabel: "Delete",
			destructive: true,
		});
		if (!ok) {
			return;
		}
		try {
			await remove.mutateAsync({ id: webhook.id });
			toast.success("Webhook deleted.");
		} catch (error) {
			toastApiError(error, "The webhook could not be deleted.");
		}
	};

	if (webhooks.isLoading) {
		return (
			<SettingsStack>
				<Skeleton className="h-64 w-full" />
			</SettingsStack>
		);
	}

	const items = webhooks.data ?? [];

	return (
		<SettingsStack>
			<SettingsPanel
				title="Webhooks"
				description="Every event is signed with HMAC-SHA256 and sent to your URL, with five retries."
				actions={
					<Button size="sm" onClick={() => setCreating(true)}>
						<PlusIcon />
						New webhook
					</Button>
				}
			>
				{items.length === 0 ? (
					<div className="p-3">
						<EmptyState
							icon={WebhookIcon}
							title="No webhook"
							description="Notify another service when a document arrives or a reminder falls due."
							size="sm"
							action={
								<Button variant="outline" onClick={() => setCreating(true)}>
									<PlusIcon />
									New webhook
								</Button>
							}
						/>
					</div>
				) : (
					<ul className="divide-y divide-border">
						{items.map((webhook) => (
							<li
								key={webhook.id}
								className="group/row flex flex-wrap items-center gap-3 px-4 py-3 transition-colors duration-200 ease-premium hover:bg-muted/70"
							>
								<Switch
									checked={webhook.enabled}
									aria-label={`Enable ${webhook.name}`}
									onCheckedChange={(enabled) => void onToggle(webhook, enabled)}
								/>

								<div className="min-w-0 flex-1">
									<p className="truncate font-medium text-sm">{webhook.name}</p>
									<p className="truncate font-mono text-muted-foreground text-xs">
										{webhook.url}
									</p>
								</div>

								<ul className="flex max-w-64 flex-wrap gap-1">
									{webhook.events.map((event) => (
										<li key={event}>
											<Badge tone="outline">{event}</Badge>
										</li>
									))}
								</ul>

								<div className="w-40 shrink-0 text-right">
									<Badge tone={statusTone(webhook.lastStatus)}>
										{webhook.lastStatus === null
											? "never called"
											: `HTTP ${webhook.lastStatus}`}
									</Badge>
									<p className="mt-0.5 font-mono text-muted-foreground text-xs tabular-nums">
										{formatDateTime(webhook.lastCalledAt)}
									</p>
								</div>

								<div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/row:opacity-100">
									<Button
										variant="ghost"
										size="icon-sm"
										aria-label={`Send a test ping to ${webhook.name}`}
										disabled={test.isPending}
										onClick={() => void onTest(webhook)}
									>
										<SendIcon />
									</Button>
									<Button
										variant="ghost"
										size="icon-sm"
										aria-label={`Deliveries of ${webhook.name}`}
										onClick={() => setDeliveriesFor(webhook)}
									>
										<ScrollTextIcon />
									</Button>
									<Button
										variant="ghost"
										size="icon-sm"
										aria-label={`Edit ${webhook.name}`}
										onClick={() => setEditing(webhook)}
									>
										<PencilIcon />
									</Button>
									<Button
										variant="ghost"
										size="icon-sm"
										aria-label={`Delete ${webhook.name}`}
										onClick={() => void onDelete(webhook)}
									>
										<Trash2Icon />
									</Button>
								</div>
							</li>
						))}
					</ul>
				)}
			</SettingsPanel>

			<WebhookSheet
				open={creating || editing !== null}
				webhook={editing ?? undefined}
				onOpenChange={(open) => {
					if (!open) {
						setCreating(false);
						setEditing(null);
					}
				}}
			/>

			<DeliveriesDialog
				webhook={deliveriesFor}
				onClose={() => setDeliveriesFor(null)}
			/>
		</SettingsStack>
	);
}

function WebhookSheet({
	open,
	webhook,
	onOpenChange,
}: {
	open: boolean;
	webhook?: Webhook;
	onOpenChange: (open: boolean) => void;
}) {
	const fieldId = useId();
	const isEdit = Boolean(webhook);

	const [name, setName] = useState("");
	const [url, setUrl] = useState("");
	const [events, setEvents] = useState<WebhookEvent[]>(["document.processed"]);
	const [secret, setSecret] = useState("");
	const [loadedFor, setLoadedFor] = useState<string | null>(null);

	const createWebhook = useMutation(orpc.webhook.create.mutationOptions());
	const updateWebhook = useMutation(orpc.webhook.update.mutationOptions());
	const pending = createWebhook.isPending || updateWebhook.isPending;

	const key = webhook?.id ?? "__new__";
	if (open && loadedFor !== key) {
		setLoadedFor(key);
		setName(webhook?.name ?? "");
		setUrl(webhook?.url ?? "");
		setEvents(webhook?.events ?? ["document.processed"]);
		setSecret(webhook?.secret ?? generateSecret());
	}
	if (!open && loadedFor !== null) {
		setLoadedFor(null);
	}

	const toggleEvent = (event: WebhookEvent) => {
		setEvents((current) =>
			current.includes(event)
				? current.filter((item) => item !== event)
				: [...current, event],
		);
	};

	const submit = async () => {
		const trimmedName = name.trim();
		const trimmedUrl = url.trim();
		if (trimmedName.length === 0 || trimmedUrl.length === 0) {
			return;
		}
		try {
			if (webhook) {
				await updateWebhook.mutateAsync({
					id: webhook.id,
					name: trimmedName,
					url: trimmedUrl,
					events,
					secret,
				});
				toast.success("Webhook updated.");
			} else {
				await createWebhook.mutateAsync({
					name: trimmedName,
					url: trimmedUrl,
					events,
					secret,
					enabled: true,
				});
				toast.success(`Webhook "${trimmedName}" created.`);
			}
			onOpenChange(false);
		} catch (error) {
			toastApiError(error, "The webhook could not be saved.");
		}
	};

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent side="right" className="w-full gap-0 sm:max-w-lg">
				<SheetHeader className="shrink-0 border-border border-b px-6 py-5">
					<SheetTitle>{isEdit ? "Edit webhook" : "New webhook"}</SheetTitle>
					<SheetDescription>
						The body is signed with the secret and sent in the
						`X-Docstore-Signature` header.
					</SheetDescription>
				</SheetHeader>

				<div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-6 py-6">
					<FormSection title="Endpoint">
						<FormField label="Name" htmlFor={`${fieldId}-name`} required>
							<Input
								id={`${fieldId}-name`}
								value={name}
								placeholder="Home automation"
								onChange={(event) => setName(event.target.value)}
							/>
						</FormField>

						<FormField label="URL" htmlFor={`${fieldId}-url`} required>
							<Input
								id={`${fieldId}-url`}
								type="url"
								value={url}
								placeholder="https://example.com/hooks/docstore"
								onChange={(event) => setUrl(event.target.value)}
								className="font-mono"
							/>
						</FormField>

						<FormField
							label="Signing secret"
							htmlFor={`${fieldId}-secret`}
							hint="Generated in your browser. Copy it into the receiving service."
						>
							<div className="flex items-center gap-1">
								<Input
									id={`${fieldId}-secret`}
									value={secret}
									onChange={(event) => setSecret(event.target.value)}
									className="font-mono"
								/>
								<CopyButton
									value={secret}
									label="Copy the signing secret"
									variant="outline"
								/>
								<Button
									type="button"
									variant="outline"
									size="icon-sm"
									aria-label="Generate a new secret"
									onClick={() => setSecret(generateSecret())}
								>
									<RefreshCwIcon />
								</Button>
							</div>
						</FormField>
					</FormSection>

					<fieldset className="flex flex-col gap-2">
						<legend className="mono-label mb-1">Events</legend>
						{WEBHOOK_EVENTS.map((event) => (
							<Label
								key={event}
								htmlFor={`${fieldId}-${event}`}
								className="flex items-center gap-3 font-normal"
							>
								<Checkbox
									id={`${fieldId}-${event}`}
									checked={events.includes(event)}
									onCheckedChange={() => toggleEvent(event)}
								/>
								<span className="min-w-0">
									<span className="block text-sm">
										{WEBHOOK_EVENT_LABELS[event]}
									</span>
									<span className="block font-mono text-muted-foreground text-xs">
										{event}
									</span>
								</span>
							</Label>
						))}
					</fieldset>
				</div>

				<SheetFooter className="shrink-0 flex-row justify-end border-border border-t px-6 py-4">
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button
						onClick={submit}
						disabled={
							pending ||
							name.trim().length === 0 ||
							url.trim().length === 0 ||
							events.length === 0
						}
					>
						{isEdit ? "Save" : "Create webhook"}
					</Button>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}

/** Paginated delivery journal: event, status, attempt, error and date. */
function DeliveriesDialog({
	webhook,
	onClose,
}: {
	webhook: Webhook | null;
	onClose: () => void;
}) {
	const [page, setPage] = useState(1);

	const deliveries = useQuery({
		...orpc.webhook.deliveries.queryOptions({
			input: { id: webhook?.id ?? "", page, pageSize: DELIVERY_PAGE_SIZE },
		}),
		enabled: webhook !== null,
	});

	return (
		<Dialog
			key={webhook?.id ?? "none"}
			open={webhook !== null}
			onOpenChange={(open) => {
				if (!open) {
					setPage(1);
					onClose();
				}
			}}
		>
			<DialogContent className="sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>Deliveries of {webhook?.name}</DialogTitle>
					<DialogDescription>
						One line per attempt, most recent first.
					</DialogDescription>
				</DialogHeader>

				{deliveries.isLoading ? (
					<Skeleton className="h-64 w-full" />
				) : (deliveries.data?.items.length ?? 0) === 0 ? (
					<EmptyState
						icon={ScrollTextIcon}
						title="No delivery"
						description="Send a test ping to check the endpoint."
						size="sm"
					/>
				) : (
					<ul className="max-h-96 divide-y divide-border overflow-y-auto rounded-lg ring-1 ring-border">
						{deliveries.data?.items.map((delivery) => (
							<li
								key={delivery.id}
								className="flex items-center gap-3 px-3 py-2"
							>
								<Badge tone={statusTone(delivery.statusCode)}>
									{delivery.statusCode === null
										? "no answer"
										: `HTTP ${delivery.statusCode}`}
								</Badge>
								<div className="min-w-0 flex-1">
									<p className="truncate text-sm">
										{DELIVERABLE_EVENT_LABELS[delivery.event]}
									</p>
									{delivery.error ? (
										<p className="truncate text-tone-danger-foreground text-xs">
											{delivery.error}
										</p>
									) : null}
								</div>
								<span className="shrink-0 font-mono text-muted-foreground text-xs tabular-nums">
									try {delivery.attempt}
								</span>
								<span className="shrink-0 font-mono text-muted-foreground text-xs tabular-nums">
									{formatDateTime(delivery.createdAt)}
								</span>
							</li>
						))}
					</ul>
				)}

				{deliveries.data && deliveries.data.total > 0 ? (
					<Pagination
						page={deliveries.data.page}
						pageSize={deliveries.data.pageSize}
						total={deliveries.data.total}
						totalPages={deliveries.data.totalPages}
						onPageChange={setPage}
						itemLabel="delivery"
						itemLabelPlural="deliveries"
						className="rounded-lg ring-1 ring-border"
					/>
				) : null}

				<DialogFooter>
					<Button variant="outline" onClick={onClose}>
						Close
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
