import { BrandMark } from "@/components/brand-mark";

export function BrandLogo() {
  return (
    <div className="flex items-center gap-2">
      <BrandMark className="size-7 text-icon-accent" />
      <span className="font-display text-h2">Orchid</span>
    </div>
  );
}
