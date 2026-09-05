import { useEffect, useRef, type ReactNode, type RefObject } from "react";

/** Native modal behavior keeps keyboard focus and shortcuts inside the active task. */
export default function Dialog({ labelId, onDismiss, initialFocus, children }: {
  labelId: string;
  onDismiss: () => void;
  initialFocus?: RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement;
    if (!dialog) return;
    dialog.showModal();
    initialFocus?.current?.focus();
    return () => {
      dialog.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, [initialFocus]);

  return <dialog ref={ref} className="native-dialog" aria-labelledby={labelId}
    onCancel={(event) => { event.preventDefault(); onDismiss(); }}>
    {children}
  </dialog>;
}
