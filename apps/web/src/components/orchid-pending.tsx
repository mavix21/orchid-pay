import { OrchidBloom } from "@/components/orchid-bloom";
import { ScreenNote } from "@/components/screen";

export function OrchidPending({
  title,
  note,
}: {
  title: string;
  note?: string;
}) {
  return (
    <main
      role="status"
      aria-live="polite"
      className="orchid-settle-in flex flex-1 flex-col items-center justify-center gap-6 px-5 py-8 text-center"
    >
      <div className="relative">
        <div
          aria-hidden="true"
          className="orchid-glow orchid-glow-pulse absolute -inset-1/4 rounded-full"
        />
        <OrchidBloom motion="sway" className="relative size-28" />
      </div>
      <div className="flex flex-col items-center gap-2">
        <h1 className="font-display text-h2 text-balance">{title}</h1>
        {note === undefined ? null : <ScreenNote>{note}</ScreenNote>}
      </div>
    </main>
  );
}
