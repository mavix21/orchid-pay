import { cashOuts } from "./cash-out-methods";

const spokenMethods = cashOuts.map((cashOut) => cashOut.method).join(", ");

export function RotatingCashOutMethod({
  turn,
  method,
  previousMethod,
}: {
  turn: number;
  method: string;
  previousMethod: string | undefined;
}) {
  return (
    <>
      <span className="sr-only">{spokenMethods}.</span>
      <span
        aria-hidden="true"
        className="welcome-word-window relative inline-block text-primary"
      >
        {previousMethod && (
          <span
            key={`out-${turn}`}
            className="welcome-word-out absolute top-0 left-0 whitespace-nowrap"
          >
            {previousMethod}.
          </span>
        )}
        <span
          key={`in-${turn}`}
          className="welcome-word-in inline-block whitespace-nowrap"
        >
          {method}.
        </span>
      </span>
    </>
  );
}
