import type { ApiKey, ApiKeyScope } from "@docstore/shared/api-key";
import { API_KEY_SCOPES } from "@docstore/shared/api-key";
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
import { Skeleton } from "@docstore/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	BanIcon,
	KeyRoundIcon,
	PlusIcon,
	Trash2Icon,
	TriangleAlertIcon,
} from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";

import { useConfirm } from "@/components/confirm-dialog";
import { DatePicker } from "@/components/date-picker";
import { EmptyState } from "@/components/empty-state";
import { FormField } from "@/components/form-field";
import { MonoLabel } from "@/components/mono-label";
import { toastApiError } from "@/lib/api-error";
import { orpc } from "@/utils/orpc";

import { CopyButton } from "./copy-button";
import {
	API_KEY_SCOPE_HINTS,
	API_KEY_SCOPE_LABELS,
	formatDateTime,
} from "./settings-labels";
import { SettingsPanel, SettingsStack } from "./settings-panel";

/**
 * Command shown in the "Connect an MCP client" box. The origin is the one the
 * **server** reports (`settings.serverInfo().apiUrl`): it is the only side that
 * knows the URL a client can reach behind the reverse proxy.
 */
function mcpCommand(apiUrl: string, secret: string): string {
	const origin = apiUrl.replace(/\/+$/, "");
	return `claude mcp add --transport http docstore ${origin}/mcp --header "Authorization: Bearer ${secret}"`;
}

/**
 * API keys (SPEC §6): the plain secret is only ever returned by `create`, so
 * it is shown once in a dialog with a copy button and a warning.
 */
export function ApiKeyList() {
	const queryClient = useQueryClient();
	const confirm = useConfirm();
	const keys = useQuery(orpc.apiKey.list.queryOptions({ input: {} }));
	const serverInfo = useQuery(
		orpc.settings.serverInfo.queryOptions({ input: {} }),
	);
	const apiUrl = serverInfo.data?.apiUrl ?? "";

	const [creating, setCreating] = useState(false);
	const [secret, setSecret] = useState<{ name: string; value: string } | null>(
		null,
	);

	const revoke = useMutation(orpc.apiKey.revoke.mutationOptions());
	const remove = useMutation(orpc.apiKey.delete.mutationOptions());

	const invalidate = async () => {
		await queryClient.invalidateQueries({ queryKey: orpc.apiKey.key() });
	};

	const onRevoke = async (key: ApiKey) => {
		const ok = await confirm({
			title: `Revoke "${key.name}"?`,
			description: "Any client using this key stops being authenticated.",
			confirmLabel: "Revoke",
			destructive: true,
		});
		if (!ok) {
			return;
		}
		try {
			await revoke.mutateAsync({ id: key.id });
			await invalidate();
			toast.success("API key revoked.");
		} catch (error) {
			toastApiError(error, "The key could not be revoked.");
		}
	};

	const onDelete = async (key: ApiKey) => {
		const ok = await confirm({
			title: `Delete "${key.name}"?`,
			description: "The key disappears from the list for good.",
			confirmLabel: "Delete",
			destructive: true,
		});
		if (!ok) {
			return;
		}
		try {
			await remove.mutateAsync({ id: key.id });
			await invalidate();
			toast.success("API key deleted.");
		} catch (error) {
			toastApiError(error, "The key could not be deleted.");
		}
	};

	if (keys.isLoading) {
		return (
			<SettingsStack>
				<Skeleton className="h-64 w-full" />
			</SettingsStack>
		);
	}

	const items = keys.data ?? [];

	return (
		<SettingsStack>
			<SettingsPanel
				title="API keys"
				description="Authenticate scripts and MCP agents without a session cookie."
				actions={
					<Button size="sm" onClick={() => setCreating(true)}>
						<PlusIcon />
						New key
					</Button>
				}
			>
				{items.length === 0 ? (
					<div className="p-3">
						<EmptyState
							icon={KeyRoundIcon}
							title="No API key"
							description="Create a key to let an MCP client or a script reach the library."
							size="sm"
							action={
								<Button variant="outline" onClick={() => setCreating(true)}>
									<PlusIcon />
									New key
								</Button>
							}
						/>
					</div>
				) : (
					<ul className="divide-y divide-border">
						{items.map((key) => (
							<li
								key={key.id}
								className="group/row flex flex-wrap items-center gap-3 px-4 py-3 transition-colors duration-200 ease-premium hover:bg-muted/70"
							>
								<div className="min-w-0 flex-1">
									<p className="truncate font-medium text-sm">{key.name}</p>
									<p className="truncate font-mono text-muted-foreground text-xs">
										{key.prefix}…
									</p>
								</div>

								<ul className="flex flex-wrap gap-1">
									{key.scopes.map((scope) => (
										<li key={scope}>
											<Badge tone="neutral">{scope}</Badge>
										</li>
									))}
								</ul>

								<div className="w-40 shrink-0 text-right">
									<p className="font-mono text-muted-foreground text-xs tabular-nums">
										{key.lastUsedAt
											? `used ${formatDateTime(key.lastUsedAt)}`
											: "never used"}
									</p>
									<p className="font-mono text-muted-foreground text-xs tabular-nums">
										{key.expiresAt
											? `expires ${formatDateTime(key.expiresAt)}`
											: "no expiry"}
									</p>
								</div>

								{key.revokedAt ? <Badge tone="danger">Revoked</Badge> : null}

								<div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/row:opacity-100">
									{key.revokedAt ? null : (
										<Button
											variant="ghost"
											size="icon-sm"
											aria-label={`Revoke ${key.name}`}
											onClick={() => void onRevoke(key)}
										>
											<BanIcon />
										</Button>
									)}
									<Button
										variant="ghost"
										size="icon-sm"
										aria-label={`Delete ${key.name}`}
										onClick={() => void onDelete(key)}
									>
										<Trash2Icon />
									</Button>
								</div>
							</li>
						))}
					</ul>
				)}
			</SettingsPanel>

			<SettingsPanel
				title="Connect an MCP client"
				description="Register docstore with Claude Code, replacing the placeholder with one of your keys."
			>
				<div className="px-4 py-4">
					{serverInfo.isLoading ? (
						<Skeleton className="h-14 w-full" />
					) : (
						<div className="flex items-start gap-2 rounded-lg bg-muted/50 p-3 ring-1 ring-border">
							<code className="min-w-0 flex-1 whitespace-pre-wrap break-all font-mono text-xs">
								{mcpCommand(apiUrl, "<key>")}
							</code>
							<CopyButton
								value={mcpCommand(apiUrl, "<key>")}
								label="Copy the MCP command"
							/>
						</div>
					)}
				</div>
			</SettingsPanel>

			<CreateApiKeyDialog
				open={creating}
				onOpenChange={setCreating}
				onCreated={async (name, value) => {
					await invalidate();
					setSecret({ name, value });
				}}
			/>
			<SecretDialog
				secret={secret}
				apiUrl={apiUrl}
				onClose={() => setSecret(null)}
			/>
		</SettingsStack>
	);
}

function CreateApiKeyDialog({
	open,
	onOpenChange,
	onCreated,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onCreated: (name: string, secret: string) => Promise<void>;
}) {
	const fieldId = useId();
	const [name, setName] = useState("");
	const [scopes, setScopes] = useState<ApiKeyScope[]>(["read"]);
	const [expiresAt, setExpiresAt] = useState<string | null>(null);

	const createKey = useMutation(orpc.apiKey.create.mutationOptions());

	const toggle = (scope: ApiKeyScope) => {
		setScopes((current) =>
			current.includes(scope)
				? current.filter((item) => item !== scope)
				: [...current, scope],
		);
	};

	const submit = async () => {
		const trimmed = name.trim();
		if (trimmed.length === 0 || scopes.length === 0) {
			return;
		}
		try {
			const result = await createKey.mutateAsync({
				name: trimmed,
				scopes,
				// The picker yields "YYYY-MM-DD": the API wants a full ISO instant.
				expiresAt: expiresAt
					? new Date(`${expiresAt}T23:59:59Z`).toISOString()
					: null,
			});
			onOpenChange(false);
			setName("");
			setScopes(["read"]);
			setExpiresAt(null);
			await onCreated(result.key.name, result.secret);
		} catch (error) {
			toastApiError(error, "The key could not be created.");
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>New API key</DialogTitle>
					<DialogDescription>
						The secret is shown once, right after the key is created.
					</DialogDescription>
				</DialogHeader>

				<div className="flex flex-col gap-5">
					<FormField label="Name" htmlFor={`${fieldId}-name`} required>
						<Input
							id={`${fieldId}-name`}
							value={name}
							placeholder="Claude Code on the laptop"
							onChange={(event) => setName(event.target.value)}
						/>
					</FormField>

					<fieldset className="flex flex-col gap-2">
						<legend className="mono-label mb-1">Scopes</legend>
						{API_KEY_SCOPES.map((scope) => (
							<Label
								key={scope}
								className="flex items-start gap-3 font-normal"
								htmlFor={`${fieldId}-${scope}`}
							>
								<Checkbox
									id={`${fieldId}-${scope}`}
									checked={scopes.includes(scope)}
									onCheckedChange={() => toggle(scope)}
									className="mt-0.5"
								/>
								<span className="min-w-0">
									<span className="block font-medium text-sm">
										{API_KEY_SCOPE_LABELS[scope]}
									</span>
									<span className="block text-muted-foreground text-xs">
										{API_KEY_SCOPE_HINTS[scope]}
									</span>
								</span>
							</Label>
						))}
					</fieldset>

					<FormField
						label="Expiry"
						htmlFor={`${fieldId}-expires`}
						hint="Leave empty for a key without a time limit."
					>
						<DatePicker
							id={`${fieldId}-expires`}
							label="Expiry"
							value={expiresAt}
							onValueChange={setExpiresAt}
							className="w-48"
						/>
					</FormField>
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button
						onClick={submit}
						disabled={
							createKey.isPending ||
							name.trim().length === 0 ||
							scopes.length === 0
						}
					>
						Create key
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

/** One-shot display of the plain secret. */
function SecretDialog({
	secret,
	apiUrl,
	onClose,
}: {
	secret: { name: string; value: string } | null;
	/** Origin reported by `settings.serverInfo`. */
	apiUrl: string;
	onClose: () => void;
}) {
	return (
		<Dialog
			open={secret !== null}
			onOpenChange={(open) => {
				if (!open) {
					onClose();
				}
			}}
		>
			<DialogContent className="sm:max-w-xl">
				<DialogHeader>
					<DialogTitle>Key "{secret?.name}" created</DialogTitle>
					<DialogDescription>
						Copy it now: this secret is never shown again and cannot be read
						back from the server.
					</DialogDescription>
				</DialogHeader>

				<div className="flex items-start gap-2 rounded-lg bg-muted/50 p-3 ring-1 ring-border">
					<code
						data-testid="api-key-secret"
						className="min-w-0 flex-1 break-all font-mono text-sm"
					>
						{secret?.value}
					</code>
					<CopyButton
						value={secret?.value ?? ""}
						label="Copy the API key"
						variant="outline"
					/>
				</div>

				<div className="flex items-start gap-2 rounded-lg bg-tone-warning p-3 text-tone-warning-foreground">
					<TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
					<p className="text-sm">
						Anyone holding this secret can reach your library with the scopes
						you granted. Store it in a password manager.
					</p>
				</div>

				<div>
					<MonoLabel className="block">MCP command</MonoLabel>
					<div className="mt-2 flex items-start gap-2 rounded-lg bg-muted/50 p-3 ring-1 ring-border">
						<code className="min-w-0 flex-1 whitespace-pre-wrap break-all font-mono text-xs">
							{mcpCommand(apiUrl, secret?.value ?? "")}
						</code>
						<CopyButton
							value={mcpCommand(apiUrl, secret?.value ?? "")}
							label="Copy the MCP command with this key"
						/>
					</div>
				</div>

				<DialogFooter>
					<Button onClick={onClose}>I have copied it</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
