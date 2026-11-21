// Editing the selection never sends a bet. The game's regular play control does that.
window.installStakePicker = function ({ balance, selected, select, locked = () => false, anchor = null }) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Set stake';
  button.id = 'sharika-stake-picker';
  // The floating top-right button covered the native close/room buttons.
  // Games may mount it in their ordinary betting toolbar instead.
  button.style.cssText = anchor ?
    'flex:0 0 auto;min-width:82px;min-height:44px;padding:6px 10px;'+
    'border:2px solid #ffd76a;border-radius:14px;background:#352447;'+
    'color:#fff;font:700 12px system-ui,sans-serif;cursor:pointer' :
    'position:fixed;right:6px;top:28px;z-index:9998;padding:5px 9px;'+
    'border-radius:12px;background:#352447;color:white;font:600 12px sans-serif';
  const dialog = document.createElement('dialog');
  dialog.style.cssText = 'max-width:85vw;padding:16px;border-radius:12px;background:#241c31;color:white;font:16px sans-serif';
  dialog.innerHTML = '<form><label>Stake in coins <input type="number" min="1" step="1" inputmode="numeric" required></label><p></p><button type="button" data-full>Full balance</button> <button type="submit">Set</button> <button type="button" data-close>Cancel</button></form>';
  const input = dialog.querySelector('input');
  button.onclick = () => {
    const coins = balance();
    input.value = String(selected() || 1);
    dialog.querySelector('p').textContent = locked() ? 'Stake locked during spin' :
      'Available: ' + Number(coins || 0).toLocaleString('en-US');
    dialog.showModal();
  };
  dialog.querySelector('[data-full]').onclick = () => { input.value = String(balance() || 0); };
  dialog.querySelector('[data-close]').onclick = () => dialog.close();
  input.oninput = () => input.setCustomValidity('');
  dialog.querySelector('form').onsubmit = event => {
    event.preventDefault();
    const amount = input.valueAsNumber;
    if (locked()) { dialog.close(); return; }
    if (!Number.isSafeInteger(amount) || amount < 1 || amount > balance()) {
      input.setCustomValidity('Choose a whole number within your balance.');
      input.reportValidity();
      input.setCustomValidity('');
      return;
    }
    select(amount);
    if (anchor) button.textContent = 'Stake: ' + Number(amount).toLocaleString('en-US');
    dialog.close();
  };
  if (anchor && typeof anchor.replaceWith === 'function') anchor.replaceWith(button);
  else document.body.appendChild(button);
  document.body.appendChild(dialog);
};
