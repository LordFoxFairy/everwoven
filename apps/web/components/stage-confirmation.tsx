'use client';
import {useRef, useState} from 'react';
import {MessageSquareText} from 'lucide-react';
import {AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogMedia, AlertDialogTitle} from './ui/alert-dialog';

type Props = {
  title: string; description: string; cancelLabel: string; confirmLabel: string;
  portalContainer: HTMLElement | null;
  onCancel: () => void; onConfirm: () => void;
};

/** Domain callbacks stay here; focus trapping and modal isolation belong to Radix. */
export function StageConfirmation({title, description, cancelLabel, confirmLabel, portalContainer, onCancel, onConfirm}: Props) {
  const outcome = useRef<'cancel' | 'confirm' | null>(null);
  const [opener] = useState(() => typeof document === 'undefined' ? null : document.activeElement);
  function finish(action: 'cancel' | 'confirm') {
    if (outcome.current) return;
    outcome.current = action;
    if (action === 'cancel') onCancel(); else onConfirm();
  }
  return <AlertDialog open onOpenChange={open => {if (!open) finish('cancel');}}>
    <AlertDialogContent container={portalContainer}
      onEscapeKeyDown={event => {event.preventDefault();event.stopPropagation();finish('cancel');}}
      onCloseAutoFocus={event => {
        event.preventDefault();
        // Confirmation may navigate or focus the response field; never steal that focus.
        if (outcome.current === 'cancel' && opener instanceof HTMLElement && opener.isConnected) opener.focus();
      }}>
      <AlertDialogHeader>
        <AlertDialogMedia><MessageSquareText size={22} aria-hidden="true"/></AlertDialogMedia>
        <AlertDialogTitle>{title}</AlertDialogTitle>
        <AlertDialogDescription>{description}</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>{cancelLabel}</AlertDialogCancel>
        <AlertDialogAction onClick={() => finish('confirm')}>{confirmLabel}</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}
