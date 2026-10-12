export async function settingsInteractionsBlocked(dialog) {
  return dialog.evaluate(element => {
    const controls = [...element.querySelectorAll('button,input,select,textarea')];
    const previous = document.activeElement;
    try {
      return controls.length > 0 && controls.every(control => {
        if (control.matches(':disabled')) return true;
        const panel = control.closest('.settings-detail[hidden][inert]');
        if (!panel?.hidden || !panel.inert || control.getClientRects().length) return false;
        control.focus({ preventScroll: true });
        return document.activeElement !== control;
      });
    } finally { previous?.focus?.({ preventScroll: true }); }
  });
}
