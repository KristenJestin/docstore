import type { DragEndEvent } from "@dnd-kit/core";
import {
	closestCenter,
	DndContext,
	KeyboardSensor,
	PointerSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import {
	restrictToParentElement,
	restrictToVerticalAxis,
} from "@dnd-kit/modifiers";
import {
	arrayMove,
	SortableContext,
	sortableKeyboardCoordinates,
	useSortable,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@docstore/ui/lib/utils";
import { GripVerticalIcon } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Drag and drop of an ordered list, on `@dnd-kit`. One place holds the sensors
 * (pointer **and** keyboard, so a reorder is doable without a mouse), the
 * vertical-axis modifiers and the `arrayMove` arithmetic: the callers only
 * receive the reordered ids and post them to their own `reorder` procedure.
 *
 * Every list that used to carry up / down buttons goes through it: categories,
 * custom fields, rules, saved searches, the layouts of a document type and the
 * actions of a rule.
 */

/** A pointer only starts a drag after 5 px, so a click still is a click. */
const ACTIVATION_DISTANCE = 5;

export interface SortableListProps {
	/** Ids in their current display order. */
	ids: string[];
	/** Called with the new order once an item is dropped somewhere else. */
	onReorder: (ids: string[]) => void;
	/** Accessible description read when a drag starts. */
	label?: string;
	children: ReactNode;
	disabled?: boolean;
}

export function SortableList({
	ids,
	onReorder,
	label = "Reorderable list",
	children,
	disabled = false,
}: SortableListProps) {
	const sensors = useSensors(
		useSensor(PointerSensor, {
			activationConstraint: { distance: ACTIVATION_DISTANCE },
		}),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		}),
	);

	const onDragEnd = (event: DragEndEvent) => {
		const { active, over } = event;
		if (!over || active.id === over.id) {
			return;
		}
		const from = ids.indexOf(String(active.id));
		const to = ids.indexOf(String(over.id));
		if (from < 0 || to < 0) {
			return;
		}
		onReorder(arrayMove(ids, from, to));
	};

	return (
		<DndContext
			sensors={disabled ? [] : sensors}
			collisionDetection={closestCenter}
			modifiers={[restrictToVerticalAxis, restrictToParentElement]}
			accessibility={{ screenReaderInstructions: { draggable: label } }}
			onDragEnd={onDragEnd}
		>
			<SortableContext items={ids} strategy={verticalListSortingStrategy}>
				{children}
			</SortableContext>
		</DndContext>
	);
}

export interface SortableRowRenderProps {
	/** Props to spread on the drag handle (button). */
	handleProps: Record<string, unknown>;
	isDragging: boolean;
}

export interface SortableRowProps {
	id: string;
	children: (props: SortableRowRenderProps) => ReactNode;
	className?: string;
	/** Rendered element; `li` inside a `ul`, `div` otherwise. */
	as?: "li" | "div";
}

/**
 * One draggable row. The handle is the only grabbable area, so the buttons and
 * links inside the row keep working.
 */
export function SortableRow({
	id,
	children,
	className,
	as = "li",
}: SortableRowProps) {
	const {
		attributes,
		listeners,
		setNodeRef,
		setActivatorNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({ id });

	const style = {
		transform: CSS.Translate.toString(transform),
		transition,
	};
	const Element = as;

	return (
		<Element
			ref={setNodeRef}
			style={style}
			className={cn(
				isDragging && "relative z-10 bg-card opacity-90 shadow-lift",
				className,
			)}
		>
			{children({
				handleProps: {
					ref: setActivatorNodeRef,
					...attributes,
					...listeners,
				},
				isDragging,
			})}
		</Element>
	);
}

export interface DragHandleProps {
	/** `handleProps` handed over by `SortableRow`. */
	handleProps: Record<string, unknown>;
	/** Accessible name, e.g. "Reorder Payslip". */
	label: string;
	className?: string;
	disabled?: boolean;
}

/**
 * Grip button of a sortable row. Keeping it a real `button` is what makes the
 * dnd-kit keyboard sensor work: focus it, press Space, move with the arrows.
 */
export function DragHandle({
	handleProps,
	label,
	className,
	disabled = false,
}: DragHandleProps) {
	return (
		<button
			type="button"
			aria-label={label}
			disabled={disabled}
			className={cn(
				"flex size-7 shrink-0 cursor-grab items-center justify-center rounded-md text-muted-foreground transition-colors duration-200 ease-premium hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 active:cursor-grabbing disabled:cursor-default disabled:opacity-40",
				className,
			)}
			{...handleProps}
		>
			<GripVerticalIcon className="size-4" strokeWidth={1.75} />
		</button>
	);
}
