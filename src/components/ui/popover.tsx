import { cn } from "@/lib/utils";
import { Popover as PopoverPrimitive } from "radix-ui";
import type * as React from "react";

function Popover(props: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

function PopoverTrigger(props: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

function PopoverContent({
  className,
  align = "start",
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        // Clear the app header and the mobile bottom bar, unless the screen is too short (phones in landscape).
        collisionPadding={typeof innerHeight === "number" && innerHeight < 500 ? { top: 52, bottom: 8, left: 8, right: 8 } : { top: 56, bottom: 56, left: 8, right: 8 }}
        className={cn(
          "z-50 max-h-[var(--radix-popover-content-available-height)] w-80 max-w-[calc(100vw-1rem)] overflow-y-auto overscroll-contain rounded-lg border bg-popover p-3 text-sm text-popover-foreground shadow-lg outline-none",
          "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

export { Popover, PopoverContent, PopoverTrigger };
