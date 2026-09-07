"use client";

import { Slider as SliderPrimitive } from "@base-ui/react/slider";
import { cn } from "@docstore/ui/lib/utils";

function Slider({ className, ...props }: SliderPrimitive.Root.Props) {
	return (
		<SliderPrimitive.Root
			data-slot="slider"
			className={cn("w-full", className)}
			{...props}
		/>
	);
}

function SliderControl({ className, ...props }: SliderPrimitive.Control.Props) {
	return (
		<SliderPrimitive.Control
			data-slot="slider-control"
			className={cn(
				"flex h-6 w-full touch-none select-none items-center",
				className,
			)}
			{...props}
		/>
	);
}

function SliderTrack({
	className,
	children,
	...props
}: SliderPrimitive.Track.Props) {
	return (
		<SliderPrimitive.Track
			data-slot="slider-track"
			className={cn(
				"h-1.5 w-full select-none rounded-full bg-muted ring-1 ring-border",
				className,
			)}
			{...props}
		>
			{children}
		</SliderPrimitive.Track>
	);
}

function SliderIndicator({
	className,
	...props
}: SliderPrimitive.Indicator.Props) {
	return (
		<SliderPrimitive.Indicator
			data-slot="slider-indicator"
			className={cn("select-none rounded-full bg-primary", className)}
			{...props}
		/>
	);
}

function SliderThumb({ className, ...props }: SliderPrimitive.Thumb.Props) {
	return (
		<SliderPrimitive.Thumb
			data-slot="slider-thumb"
			className={cn(
				"size-4 select-none rounded-full bg-primary shadow-btn outline-none ring-1 ring-border transition-[box-shadow] duration-200 ease-premium focus-visible:ring-2 focus-visible:ring-ring",
				className,
			)}
			{...props}
		/>
	);
}

function SliderValue({ className, ...props }: SliderPrimitive.Value.Props) {
	return (
		<SliderPrimitive.Value
			data-slot="slider-value"
			className={cn("font-mono text-sm tabular-nums", className)}
			{...props}
		/>
	);
}

export {
	Slider,
	SliderControl,
	SliderIndicator,
	SliderThumb,
	SliderTrack,
	SliderValue,
};
