import { encode } from "uqr";

export function AddressQr({ value, label }: { value: string; label: string }) {
  const { size, data } = encode(value, { border: 2 });

  const modules = data.flatMap((row, y) =>
    row.flatMap((dark, x) => (dark ? [`M${x} ${y}h1v1h-1z`] : [])),
  );

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${size} ${size}`}
      className="aspect-square w-full rounded-lg bg-white text-black"
    >
      <path d={modules.join("")} fill="currentColor" />
    </svg>
  );
}
