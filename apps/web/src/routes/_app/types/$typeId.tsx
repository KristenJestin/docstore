import type { DocumentListItem } from "@docstore/shared/document";
import { Badge } from "@docstore/ui/components/badge";
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from "@docstore/ui/components/breadcrumb";
import { Button } from "@docstore/ui/components/button";
import { Card, CardContent, CardHeader } from "@docstore/ui/components/card";
import { Skeleton } from "@docstore/ui/components/skeleton";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@docstore/ui/components/tabs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { MinusIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { useConfirm } from "@/components/confirm-dialog";
import { DateText } from "@/components/date-text";
import {
	DocumentTypeMark,
	PeriodicityBadge,
	RecurrenceProgress,
} from "@/components/document-types/document-type-badges";
import { DocumentTypeDetection } from "@/components/document-types/document-type-detection";
import { DocumentTypeFormSheet } from "@/components/document-types/document-type-form-sheet";
import { DocumentTypeLayouts } from "@/components/document-types/document-type-layouts";
import { OutOfRangeNotice } from "@/components/document-types/out-of-range-notice";
import { RecurrenceTimeline } from "@/components/document-types/recurrence-timeline";
import { DocumentRow } from "@/components/documents/document-row";
import { EmptyState } from "@/components/empty-state";
import { MonoLabel } from "@/components/mono-label";
import { PartyAvatar } from "@/components/party-avatar";
import { TestDocumentPicker } from "@/components/rules/test-document-picker";
import { toastApiError } from "@/lib/api-error";
import { countLabel } from "@/lib/plural";
import { orpc } from "@/utils/orpc";

/** Documents listed under the timeline. */
const PAGE_SIZE = 50;

const TABS = ["overview", "layouts", "detection"] as const;

const searchSchema = z.object({
	tab: z.enum(TABS).optional().catch(undefined),
});

export const Route = createFileRoute("/_app/types/$typeId")({
	validateSearch: searchSchema,
	component: DocumentTypeDetailPage,
});

function DocumentTypeDetailPage() {
	const { typeId } = Route.useParams();
	const { tab } = Route.useSearch();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const confirm = useConfirm();

	const [editing, setEditing] = useState(false);
	const [candidate, setCandidate] = useState<DocumentListItem | null>(null);

	const type = useQuery(
		orpc.documentType.get.queryOptions({ input: { id: typeId } }),
	);
	const documents = useQuery(
		orpc.document.list.queryOptions({
			input: { documentTypeId: typeId, page: 1, pageSize: PAGE_SIZE },
		}),
	);

	const setOverride = useMutation(
		orpc.documentType.setDocumentOverride.mutationOptions(),
	);
	const remove = useMutation(orpc.documentType.delete.mutationOptions());

	const invalidate = () =>
		Promise.all([
			queryClient.invalidateQueries({ queryKey: orpc.documentType.key() }),
			queryClient.invalidateQueries({ queryKey: orpc.document.key() }),
		]);

	if (type.isLoading) {
		return (
			<div className="flex flex-col gap-4 px-6 py-8 lg:px-8">
				<Skeleton className="h-10 w-96" />
				<Skeleton className="h-96 w-full" />
			</div>
		);
	}

	if (type.isError || !type.data) {
		return (
			<div className="px-6 py-8 lg:px-8">
				<EmptyState
					title="Document type not found"
					description="This document type may have been deleted."
					action={
						<Link to="/types" search={{}}>
							<Button variant="outline">Back to document types</Button>
						</Link>
					}
				/>
			</div>
		);
	}

	const detail = type.data;

	const applyOverride = async (documentId: string, included: boolean) => {
		try {
			await setOverride.mutateAsync({
				documentTypeId: typeId,
				documentId,
				included,
			});
			await invalidate();
			toast.success(
				included ? "Document added to the type." : "Document excluded.",
			);
			setCandidate(null);
		} catch (error) {
			toastApiError(error, "The membership could not be changed.");
		}
	};

	const onDelete = async () => {
		const ok = await confirm({
			title: `Delete "${detail.name}"?`,
			description: "The documents themselves are left untouched.",
			confirmLabel: "Delete",
			destructive: true,
		});
		if (!ok) {
			return;
		}
		try {
			await remove.mutateAsync({ id: typeId, detachDocuments: true });
			queryClient.removeQueries({
				queryKey: orpc.documentType.get.queryKey({ input: { id: typeId } }),
			});
			toast.success("Document type deleted.");
			navigate({ to: "/types", search: {} });
			await invalidate();
		} catch (error) {
			toastApiError(error, "The document type could not be deleted.");
		}
	};

	return (
		// One single `Tabs` root: the triggers live in the header, the panels in
		// the body, and the URL carries the active tab.
		<Tabs
			value={tab ?? "overview"}
			onValueChange={(next) =>
				navigate({
					to: "/types/$typeId",
					params: { typeId },
					search: { tab: next as (typeof TABS)[number] },
				})
			}
		>
			<header className="border-border border-b px-6 pt-6 pb-0 lg:px-8 lg:pt-8">
				<Breadcrumb>
					<BreadcrumbList className="font-mono text-xs">
						<BreadcrumbItem>
							<BreadcrumbLink render={<Link to="/types" search={{}} />}>
								Document types
							</BreadcrumbLink>
						</BreadcrumbItem>
						<BreadcrumbSeparator />
						<BreadcrumbItem>
							<BreadcrumbPage>{detail.name}</BreadcrumbPage>
						</BreadcrumbItem>
					</BreadcrumbList>
				</Breadcrumb>

				<div className="mt-5 flex flex-wrap items-start justify-between gap-4">
					<div className="flex min-w-0 items-center gap-3">
						<DocumentTypeMark icon={detail.icon} color={detail.color} />
						<div className="min-w-0">
							<h1 className="font-extrabold text-3xl leading-tight tracking-tight">
								{detail.name}
							</h1>
							<div className="mt-2 flex flex-wrap items-center gap-2 text-muted-foreground text-sm">
								{detail.periodicity ? (
									<PeriodicityBadge periodicity={detail.periodicity} />
								) : (
									<Badge tone="neutral">One-off</Badge>
								)}
								{detail.enabled ? null : <Badge tone="neutral">Disabled</Badge>}
								<span>{detail.issuerName ?? "Any issuer"}</span>
								{detail.categoryName ? (
									<span>· {detail.categoryName}</span>
								) : null}
							</div>
						</div>
					</div>

					<div className="flex flex-wrap items-center gap-2">
						<Button
							variant="outline"
							size="sm"
							onClick={() => setEditing(true)}
						>
							<PencilIcon />
							Edit
						</Button>
						<Button variant="destructive" size="sm" onClick={onDelete}>
							<Trash2Icon />
							Delete
						</Button>
					</div>
				</div>

				{/* The bar sticks under the shell header, never behind it. */}
				<TabsList className="sticky top-header z-20 mt-5 -mb-px">
					<TabsTrigger value="overview">Overview</TabsTrigger>
					<TabsTrigger value="layouts">
						Layouts
						{/* The lone default layout is hidden in the tab: nothing to count. */}
						{detail.layouts.length > 1 ? (
							<Badge tone="outline">{detail.layouts.length}</Badge>
						) : null}
					</TabsTrigger>
					<TabsTrigger value="detection">Detection</TabsTrigger>
				</TabsList>
			</header>

			<div className="px-6 py-6 lg:px-8">
				<TabsContent value="overview">
					<div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
						<div className="flex flex-col gap-6 xl:col-span-8">
							{detail.periodicity && detail.stats ? (
								<Card>
									<CardHeader className="flex flex-wrap items-center justify-between gap-2">
										<MonoLabel>Timeline</MonoLabel>
										<RecurrenceProgress stats={detail.stats} />
									</CardHeader>
									<CardContent>
										<RecurrenceTimeline timeline={detail.timeline} />
									</CardContent>
								</Card>
							) : null}

							<OutOfRangeNotice detail={detail} />

							<Card>
								<CardHeader className="flex flex-wrap items-center justify-between gap-2">
									<MonoLabel>Documents</MonoLabel>
									<Badge tone="outline">
										{countLabel(detail.memberCount, "member")}
									</Badge>
								</CardHeader>
								<CardContent className="px-0">
									{documents.isLoading ? (
										<div className="flex flex-col gap-2 px-4">
											<Skeleton className="h-12 w-full" />
											<Skeleton className="h-12 w-full" />
										</div>
									) : (documents.data?.items.length ?? 0) === 0 ? (
										<div className="px-4">
											<EmptyState
												size="sm"
												title="No document"
												description="No document carries this type yet, and none matches its issuer and category."
											/>
										</div>
									) : (
										<ul className="divide-y divide-border border-border border-t">
											{documents.data?.items.map((item) => (
												<li
													key={item.id}
													className="row-in flex items-center gap-2 pr-3"
												>
													<span className="min-w-0 flex-1">
														<DocumentRow
															item={item}
															onOpen={() =>
																navigate({
																	to: "/documents/$documentId",
																	params: { documentId: item.id },
																})
															}
															trailing={
																<DateText
																	value={item.documentDate}
																	precision={item.datePrecision}
																/>
															}
														/>
													</span>
													<Button
														variant="ghost"
														size="sm"
														aria-label={`Exclude ${item.title} from the type`}
														onClick={() => applyOverride(item.id, false)}
													>
														<MinusIcon />
														Exclude
													</Button>
												</li>
											))}
										</ul>
									)}
								</CardContent>
							</Card>
						</div>

						<div className="flex flex-col gap-6 xl:col-span-4">
							<Card>
								<CardHeader>
									<MonoLabel>Add a document</MonoLabel>
								</CardHeader>
								<CardContent className="flex flex-col gap-3">
									<p className="text-muted-foreground text-xs">
										Force a document into this type even when its issuer,
										category or date do not match.
									</p>
									<TestDocumentPicker
										label="Document to include"
										value={candidate}
										onValueChange={setCandidate}
									/>
									<Button
										size="sm"
										className="self-start"
										disabled={!candidate}
										onClick={() =>
											candidate ? applyOverride(candidate.id, true) : undefined
										}
									>
										<PlusIcon />
										Include in the type
									</Button>
								</CardContent>
							</Card>

							<Card>
								<CardHeader>
									<MonoLabel>Configuration</MonoLabel>
								</CardHeader>
								<CardContent className="flex flex-col gap-2 text-sm">
									<InfoRow
										label="Issuer"
										value={detail.issuerName ?? "Any issuer"}
										avatar={detail.issuerName}
									/>
									<InfoRow
										label="Subject"
										value={detail.subjectName ?? "—"}
										avatar={detail.subjectName}
									/>
									<InfoRow
										label="Category"
										value={detail.categoryName ?? "None"}
									/>
									<InfoRow
										label="Title template"
										value={detail.titleTemplate ?? "Unchanged"}
									/>
									<InfoRow
										label="Sensitive by default"
										value={detail.sensitiveDefault ? "Yes" : "No"}
									/>
									<InfoRow label="Layouts" value={String(detail.layoutCount)} />
									<InfoRow
										label="Documents"
										value={String(detail.documentCount)}
									/>
									{detail.periodicity ? (
										<>
											<InfoRow
												label="First period"
												value={detail.startPeriod ?? "—"}
											/>
											<InfoRow
												label="Last period"
												value={detail.endPeriod ?? "Open recurrence"}
											/>
											<InfoRow
												label="Expected day"
												value={
													detail.expectedDay === null
														? "End of period"
														: String(detail.expectedDay)
												}
											/>
											<InfoRow
												label="Grace days"
												value={String(detail.graceDays ?? 0)}
											/>
											<InfoRow
												label="Last period filed"
												value={detail.stats?.lastPeriod ?? "—"}
											/>
										</>
									) : null}
								</CardContent>
							</Card>
						</div>
					</div>
				</TabsContent>

				<TabsContent value="layouts">
					<DocumentTypeLayouts detail={detail} />
				</TabsContent>

				<TabsContent value="detection">
					<DocumentTypeDetection detail={detail} />
				</TabsContent>
			</div>

			<DocumentTypeFormSheet
				open={editing}
				onOpenChange={setEditing}
				documentType={detail}
			/>
		</Tabs>
	);
}

function InfoRow({
	label,
	value,
	avatar,
}: {
	label: string;
	value: string;
	avatar?: string | null;
}) {
	return (
		<div className="flex items-center justify-between gap-3">
			<span className="text-muted-foreground text-xs">{label}</span>
			<span className="flex min-w-0 items-center gap-1.5">
				{avatar ? <PartyAvatar name={avatar} size="sm" /> : null}
				<span className="truncate font-mono text-xs tabular-nums">{value}</span>
			</span>
		</div>
	);
}
