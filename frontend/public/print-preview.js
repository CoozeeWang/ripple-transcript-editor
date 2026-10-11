// The payload is injected by the native command into this application-owned page.
// Parse rather than execute document scripts; transcript content is HTML-escaped.
const payload = window.__RIPPLE_PRINT_PREVIEW__;
const parsed = new DOMParser().parseFromString(payload.html, 'text/html');
document.documentElement.lang = parsed.documentElement.lang;
document.head.replaceChildren(...parsed.head.childNodes);
document.body.replaceChildren(...parsed.body.childNodes);
const buttons = [...document.querySelectorAll('.toolbar button')];
const error = document.createElement('p');
error.setAttribute('role', 'alert');
error.style.color = '#b4232a';
error.hidden = true;
document.querySelector('.toolbar')?.after(error);
let printing = false;
async function print() {
  if (printing) return;
  printing = true; error.hidden = true;
  try { await window.__TAURI__.core.invoke('print_export_pdf'); }
  catch { error.textContent = payload.errorLabel; error.hidden = false; }
  finally { printing = false; }
}
for (const button of buttons) {
  button.removeAttribute('onclick');
  button.addEventListener('click', print);
}
document.fonts.ready.then(() => requestAnimationFrame(() => requestAnimationFrame(print)));
