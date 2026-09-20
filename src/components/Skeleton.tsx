/** Reusable loading placeholder; the reduced-motion rule in globals.css covers it. */
export default function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="animate-pulse space-y-2" aria-hidden="true">
      {Array.from({ length: lines }, (_, index) => (
        <div
          key={index}
          className={`h-4 rounded bg-line ${index === 0 ? "w-1/3" : index % 2 === 0 ? "w-2/3" : "w-full"}`}
        />
      ))}
    </div>
  );
}
