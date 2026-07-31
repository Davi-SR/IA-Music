import { useEffect, useState } from "react";

export function useCustomCursor(): {
  x: number;
  y: number;
  hovered: boolean;
} {
  const [cursor, setCursor] = useState({ x: -100, y: -100, hovered: false });

  useEffect(() => {
    const onMove = (event: MouseEvent) =>
      setCursor((current) => ({ ...current, x: event.clientX, y: event.clientY }));
    const onOver = (event: MouseEvent) => {
      if ((event.target as Element | null)?.closest(interactiveSelector)) {
        setCursor((current) => ({ ...current, hovered: true }));
      }
    };
    const onOut = (event: MouseEvent) => {
      if ((event.target as Element | null)?.closest(interactiveSelector)) {
        setCursor((current) => ({ ...current, hovered: false }));
      }
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseover", onOver);
    document.addEventListener("mouseout", onOut);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseover", onOver);
      document.removeEventListener("mouseout", onOut);
    };
  }, []);

  return cursor;
}

const interactiveSelector =
  "a, button, label, summary, [role='button'], input[type='range']";
