import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";
import { Dialog } from "radix-ui";
import type * as React from "react";

/** A panel that slides in from a screen edge, built on Radix Dialog. */
function Sheet(props: React.ComponentProps<typeof Dialog.Root>) {
  return <Dialog.Root data-slot="sheet" {...props} />;
}

function SheetTrigger(props: React.ComponentProps<typeof Dialog.Trigger>) {
  return <Dialog.Trigger data-slot="sheet-trigger" {...props} />;
}

const sides = {
  left: "inset-y-0 left-0 w-[min(22rem,calc(100vw-2.5rem))] border-r pl-[env(safe-area-inset-left)] data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left",
  right: "inset-y-0 right-0 w-[min(36rem,calc(100vw-2.5rem))] border-l pr-[env(safe-area-inset-right)] data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right",
  bottom: "inset-x-0 bottom-0 max-h-[85dvh] rounded-t-xl border-t data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom",
};

/**
 * `title` is required for screen readers; `description` is optional and visually hidden unless `showDescription`.
 * The body scrolls; `footer` stays pinned at the bottom.
 */
function SheetContent({
  side = "right",
  title,
  description,
  showDescription = false,
  footer,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<typeof Dialog.Content>, "title"> & {
  side?: keyof typeof sides;
  title: React.ReactNode;
  description?: React.ReactNode;
  showDescription?: boolean;
  footer?: React.ReactNode;
}) {
  return (
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
      <Dialog.Content
        data-slot="sheet-content"
        className={cn(
          "fixed z-50 flex max-h-dvh flex-col bg-background shadow-xl outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:duration-200 data-[state=closed]:duration-150",
          sides[side],
          className,
        )}
        {...props}
        // Radix's documented opt-out when there's no description; repeating the title would be read twice.
        {...(description ? undefined : { "aria-describedby": undefined })}
      >
        <div className="flex h-12 shrink-0 items-center gap-2 border-b pr-2 pl-4">
          <Dialog.Title className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</Dialog.Title>
          <Dialog.Close asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Close">
              <X />
            </Button>
          </Dialog.Close>
        </div>
        {description && (
          <Dialog.Description className={showDescription ? "px-4 pt-3 text-xs text-muted-foreground" : "sr-only"}>
            {description}
          </Dialog.Description>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">{children}</div>
        {footer && <div className="shrink-0 border-t p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{footer}</div>}
      </Dialog.Content>
    </Dialog.Portal>
  );
}

const SheetClose = Dialog.Close;

export { Sheet, SheetClose, SheetContent, SheetTrigger };
