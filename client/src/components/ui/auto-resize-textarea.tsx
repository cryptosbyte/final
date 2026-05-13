import * as React from "react";
import { Textarea } from "@/components/ui/textarea";

type Props = React.ComponentProps<"textarea"> & {
  minRows?: number;
};

export const AutoResizeTextarea = React.forwardRef<HTMLTextAreaElement, Props>(
  ({ minRows = 3, value, className, ...props }, forwardedRef) => {
    const innerRef = React.useRef<HTMLTextAreaElement | null>(null);

    const setRefs = (el: HTMLTextAreaElement | null) => {
      innerRef.current = el;
      if (typeof forwardedRef === "function") forwardedRef(el);
      else if (forwardedRef) (forwardedRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = el;
    };

    const resize = React.useCallback(() => {
      const el = innerRef.current;
      if (!el) return;
      const cs = window.getComputedStyle(el);
      const lineHeight = parseFloat(cs.lineHeight) || 20;
      const paddingY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
      const borderY = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
      const minHeight = lineHeight * minRows + paddingY + borderY;
      el.style.height = "auto";
      const next = Math.max(el.scrollHeight + borderY, minHeight);
      el.style.height = `${next}px`;
    }, [minRows]);

    React.useLayoutEffect(() => {
      resize();
    }, [value, resize]);

    React.useEffect(() => {
      const onResize = () => resize();
      window.addEventListener("resize", onResize);
      return () => window.removeEventListener("resize", onResize);
    }, [resize]);

    return (
      <Textarea
        ref={setRefs}
        value={value}
        rows={minRows}
        className={`resize-none overflow-hidden ${className ?? ""}`}
        {...props}
      />
    );
  },
);
AutoResizeTextarea.displayName = "AutoResizeTextarea";
