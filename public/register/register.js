const $ = sel => document.querySelector(sel);
const gate = $('#gate');
const gateMsg = $('#gateMsg');
const regForm = $('#regForm');
const formMsg = $('#formMsg');

$('#unlockBtn').addEventListener('click', async () => {
  gateMsg.textContent = 'Checking…';
  const code = $('#code').value.trim().toLowerCase();
  if (!code) { gateMsg.textContent = 'Enter a passcode.'; return; }

  try {
    const r = await fetch('/api/passcodes/claim', {
      method: 'POST',
      headers: { 'content-type':'application/json' },
      body: JSON.stringify({ code })
    });
    const j = await r.json();
    if (j.ok) {
      gate.classList.add('hidden');
      regForm.classList.remove('hidden');
      formMsg.textContent = 'Unlocked. Complete your details.';
      formMsg.className = 'hint ok';
    } else {
      gateMsg.textContent = 'Invalid or already used.';
      gateMsg.className = 'hint err';
    }
  } catch (e) {
    gateMsg.textContent = 'Network error. Try again.';
    gateMsg.className = 'hint err';
  }
});

regForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  formMsg.textContent = 'Submitting…';

  const payload = {
    name:  $('#name').value.trim(),
    email: $('#email').value.trim(),
    phone: $('#phone').value.trim()
  };

  try {
    const r = await fetch('/api/register', {
      method: 'POST',
      headers: { 'content-type':'application/json' },
      body: JSON.stringify(payload)
    });
    const j = await r.json();
    if (j.ok) {
      formMsg.textContent = 'Registered! See you at the event.';
      formMsg.className = 'hint ok';
      regForm.reset();
      regForm.querySelector('button[type=submit]').disabled = true;
    } else {
      formMsg.textContent = 'Session issue. Please unlock again.';
      formMsg.className = 'hint err';
    }
  } catch (e) {
    formMsg.textContent = 'Network error. Try again.';
    formMsg.className = 'hint err';
  }
});
