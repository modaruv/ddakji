// helpers
const $ = sel => document.querySelector(sel);
const show = (el, yes) => el.classList.toggle('hide', !yes);

const elGate     = $('#gate');
const elForm     = $('#form');
const elGateMsg  = $('#gateMsg');
const elFormMsg  = $('#formMsg');

$('#btnClaim').addEventListener('click', claimCode);
$('#btnSubmit').addEventListener('click', submitForm);
$('#btnReset').addEventListener('click', resetToGate);

async function claimCode(){
  elGateMsg.textContent = '';
  const code = $('#code').value.trim();
  if (!code){ elGateMsg.textContent = 'Please enter your passcode.'; return; }

  try {
    const r = await fetch('/api/passcodes/claim', {
      method: 'POST',
      headers: { 'content-type':'application/json' },
      body: JSON.stringify({ code })
    });
    const data = await r.json();
    if (data && data.ok){
      // success: show form
      $('#code').value = '';
      show(elGate, false);
      show(elForm, true);
      elFormMsg.textContent = 'Passcode accepted. Complete the form.';
    } else {
      elGateMsg.textContent = (data && data.error) ? prettyClaimError(data.error) : 'Invalid code.';
    }
  } catch (e) {
    elGateMsg.textContent = 'Network error. Please try again.';
  }
}

function prettyClaimError(err){
  switch (err){
    case 'used': return 'That passcode was already used.';
    case 'expired': return 'This passcode expired.';
    case 'not_found': return 'No such passcode.';
    default: return 'Unable to claim this passcode.';
  }
}

async function submitForm(){
  elFormMsg.textContent = '';

  const full_name   = $('#full_name').value.trim();
  const age         = parseInt($('#age').value, 10);
  const phone       = $('#phone').value.trim();
  const email       = $('#email').value.trim();
  const profile_url = $('#profile_url').value.trim();
  const health_notes= $('#health_notes').value.trim();
  const agree_rules   = $('#agree_rules').checked;
  const agree_contact = $('#agree_contact').checked;

  const genderEl = document.querySelector('input[name="gender"]:checked');
  const gender   = genderEl ? genderEl.value : '';

  // quick client checks (server will re-check)
  if (!full_name)  return elFormMsg.textContent = 'Please enter your full name.';
  if (!gender)     return elFormMsg.textContent = 'Please select your gender.';
  if (!Number.isInteger(age) || age < 13 || age > 65) return elFormMsg.textContent = 'Age must be between 13 and 65.';
  if (!phone)      return elFormMsg.textContent = 'Please enter your phone.';
  if (!/^https?:\/\//i.test(profile_url)) return elFormMsg.textContent = 'Enter a valid profile URL (starts with http or https).';
  if (!health_notes) return elFormMsg.textContent = 'Please tell us about any health issues or write “None”.';
  if (!agree_rules)   return elFormMsg.textContent = 'You must accept the rules.';
  if (!agree_contact) return elFormMsg.textContent = 'You must accept to be contacted if selected.';

  const payload = {
    full_name, gender, age, phone,
    email: email || null,
    profile_url, health_notes,
    agree_rules: true,
    agree_contact: true
  };

  try {
    const r = await fetch('/api/register', {
      method: 'POST',
      headers: { 'content-type':'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await r.json();
    if (data && data.ok){
      // Success — API also cleared the kraken_session cookie
      elFormMsg.innerHTML = '✅ Registered! You can close this tab. If you want to register another person, use a new passcode.';
      // Reset to gate after a short pause
      setTimeout(resetToGate, 1200);
    } else {
      elFormMsg.textContent = prettyRegError(data);
    }
  } catch (e) {
    elFormMsg.textContent = 'Network error. Please try again.';
  }
}

function prettyRegError(data){
  if (!data) return 'Something went wrong.';
  if (data.error === 'validation'){
    const f = data.fields || {};
    const first = Object.keys(f)[0];
    return `Fix the highlighted fields: ${first || 'unknown'}.`;
  }
  if (data.error === 'no_session' || data.error === 'bad_session' || data.error === 'session_expired'){
    // cookie gone or expired → send user back to gate
    resetToGate();
    return 'Your passcode session expired. Please enter your passcode again.';
  }
  if (data.error === 'session_used'){
    resetToGate();
    return 'This passcode was already used.';
  }
  return 'Could not submit. Please try again.';
}

function resetToGate(){
  // clear inputs
  for (const id of ['full_name','age','phone','email','profile_url','health_notes']) {
    const el = document.getElementById(id); if (el) el.value = '';
  }
  document.querySelectorAll('input[name="gender"]').forEach(r => r.checked = false);
  $('#agree_rules').checked = false;
  $('#agree_contact').checked = false;

  elFormMsg.textContent = '';
  elGateMsg.textContent = '';
  show(elForm, false);
  show(elGate, true);
  // user will enter a (new) passcode again
}
