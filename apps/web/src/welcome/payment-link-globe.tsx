import { Link2Icon } from "lucide-react";
import { cn } from "@workspace/ui/lib/utils";
import { useEffect, useRef, useState } from "react";

import { FlowerAvatar } from "@/components/flower-avatar";

import { type CashOut, cashOutAt, cashOuts } from "./cash-out-methods";
import { type Palette, frameAt, paint } from "./globe-scene";

type ReceiverStage = {
  turn: number;
  receiverShown: boolean;
  cashOutShown: boolean;
};

const readPalette = (): Palette => {
  const styles = getComputedStyle(document.documentElement);

  return {
    surface: styles.getPropertyValue("--card").trim(),
    ink: styles.getPropertyValue("--foreground").trim(),
    accent: styles.getPropertyValue("--primary").trim(),
  };
};

const translate = (point: { x: number; y: number }) =>
  `translate(${point.x}px, ${point.y}px)`;

export function PaymentLinkGlobe({
  onCashOut,
}: {
  onCashOut: (turn: number, cashOut: CashOut) => void;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const linkPillRef = useRef<HTMLDivElement>(null);
  const receiverRef = useRef<HTMLDivElement>(null);
  const senderRef = useRef<HTMLDivElement>(null);
  const onCashOutRef = useRef(onCashOut);

  const [stage, setStage] = useState<ReceiverStage>({
    turn: 0,
    receiverShown: false,
    cashOutShown: false,
  });

  const receiverTurnRef = useRef(stage.turn);

  onCashOutRef.current = onCashOut;
  receiverTurnRef.current = stage.turn;

  useEffect(() => {
    for (const cashOut of cashOuts) {
      new Image().src = cashOut.logo;
      new Image().src = cashOut.flag;
    }
  }, []);

  useEffect(() => {
    const frame = frameRef.current;
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");

    if (!frame || !canvas || !context) return;

    let palette = readPalette();

    const themeObserver = new MutationObserver(() => {
      palette = readPalette();
    });

    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    let size = frame.clientWidth;

    const resize = () => {
      size = frame.clientWidth;

      const ratio = window.devicePixelRatio || 1;

      canvas.width = size * ratio;
      canvas.height = size * ratio;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    resize();

    const resizeObserver = new ResizeObserver(resize);

    resizeObserver.observe(frame);

    let started: number | undefined;
    let departedTurn = -1;
    let settledTurn = -1;
    let arrivedTurn = -1;
    let request = 0;

    const tick = (now: number) => {
      started ??= now;

      const globe = frameAt(
        now - started,
        size,
        reduced,
        receiverTurnRef.current,
      );

      if (globe.turn !== departedTurn) {
        departedTurn = globe.turn;
        setStage((last) => ({
          ...last,
          receiverShown: false,
          cashOutShown: false,
        }));
      }

      if (globe.settled && settledTurn !== globe.turn) {
        settledTurn = globe.turn;
        setStage({
          turn: globe.turn,
          receiverShown: true,
          cashOutShown: false,
        });
      }

      if (globe.arrived && arrivedTurn !== globe.turn) {
        arrivedTurn = globe.turn;
        setStage({ turn: globe.turn, receiverShown: true, cashOutShown: true });
        onCashOutRef.current(globe.turn, cashOutAt(globe.turn));
      }

      paint(context, palette, globe.scene);

      const linkPill = linkPillRef.current;

      if (linkPill) {
        linkPill.style.transform = translate(globe.linkPill);
        linkPill.style.opacity = String(globe.linkPill.opacity);
      }

      if (receiverRef.current)
        receiverRef.current.style.transform = translate(globe.receiverCity);

      if (senderRef.current)
        senderRef.current.style.transform = translate(globe.sender);

      request = requestAnimationFrame(tick);
    };

    request = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(request);
      resizeObserver.disconnect();
      themeObserver.disconnect();
    };
  }, []);

  const shown = cashOutAt(stage.turn);

  return (
    <div
      ref={frameRef}
      aria-hidden="true"
      className="relative aspect-square w-full"
    >
      <canvas ref={canvasRef} className="absolute inset-0 size-full" />
      <div ref={senderRef} className="absolute top-0 left-0">
        <div className="welcome-pop welcome-delay-2 -translate-x-1/2 -translate-y-1/2">
          <FlowerAvatar username="noa" size="xl" />
        </div>
      </div>
      <div ref={receiverRef} className="absolute top-0 left-0">
        <div className="absolute bottom-3 left-0 -translate-x-1/2">
          <div
            className={cn(
              "relative transition duration-300 ease-out",
              stage.receiverShown
                ? "scale-100 opacity-100"
                : "scale-90 opacity-0",
            )}
          >
            <FlowerAvatar username={shown.receiverUsername} size="xl" />
            <img
              src={shown.flag}
              alt=""
              className="absolute -right-1 -bottom-0.5 size-6 rounded-full ring-2 ring-background"
            />
          </div>
        </div>
        <div className="absolute top-4 left-0 w-max -translate-x-1/2">
          <div
            className={cn(
              "flex items-center gap-2 rounded-full bg-card py-1 pr-3 pl-1 shadow-surface ring-1 ring-foreground/10 transition duration-300 ease-out",
              stage.cashOutShown
                ? "translate-y-0 opacity-100"
                : "-translate-y-1 opacity-0",
            )}
          >
            <span className="flex h-6 shrink-0 items-center rounded-full bg-primary-foreground px-2">
              <img src={shown.logo} alt="" className="h-3.5 w-auto shrink-0" />
            </span>
            <span className="text-label-sm whitespace-nowrap">
              {shown.amount}
            </span>
          </div>
        </div>
      </div>
      <div ref={linkPillRef} className="absolute top-0 left-0 opacity-0">
        <span className="flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-label-sm whitespace-nowrap text-primary-foreground shadow-surface">
          <Link2Icon className="size-3.5" />
          $20
        </span>
      </div>
    </div>
  );
}
