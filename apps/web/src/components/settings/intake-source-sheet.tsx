import type {
	FolderAfterImport,
	IntakeDefaults,
	IntakeSource,
	IntakeSourceConfigInput,
	IntakeSourceType,
	MailAfterImport,
} from "@docstore/shared/intake";
import {
	DEFAULT_FOLDER_POLL_SECONDS,
	DEFAULT_MAIL_POLL_SECONDS,
	FOLDER_AFTER_IMPORTS,
	MAIL_AFTER_IMPORTS,
} from "@docstore/shared/intake";
import { Button } from "@docstore/ui/components/button";
import { Input } from "@docstore/ui/components/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@docstore/ui/components/select";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
} from "@docstore/ui/components/sheet";
import { Switch } from "@docstore/ui/components/switch";
import { useMutation } from "@tanstack/react-query";
import { PlugZapIcon, ServerCogIcon } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";

import { FormField, FormSection } from "@/components/form-field";
import { toastApiError } from "@/lib/api-error";
import { countLabel } from "@/lib/plural";
import { orpc } from "@/utils/orpc";

import { IntakeDefaultsFields } from "./intake-defaults-fields";
import {
	FOLDER_AFTER_IMPORT_LABELS,
	INTAKE_SOURCE_TYPE_LABELS,
	MAIL_AFTER_IMPORT_LABELS,
} from "./settings-labels";

interface FolderFormState {
	type: "folder";
	path: string;
	recursive: boolean;
	pollSeconds: string;
	afterImport: FolderAfterImport;
	moveTo: string;
	filePattern: string;
}

interface MailFormState {
	type: "mail";
	host: string;
	port: string;
	secure: boolean;
	username: string;
	/** Empty on an edit = password left unchanged. */
	password: string;
	mailbox: string;
	pollSeconds: string;
	onlyUnseen: boolean;
	from: string;
	subjectPattern: string;
	afterImport: MailAfterImport;
	moveTo: string;
	attachmentsOnly: boolean;
}

type ConfigFormState = FolderFormState | MailFormState;

const EMPTY_FOLDER: FolderFormState = {
	type: "folder",
	path: "",
	recursive: false,
	pollSeconds: String(DEFAULT_FOLDER_POLL_SECONDS),
	afterImport: "keep",
	moveTo: "",
	filePattern: "",
};

const EMPTY_MAIL: MailFormState = {
	type: "mail",
	host: "",
	port: "993",
	secure: true,
	username: "",
	password: "",
	mailbox: "INBOX",
	pollSeconds: String(DEFAULT_MAIL_POLL_SECONDS),
	onlyUnseen: true,
	from: "",
	subjectPattern: "",
	afterImport: "mark_seen",
	moveTo: "",
	attachmentsOnly: true,
};

/** An empty optional text field means "not set", not an empty string. */
function optional(value: string): string | undefined {
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function toFormState(source: IntakeSource): ConfigFormState {
	const config = source.config;
	if (config.type === "folder") {
		return {
			type: "folder",
			path: config.path,
			recursive: config.recursive,
			pollSeconds: String(config.pollSeconds),
			afterImport: config.afterImport,
			moveTo: config.moveTo ?? "",
			filePattern: config.filePattern ?? "",
		};
	}
	return {
		type: "mail",
		host: config.host,
		port: String(config.port),
		secure: config.secure,
		username: config.username,
		password: "",
		mailbox: config.mailbox,
		pollSeconds: String(config.pollSeconds),
		onlyUnseen: config.onlyUnseen,
		from: config.from ?? "",
		subjectPattern: config.subjectPattern ?? "",
		afterImport: config.afterImport,
		moveTo: config.moveTo ?? "",
		attachmentsOnly: config.attachmentsOnly,
	};
}

function toConfigInput(state: ConfigFormState): IntakeSourceConfigInput {
	if (state.type === "folder") {
		return {
			type: "folder",
			path: state.path.trim(),
			recursive: state.recursive,
			pollSeconds: Number(state.pollSeconds),
			afterImport: state.afterImport,
			moveTo: optional(state.moveTo),
			filePattern: optional(state.filePattern),
		};
	}
	return {
		type: "mail",
		host: state.host.trim(),
		port: Number(state.port),
		secure: state.secure,
		username: state.username.trim(),
		password: optional(state.password),
		mailbox: state.mailbox.trim(),
		pollSeconds: Number(state.pollSeconds),
		onlyUnseen: state.onlyUnseen,
		from: optional(state.from),
		subjectPattern: optional(state.subjectPattern),
		afterImport: state.afterImport,
		moveTo: optional(state.moveTo),
		attachmentsOnly: state.attachmentsOnly,
		importBodyAsPdf: false,
	};
}

export interface IntakeSourceSheetProps {
	open: boolean;
	/** Absent = create, present = edit. */
	source?: IntakeSource;
	onOpenChange: (open: boolean) => void;
	onSaved: () => Promise<void>;
}

/**
 * Create / edit an intake channel, one form per type. A source declared in
 * `docstore.config.json` (`managed`) is shown read-only: the whole form sits
 * inside a disabled `fieldset` and only "Test connection" stays available,
 * because the API refuses to update it.
 */
export function IntakeSourceSheet({
	open,
	source,
	onOpenChange,
	onSaved,
}: IntakeSourceSheetProps) {
	const fieldId = useId();
	const isEdit = Boolean(source);
	const readOnly = source?.managed ?? false;

	const [name, setName] = useState("");
	const [config, setConfig] = useState<ConfigFormState>(EMPTY_FOLDER);
	const [defaults, setDefaults] = useState<IntakeDefaults>({});
	const [loadedFor, setLoadedFor] = useState<string | null>(null);

	const createSource = useMutation(orpc.intakeSource.create.mutationOptions());
	const updateSource = useMutation(orpc.intakeSource.update.mutationOptions());
	const testSource = useMutation(orpc.intakeSource.test.mutationOptions());
	const pending = createSource.isPending || updateSource.isPending;

	const key = source?.id ?? "__new__";
	if (open && loadedFor !== key) {
		setLoadedFor(key);
		setName(source?.name ?? "");
		setConfig(source ? toFormState(source) : EMPTY_FOLDER);
		setDefaults(source?.defaults ?? {});
	}
	if (!open && loadedFor !== null) {
		setLoadedFor(null);
	}

	const changeType = (type: IntakeSourceType) => {
		setConfig(type === "folder" ? EMPTY_FOLDER : EMPTY_MAIL);
	};

	const test = async () => {
		try {
			// Editing a mailbox without retyping the password: the stored source is
			// tested instead of the incomplete draft.
			const useStored =
				Boolean(source) &&
				config.type === "mail" &&
				config.password.trim().length === 0;
			const result = await testSource.mutateAsync(
				useStored && source
					? { id: source.id }
					: { draft: toConfigInput(config) },
			);
			if (result.ok) {
				toast.success(result.message, {
					description: `${countLabel(result.candidates, "item")} ready to import.`,
				});
			} else {
				toast.error("Connection test failed.", {
					description: result.message,
				});
			}
		} catch (error) {
			toastApiError(error, "The connection could not be tested.");
		}
	};

	const submit = async () => {
		const trimmed = name.trim();
		if (trimmed.length === 0) {
			return;
		}
		try {
			if (source) {
				await updateSource.mutateAsync({
					id: source.id,
					name: trimmed,
					config: toConfigInput(config),
					defaults,
				});
				toast.success("Intake source updated.");
			} else {
				await createSource.mutateAsync({
					name: trimmed,
					enabled: true,
					config: toConfigInput(config),
					defaults,
				});
				toast.success(`Intake source "${trimmed}" created.`);
			}
			await onSaved();
			onOpenChange(false);
		} catch (error) {
			toastApiError(error, "The intake source could not be saved.");
		}
	};

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent side="right" className="w-full gap-0 sm:max-w-lg">
				<SheetHeader className="shrink-0 border-border border-b px-6 py-5">
					<SheetTitle>
						{isEdit ? "Edit intake source" : "New intake source"}
					</SheetTitle>
					<SheetDescription>
						{readOnly
							? "This channel is declared in docstore.config.json: the server owns it, so it can only be read here."
							: "A watched folder on the server or an IMAP mailbox, polled on a schedule."}
					</SheetDescription>
				</SheetHeader>

				<div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-6 py-6">
					{readOnly ? (
						<div className="flex items-start gap-2 rounded-lg bg-tone-info p-3 text-tone-info-foreground">
							<ServerCogIcon className="mt-0.5 size-4 shrink-0" />
							<p className="text-sm">
								Defined in docstore.config.json. Edit that file on the server
								and restart it to change this channel.
							</p>
						</div>
					) : null}

					<fieldset className="contents" disabled={readOnly}>
						<FormSection title="Channel">
							<FormField label="Name" htmlFor={`${fieldId}-name`} required>
								<Input
									id={`${fieldId}-name`}
									value={name}
									onChange={(event) => setName(event.target.value)}
								/>
							</FormField>

							<FormField
								label="Type"
								htmlFor={`${fieldId}-type`}
								hint={
									isEdit
										? "The type of an existing source cannot change."
										: undefined
								}
							>
								<Select
									items={INTAKE_SOURCE_TYPE_LABELS}
									value={config.type}
									disabled={isEdit}
									onValueChange={(value) =>
										changeType(value as IntakeSourceType)
									}
								>
									<SelectTrigger id={`${fieldId}-type`} className="w-full">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="folder">
											{INTAKE_SOURCE_TYPE_LABELS.folder}
										</SelectItem>
										<SelectItem value="mail">
											{INTAKE_SOURCE_TYPE_LABELS.mail}
										</SelectItem>
									</SelectContent>
								</Select>
							</FormField>
						</FormSection>

						{config.type === "folder" ? (
							<FolderFields
								fieldId={fieldId}
								state={config}
								onChange={(next) => setConfig({ ...config, ...next })}
							/>
						) : (
							<MailFields
								fieldId={fieldId}
								state={config}
								hasPassword={
									source?.config.type === "mail"
										? source.config.hasPassword
										: false
								}
								onChange={(next) => setConfig({ ...config, ...next })}
							/>
						)}

						<IntakeDefaultsFields
							value={defaults}
							onValueChange={setDefaults}
						/>
					</fieldset>
				</div>

				<SheetFooter className="shrink-0 flex-row justify-end border-border border-t px-6 py-4">
					<Button
						variant="outline"
						onClick={test}
						disabled={testSource.isPending}
					>
						<PlugZapIcon />
						{testSource.isPending ? "Testing…" : "Test connection"}
					</Button>
					{readOnly ? (
						<Button onClick={() => onOpenChange(false)}>Close</Button>
					) : (
						<Button
							onClick={submit}
							disabled={pending || name.trim().length === 0}
						>
							{isEdit ? "Save" : "Create source"}
						</Button>
					)}
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}

function FolderFields({
	fieldId,
	state,
	onChange,
}: {
	fieldId: string;
	state: FolderFormState;
	onChange: (next: Partial<FolderFormState>) => void;
}) {
	return (
		<FormSection title="Watched folder">
			<FormField
				label="Path"
				htmlFor={`${fieldId}-path`}
				required
				hint="Absolute path as the server sees it."
			>
				<Input
					id={`${fieldId}-path`}
					value={state.path}
					placeholder="/data/inbox"
					onChange={(event) => onChange({ path: event.target.value })}
					className="font-mono"
				/>
			</FormField>

			<div className="flex items-center justify-between gap-4">
				<label htmlFor={`${fieldId}-recursive`} className="text-sm">
					Include subfolders
				</label>
				<Switch
					id={`${fieldId}-recursive`}
					checked={state.recursive}
					onCheckedChange={(recursive) => onChange({ recursive })}
				/>
			</div>

			<FormField
				label="Poll interval"
				htmlFor={`${fieldId}-poll`}
				hint="In seconds, 5 at the minimum."
			>
				<Input
					id={`${fieldId}-poll`}
					type="number"
					min={5}
					value={state.pollSeconds}
					onChange={(event) => onChange({ pollSeconds: event.target.value })}
					className="w-32 font-mono"
				/>
			</FormField>

			<FormField label="After import" htmlFor={`${fieldId}-after`}>
				<Select
					items={FOLDER_AFTER_IMPORT_LABELS}
					value={state.afterImport}
					onValueChange={(value) =>
						onChange({ afterImport: value as FolderAfterImport })
					}
				>
					<SelectTrigger id={`${fieldId}-after`} className="w-full">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{FOLDER_AFTER_IMPORTS.map((item) => (
							<SelectItem key={item} value={item}>
								{FOLDER_AFTER_IMPORT_LABELS[item]}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</FormField>

			{state.afterImport === "move" ? (
				<FormField
					label="Destination folder"
					htmlFor={`${fieldId}-move-to`}
					required
				>
					<Input
						id={`${fieldId}-move-to`}
						value={state.moveTo}
						placeholder="/data/inbox/done"
						onChange={(event) => onChange({ moveTo: event.target.value })}
						className="font-mono"
					/>
				</FormField>
			) : null}

			<FormField
				label="File pattern"
				htmlFor={`${fieldId}-pattern`}
				hint="Regular expression tested on the file name. Empty = every file."
			>
				<Input
					id={`${fieldId}-pattern`}
					value={state.filePattern}
					placeholder="\\.pdf$"
					onChange={(event) => onChange({ filePattern: event.target.value })}
					className="font-mono"
				/>
			</FormField>
		</FormSection>
	);
}

function MailFields({
	fieldId,
	state,
	hasPassword,
	onChange,
}: {
	fieldId: string;
	state: MailFormState;
	hasPassword: boolean;
	onChange: (next: Partial<MailFormState>) => void;
}) {
	return (
		<FormSection title="Mailbox">
			<div className="grid grid-cols-3 gap-3">
				<FormField
					label="Host"
					htmlFor={`${fieldId}-host`}
					required
					className="col-span-2"
				>
					<Input
						id={`${fieldId}-host`}
						value={state.host}
						placeholder="imap.example.com"
						onChange={(event) => onChange({ host: event.target.value })}
					/>
				</FormField>
				<FormField label="Port" htmlFor={`${fieldId}-port`}>
					<Input
						id={`${fieldId}-port`}
						type="number"
						min={1}
						value={state.port}
						onChange={(event) => onChange({ port: event.target.value })}
						className="font-mono"
					/>
				</FormField>
			</div>

			<div className="flex items-center justify-between gap-4">
				<label htmlFor={`${fieldId}-secure`} className="text-sm">
					TLS connection
				</label>
				<Switch
					id={`${fieldId}-secure`}
					checked={state.secure}
					onCheckedChange={(secure) => onChange({ secure })}
				/>
			</div>

			<FormField label="Username" htmlFor={`${fieldId}-username`} required>
				<Input
					id={`${fieldId}-username`}
					value={state.username}
					autoComplete="off"
					onChange={(event) => onChange({ username: event.target.value })}
				/>
			</FormField>

			<FormField
				label="Password"
				htmlFor={`${fieldId}-password`}
				hint={
					hasPassword
						? "A password is already stored: leave empty to keep it."
						: "Stored encrypted; never sent back to the browser."
				}
			>
				<Input
					id={`${fieldId}-password`}
					type="password"
					value={state.password}
					autoComplete="new-password"
					onChange={(event) => onChange({ password: event.target.value })}
				/>
			</FormField>

			<div className="grid grid-cols-2 gap-3">
				<FormField label="Mailbox" htmlFor={`${fieldId}-mailbox`}>
					<Input
						id={`${fieldId}-mailbox`}
						value={state.mailbox}
						onChange={(event) => onChange({ mailbox: event.target.value })}
						className="font-mono"
					/>
				</FormField>
				<FormField
					label="Poll interval"
					htmlFor={`${fieldId}-mail-poll`}
					hint="In seconds, 30 at the minimum."
				>
					<Input
						id={`${fieldId}-mail-poll`}
						type="number"
						min={30}
						value={state.pollSeconds}
						onChange={(event) => onChange({ pollSeconds: event.target.value })}
						className="font-mono"
					/>
				</FormField>
			</div>

			<div className="flex items-center justify-between gap-4">
				<label htmlFor={`${fieldId}-unseen`} className="text-sm">
					Unread messages only
				</label>
				<Switch
					id={`${fieldId}-unseen`}
					checked={state.onlyUnseen}
					onCheckedChange={(onlyUnseen) => onChange({ onlyUnseen })}
				/>
			</div>

			<FormField
				label="Sender filter"
				htmlFor={`${fieldId}-from`}
				hint="Case-insensitive substring. Empty = every sender."
			>
				<Input
					id={`${fieldId}-from`}
					value={state.from}
					placeholder="billing@"
					onChange={(event) => onChange({ from: event.target.value })}
				/>
			</FormField>

			<FormField
				label="Subject pattern"
				htmlFor={`${fieldId}-subject`}
				hint="Regular expression tested on the subject."
			>
				<Input
					id={`${fieldId}-subject`}
					value={state.subjectPattern}
					onChange={(event) => onChange({ subjectPattern: event.target.value })}
					className="font-mono"
				/>
			</FormField>

			<FormField label="After import" htmlFor={`${fieldId}-mail-after`}>
				<Select
					items={MAIL_AFTER_IMPORT_LABELS}
					value={state.afterImport}
					onValueChange={(value) =>
						onChange({ afterImport: value as MailAfterImport })
					}
				>
					<SelectTrigger id={`${fieldId}-mail-after`} className="w-full">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{MAIL_AFTER_IMPORTS.map((item) => (
							<SelectItem key={item} value={item}>
								{MAIL_AFTER_IMPORT_LABELS[item]}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</FormField>

			{state.afterImport === "move" ? (
				<FormField
					label="Destination mailbox"
					htmlFor={`${fieldId}-mail-move-to`}
					required
				>
					<Input
						id={`${fieldId}-mail-move-to`}
						value={state.moveTo}
						placeholder="Archive"
						onChange={(event) => onChange({ moveTo: event.target.value })}
						className="font-mono"
					/>
				</FormField>
			) : null}

			<div className="flex items-center justify-between gap-4">
				<div>
					<label htmlFor={`${fieldId}-attachments`} className="text-sm">
						Attachments only
					</label>
					<p className="text-muted-foreground text-xs">
						Importing the message body as a PDF is not supported yet.
					</p>
				</div>
				<Switch
					id={`${fieldId}-attachments`}
					checked={state.attachmentsOnly}
					onCheckedChange={(attachmentsOnly) => onChange({ attachmentsOnly })}
				/>
			</div>
		</FormSection>
	);
}
